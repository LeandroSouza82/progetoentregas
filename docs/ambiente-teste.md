# Rotas offline — testes identificados no banco atual

Branch ativa: `feat/roteiro-offline-testes-identificados`. Dashboard 0.2.0, aplicativo correspondente 1.1.4+5.

O usuário autorizou testes no banco compartilhado em 17/10/2026. Não criar outro projeto, mudar esquema/RLS/autenticação ou publicar em produção nesta etapa. Todas as operações de teste devem ter identificação visível TESTE.

## Configuração do painel

Copiar `.env.shared-test.example` para `.env.local`. Preencher a chave pública do mesmo projeto e o UUID de um motorista dedicado com nome começando por `TESTE V10 - `. Usar `VITE_APP_ENV=shared-test` explicitamente. Arquivos locais não devem ser versionados.

O painel mostra a faixa “Banco compartilhado · Somente cards TESTE V10”. Cards criados recebem automaticamente o prefixo `TESTE V10 - ` no nome e aviso de que não devem ser executados. Leituras, alterações e exclusões de cards recebem filtro por esse prefixo. Alterar/excluir exige IDs explícitos. Presença/aprovação do motorista fica limitada ao ID de teste e ao nome TESTE. Escritas em outras tabelas e RPCs de manutenção não fazem parte desse modo.

Isso é uma restrição do cliente de teste, não uma política do servidor. O aplicativo e o dashboard publicados não foram alterados. Nenhuma garantia de risco zero é feita.

## Resultado verificado em 17/10/2026

- 27 testes Node passaram (serviços, configuração, inicialização, seleção, filtros e integração do SDK com servidor simulado).
- Build principal passou.
- Teste real via Supabase JS no banco atual: cards 2196 e 2197, nomes `TESTE V10 - Teste 1 - 20261017` e `TESTE V10 - Teste 2 - 20261017`, foram atribuídos ao motorista `TESTE V10 - Motorista offline 20261017` enquanto `esta_online=false`.
- Novos clientes recuperaram os mesmos dois pontos em ordem, sem reenvio/duplicação. Consulta com outro motorista não retornou esses pontos.
- UPDATE de controle fora do prefixo aceito afetou zero linhas; o card de controle permaneceu pendente e sem motorista. Esse controle (ID 2198, também claramente TESTE) foi removido por ID/nome exatos depois da verificação.
- As 1.441 entregas sem nome TESTE tiveram a mesma assinatura de conteúdo antes/depois da execução. Não houve escrita de nossa execução nos motoristas reais; a assinatura geral deles variou durante a janela, compatível com alterações concorrentes da operação, portanto não afirmamos identidade total desses registros.

Os dois cards de rota e o motorista de teste foram preservados para a validação no celular. Nenhuma senha de motorista real foi lida. O usuário de teste tem credencial aleatória de teste, não uma credencial de produção reutilizada.

## Fluxo de envio

O gestor seleciona o motorista aprovado, organiza os IDs e envia. O serviço exige retorno de todos os IDs persistidos em `entregas`, com status `em_rota` e vínculo ao motorista. Estar online não é condição para envio. O app consulta ao abrir/reconectar e produz aviso local a partir dos pontos novos.

A tabela `avisos_gestor` usa motorista_id bigint, enquanto o cadastro usa UUID. O despacho desta branch usa o roteiro persistido como fonte e não grava UUID nessa coluna legada. Nenhuma migração foi aplicada. Avisos gerais antigos não são alterados por essa mudança.

## Reprodução controlada

`scripts/test-shared-route.mjs ARQUIVO_LOCAL.json` usa a configuração VITE do modo shared-test, `deliveryIds` (no máximo 5 IDs novos de teste, pendentes sem motorista) e `controlId` de um card de controle também TESTE mas fora do prefixo exato. Não executar com cards operacionais nem reutilizar os IDs já enviados como se estivessem pendentes. O script valida o escopo antes de gravar e não é uma rotina de limpeza.

Para excluir dados deste teste, conferir os nomes e usar somente os IDs exatos criados. Não usar DELETE por status, motorista ou por uma palavra genérica.

## Pendências

Teste físico de abrir/reabrir/retornar da falta de internet no V10 Teste; interface completa do gestor; assinatura offline, concorrência da fila e preservação de pendências ao sair. Push com o processo encerrado continua pendente. O teste do SDK/banco não substitui a homologação no celular. Manter PR em rascunho, sem merge/publicação até aprovação.
