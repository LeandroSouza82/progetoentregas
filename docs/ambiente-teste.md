# Homologação V10 — etapa 1 (17/10/2026)

Branch: `feat/roteiro-offline-seguro`. Não fazer merge, deploy de produção ou executar os scripts históricos de manutenção/diagnóstico contra produção.

## O que mudou

- Dashboard 0.1.0: configuração padrão de teste, sem URL/chave de produção como fallback.
- Ausência de configuração, projeto divergente ou chave administrativa interrompem o início do painel antes do carregamento de App e serviços.
- Teste recusa a referência do projeto de produção conhecido. A sessão de autenticação tem chave local por ambiente/projeto.
- Selecionar motorista na tabela não faz UPDATE em entregas. Selecionar, reorganizar e enviar continuam sendo passos separados. Motorista offline aprovado pode ser selecionado.
- A CI executa os testes focados e instala dependências do subprojeto motorista antes do build.

## Configurar somente o banco separado de homologação

1. Obter um projeto separado, sem dados pessoais reais, e seu esquema compatível com V10. O esquema real ainda não foi exportado: o projeto V10 não está na conexão Supabase disponível nesta sessão. Não inventar nem aplicar políticas/migrações em produção.
2. Copiar `.env.example` para `.env.local`. Preencher a referência, URL HTTPS e chave pública do mesmo projeto. Manter `VITE_APP_ENV=test`. Não usar service_role ou sb_secret.
3. Executar `npm ci`, `npm test`, `npm run dev`.
4. O painel deve mostrar “V10 Teste · Homologação · Dados de teste”. Sem configuração, mostra bloqueio e não inicia os serviços.

A verificação do cliente evita erros de configuração; não substitui RLS nem comprova isolamento do servidor. Só iniciar testes de dados depois de conferir projeto, permissões, storage e esquema. Os scripts antigos do diretório scripts/ não são certificados para homologação e não devem ser executados nesta etapa.

## Verificação local

20 testes Node passaram (12 de rotas/endereços, 8 de configuração/inicialização/seleção). Build principal e build do subprojeto motorista passaram. A inicialização foi exercitada com módulos simulados, confirmando que a configuração inválida não carrega o aplicativo; não é um teste de navegador real. O teste de seleção executa o handler realmente ligado à tabela com um cliente que lança erro em qualquer acesso ao banco. Flutter/Android e banco real ainda precisam de validação.

## Próximo trabalho

Configurar o banco isolado com esquema real; corrigir fila offline (logout, concorrência, propriedade, confirmação de escrita, foto/assinatura); homologar dois motoristas e retorno de conexão. A conclusão do fluxo completo permanece pendente.

Produção só poderá usar configuração explícita e revisada, após homologação. Esta alteração não foi mesclada nem publicada em produção.

Referência: https://supabase.com/docs/guides/deployment/managing-environments
