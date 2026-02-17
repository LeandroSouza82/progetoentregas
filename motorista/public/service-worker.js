// Service Worker para notificações push em background
// Este SW permite que o app receba notificações mesmo quando está fechado

const CACHE_NAME = 'v10-motorista-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/assets/logo-v10.png.png'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Cache aberto');
                return cache.addAll(urlsToCache);
            })
    );

    // Força o SW a ativar imediatamente
    self.skipWaiting();
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker ativado');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Removendo cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );

    // Toma controle imediatamente de todas as páginas
    return self.clients.claim();
});

// Intercepta requisições de rede
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - retorna a resposta do cache
                if (response) {
                    return response;
                }

                // Não está no cache - busca da rede
                return fetch(event.request);
            })
    );
});

// Escuta mensagens push
self.addEventListener('push', (event) => {
    console.log('[SW] Push recebido:', event);

    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        console.error('[SW] Erro ao parsear push data:', e);
        data = { titulo: 'V10 Delivery', mensagem: 'Nova notificação' };
    }

    const titulo = data.titulo || 'V10 Delivery';
    const options = {
        body: data.mensagem || 'Você tem uma nova mensagem',
        icon: '/assets/logo-v10.png.png',
        badge: '/assets/logo-v10.png.png',
        vibrate: [200, 100, 200],
        tag: 'v10-comunicado',
        requireInteraction: true,
        data: {
            url: data.url || 'https://v10delivery.vercel.app',
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'open',
                title: 'Abrir app'
            },
            {
                action: 'close',
                title: 'Fechar'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(titulo, options)
    );
});

// Clique na notificação
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notificação clicada:', event.action);

    event.notification.close();

    if (event.action === 'open' || !event.action) {
        const urlToOpen = event.notification.data?.url || 'https://v10delivery.vercel.app';

        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then((clientList) => {
                    // Se já tem uma janela aberta, focamos nela
                    for (let i = 0; i < clientList.length; i++) {
                        const client = clientList[i];
                        if (client.url === urlToOpen && 'focus' in client) {
                            return client.focus();
                        }
                    }

                    // Se não tem janela aberta, abrimos uma nova
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen);
                    }
                })
        );
    }
});

// Mensagens do app principal
self.addEventListener('message', (event) => {
    console.log('[SW] Mensagem recebida:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // Responde ao app que o SW está ativo
    if (event.data && event.data.type === 'PING') {
        event.ports[0].postMessage({ type: 'PONG', active: true });
    }
});
