# 📱 Sistema de Notificações Push - Documentação

## ✅ Implementado

### 1. Service Worker (`motorista/public/service-worker.js`)
- Registra cache para assets offline
- Gerencia notificações do sistema
- Intercepta cliques em notificações
- Suporta ações personalizadas (Abrir/Fechar)

### 2. Notification Helper (`motorista/src/notificationHelper.js`)
- `enviarNotificacaoSW()` - Envia notificação via Service Worker
- `isServiceWorkerActive()` - Verifica se SW está ativo
- `solicitarPermissaoNotificacao()` - Solicita permissão ao usuário

### 3. Integração com Supabase Realtime
- Gestor subscreve ao canal antes de enviar (evita fallback mode)
- Motorista recebe via broadcast e mostra notificação
- Fallback automático: Service Worker → Notification API

## 🔔 Como Funciona

### Fluxo de Notificação:
```
GESTOR APP                    SUPABASE REALTIME              MOTORISTA APP
    │                                │                              │
    │   1. Cria canal                │                              │
    │   2. Subscribe()               │                              │
    ├──────────────────────────────►│                              │
    │   3. channel.send()            │                              │
    ├──────────────────────────────►│                              │
    │                                │   4. broadcast event          │
    │                                ├─────────────────────────────►│
    │                                │                              │   5. Service Worker
    │                                │                              │   showNotification()
    │                                │                              ├──► 🔔 TELA BLOQUEADA
```

### Estados da Notificação:

1. **App Aberto**: Service Worker exibe notificação imediata
2. **App em Background**: Service Worker continua exibindo
3. **App Fechado**: ⚠️ Limitação atual (veja abaixo)

## ⚠️ Limitações Atuais

### App Completamente Fechado
O Supabase Realtime usa **WebSockets**, que requerem conexão ativa. Quando o app está completamente fechado:
- ❌ WebSocket desconecta
- ❌ Não recebe eventos broadcast
- ❌ Notificações não chegam

### Solução para App Fechado (Futuro)
Implementar um servidor push dedicado:

1. **Firebase Cloud Messaging (FCM)** - Recomendado
   - Suporta Web Push API
   - Agenda notificações mesmo com app fechado
   - Integração com Supabase via Edge Functions

2. **OneSignal** - Alternativa
   - SDK simplificado
   - Dashboard de gestão
   - Segmentação de usuários

3. **Web Push Protocol (Manual)**
   - Requer servidor VAPID
   - Mais controle, mais complexidade

## 📋 Como Testar

### 1. Permissão de Notificação
- Abrir app motorista
- Permitir notificações quando solicitado
- Verificar console: `✅ Service Worker registrado com sucesso`

### 2. Enviar Notificação Push (Gestor)
- Abrir painel de gestor
- Ir em "Comunicado aos Motoristas"
- Digitar mensagem e clicar em "Enviar Push"
- Verificar console: `🔌 Canal avisos-push subscrito com sucesso`

### 3. Receber Notificação (Motorista)
- Com app **aberto**: Notificação aparece imediatamente
- Com app **em background** (aba inativa): Service Worker exibe
- Com app **fechado**: ⚠️ Não funciona (limitação WebSocket)

### 4. Clicar na Notificação
- Ação "Abrir app": Foca na aba ou abre nova
- Ação "Fechar": Fecha a notificação

## 🔧 Configuração no Vercel

### Arquivo `vercel.json` (Motorista)
```json
{
  "headers": [
    {
      "source": "/service-worker.js",
      "headers": [
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    }
  ]
}
```

### Build Settings
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## 🚀 Próximos Passos (Futuro)

### Fase 1: FCM Básico
- [ ] Criar projeto Firebase
- [ ] Gerar VAPID keys
- [ ] Implementar FCM SDK no motorista app
- [ ] Criar Edge Function para enviar via FCM

### Fase 2: Backend de Push
- [ ] Supabase Edge Function que escuta `avisos_gestor` INSERT
- [ ] Trigger no Postgres para chamar Edge Function
- [ ] Edge Function envia push via FCM para todos os tokens

### Fase 3: Gestão de Tokens
- [ ] Salvar FCM tokens no banco (tabela `push_tokens`)
- [ ] Atualizar tokens quando motorista logar
- [ ] Remover tokens expirados

### Fase 4: Analytics
- [ ] Rastrear taxa de entrega de notificações
- [ ] Logs de abertura/click
- [ ] Dashboard de engajamento

## 📖 Recursos

- [Web Push API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Service Worker - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging/js/client)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)

---

**Atualizado:** 2024-01-XX
**Versão:** 1.0.0
**Autor:** Equipe V10 Delivery
