// Helper para enviar notificações via Service Worker
// Permite notificações quando o app está em background

/**
 * Envia uma notificação via Service Worker
 * @param {Object} options - Opções da notificação
 * @param {string} options.titulo - Título da notificação
 * @param {string} options.mensagem - Corpo da mensagem
 * @param {string} options.url - URL para abrir ao clicar
 * @returns {Promise<void>}
 */
export async function enviarNotificacaoSW(options) {
    const { titulo, mensagem, url } = options;

    // Verifica se o navegador suporta Service Worker
    if (!('serviceWorker' in navigator)) {
        console.warn('⚠️ Service Worker não suportado neste navegador');
        return;
    }

    // Verifica se o Service Worker está registrado
    const registration = await navigator.serviceWorker.ready;

    if (!registration) {
        console.warn('⚠️ Service Worker não está registrado');
        return;
    }

    // Verifica se há permissão para notificações
    if (Notification.permission !== 'granted') {
        console.warn('⚠️ Permissão de notificação não concedida');
        return;
    }

    try {
        // Envia a notificação via Service Worker
        await registration.showNotification(titulo || 'V10 Delivery', {
            body: mensagem || 'Nova notificação',
            icon: '/assets/logo-v10.png.png',
            badge: '/assets/logo-v10.png.png',
            vibrate: [200, 100, 200],
            tag: 'v10-comunicado',
            requireInteraction: true,
            data: {
                url: url || 'https://v10delivery.vercel.app',
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
        });

        console.log('✅ Notificação enviada via Service Worker');
    } catch (error) {
        console.error('❌ Erro ao enviar notificação via SW:', error);
    }
}

/**
 * Verifica se o Service Worker está ativo
 * @returns {Promise<boolean>}
 */
export async function isServiceWorkerActive() {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        return !!registration.active;
    } catch (error) {
        console.error('❌ Erro ao verificar Service Worker:', error);
        return false;
    }
}

/**
 * Solicita permissão para notificações
 * @returns {Promise<string>} - 'granted', 'denied' ou 'default'
 */
export async function solicitarPermissaoNotificacao() {
    if (!('Notification' in window)) {
        console.warn('⚠️ Notification API não suportada');
        return 'denied';
    }

    if (Notification.permission === 'granted') {
        return 'granted';
    }

    if (Notification.permission === 'denied') {
        return 'denied';
    }

    try {
        const permission = await Notification.requestPermission();
        console.log('🔔 Permissão de notificação:', permission);
        return permission;
    } catch (error) {
        console.error('❌ Erro ao solicitar permissão:', error);
        return 'denied';
    }
}

/**
 * 🔑 Captura o push_token do motorista e salva no banco de dados
 * @param {Object} supabase - Cliente Supabase
 * @param {number} motoristaId - ID do motorista
 * @returns {Promise<string|null>} - Token capturado ou null
 */
export async function capturarESalvarPushToken(supabase, motoristaId) {
    if (!motoristaId) {
        console.warn('⚠️ [PUSH TOKEN] motoristaId ausente, não irá capturar token');
        return null;
    }

    try {
        // 1️⃣ Verificar se o Service Worker está registrado
        if (!('serviceWorker' in navigator)) {
            console.warn('⚠️ [PUSH TOKEN] Service Worker não suportado');
            return null;
        }

        const registration = await navigator.serviceWorker.ready;
        if (!registration) {
            console.warn('⚠️ [PUSH TOKEN] Service Worker não registrado');
            return null;
        }

        // 2️⃣ Solicitar permissão de notificação (se ainda não foi concedida)
        const permission = await solicitarPermissaoNotificacao();
        if (permission !== 'granted') {
            console.warn('⚠️ [PUSH TOKEN] Permissão de notificação negada');
            return null;
        }

        // 3️⃣ Obter ou criar subscription usando VAPID keys
        const vapidPublicKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || 'BHT9A7tP7ounjOVO4XyvS2Dpj0hstwxw03BrvX3de_5Hsdrh0Uq7OwPXvCvTvda0k4yFNv56FfK1Ue6poAuXhME';

        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            // Criar nova subscription
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            });
            console.log('✅ [PUSH TOKEN] Nova subscription criada');
        } else {
            console.log('✅ [PUSH TOKEN] Subscription existente encontrada');
        }

        // 4️⃣ Extrair o token da subscription
        const pushToken = JSON.stringify(subscription);
        console.log('🔑 [PUSH TOKEN] Token capturado:', pushToken.substring(0, 50) + '...');

        // 5️⃣ Salvar no banco de dados Supabase
        const { error } = await supabase
            .from('motoristas')
            .update({ push_token: pushToken })
            .eq('id', motoristaId);

        if (error) {
            console.error('❌ [PUSH TOKEN] Erro ao salvar no banco:', error);
            return null;
        }

        console.log('✅ [PUSH TOKEN] Token salvo no banco de dados com sucesso!');
        return pushToken;

    } catch (error) {
        console.error('❌ [PUSH TOKEN] Erro ao capturar token:', error);
        return null;
    }
}

/**
 * Converte VAPID key de Base64 para Uint8Array
 * @param {string} base64String - Chave VAPID em base64
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
