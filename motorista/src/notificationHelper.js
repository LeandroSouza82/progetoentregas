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
