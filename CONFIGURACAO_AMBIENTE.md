# 🔧 Configuração do Ambiente - V10 Delivery

## 📋 Variáveis de Ambiente Necessárias

O sistema V10 Delivery requer que as variáveis de ambiente do Supabase estejam configuradas para funcionar corretamente.

### ⚠️ IMPORTANTE: Reiniciar o Terminal

**O Vite NÃO carrega arquivos `.env` em tempo real!**

Após criar ou editar o arquivo `.env.local`, você **DEVE**:

1. Parar o servidor (pressione `Ctrl+C` no terminal)
2. Executar novamente: `npm run dev`

---

## 📝 Passo a Passo

### 1. Verificar o arquivo `.env.local`

Na raiz do projeto, você deve ter um arquivo chamado `.env.local` com o seguinte conteúdo:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima-aqui
```

### 2. Obter as Credenciais do Supabase

1. Acesse: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em **Settings** → **API**
4. Copie:
   - **Project URL** → cole em `VITE_SUPABASE_URL`
   - **anon/public key** → cole em `VITE_SUPABASE_ANON_KEY`

### 3. Formato Correto

✅ **CORRETO** (prefixo `VITE_` é obrigatório):
```env
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

❌ **ERRADO** (sem o prefixo `VITE_`):
```env
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🔍 Como Verificar se Funcionou

Após reiniciar o terminal, abra o console do navegador (F12) e verifique:

### ✅ Conexão OK
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 V10 Delivery - Verificando credenciais do banco...
📋 Runtime: Vite/Browser
📋 VITE_SUPABASE_URL: ✅ Configurado
📋 VITE_SUPABASE_ANON_KEY: ✅ Configurado
✅ Credenciais OK - Conectando ao Supabase...
✅ V10 Delivery ONLINE - Conectado ao banco de dados
✅ Cliente Supabase inicializado com sucesso!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### ❌ Credenciais Ausentes
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 V10 Delivery - Verificando credenciais do banco...
📋 Runtime: Vite/Browser
📋 VITE_SUPABASE_URL: ❌ AUSENTE
📋 VITE_SUPABASE_ANON_KEY: ❌ AUSENTE
⚠️ VITE_SUPABASE_URL não definido no arquivo .env.local
💡 Dica: Crie o arquivo .env.local na raiz do projeto e adicione suas credenciais
💡 Lembre-se de REINICIAR o terminal após criar/editar o .env.local
⚠️ V10 Delivery funcionará em MODO OFFLINE (sem conexão com banco)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🚨 Problemas Comuns

### Problema 1: "AUSENTE" mesmo após criar .env.local
**Solução**: Você esqueceu de REINICIAR o terminal!
- Pressione `Ctrl+C`
- Execute `npm run dev` novamente

### Problema 2: Variáveis sem o prefixo VITE_
**Solução**: As variáveis DEVEM começar com `VITE_`:
- ✅ `VITE_SUPABASE_URL`
- ❌ `SUPABASE_URL`

### Problema 3: Arquivo .env.local na pasta errada
**Solução**: O arquivo deve estar na RAIZ do projeto:
```
c:\progetoentregas\.env.local  ✅ CORRETO
c:\progetoentregas\src\.env.local  ❌ ERRADO
```

---

## 📞 Suporte

Se os problemas persistirem:

1. Verifique se o arquivo `.env.local` está salvo
2. Confirme que você REINICIOU o terminal
3. Verifique se as credenciais estão corretas no painel do Supabase
4. Abra o console do navegador (F12) para ver mensagens detalhadas

---

**V10 Delivery** - Sistema de Gestão Logística
