# Roteiro atribuído a motorista offline — homologação

Branch: `feat/roteiro-offline-seguro`. Base: `086ff4e` (produção identificada na Vercel).
Aplicativo correspondente: `NewV10`, mesma branch de teste, base `e47eee3` (`correcao-na-home`).
Não mesclar/publicar em produção antes da validação conjunta.

## Comportamento preparado

- Cadastro pendente aparece sem depender de GPS, login ou presença; inserts e updates atualizam a lista, com consulta inicial e reconciliação a cada 30 segundos.
- Aprovação do gestor preserva IDs de texto/UUID e confere o retorno do banco.
- Apenas motoristas aprovados aparecem no despacho; offline é uma indicação, não um impedimento.
- O lote preparado fica vinculado ao motorista em `entregas`, com status `em_rota`.
- Preparação/atribuição não inclui rotas ativas de outros motoristas.
- Envio exige roteiro organizado e motorista escolhido; não substitui um roteiro vazio por outra lista.
- O retorno do banco deve conter todos os IDs esperados. Sem isso, não limpa a fila nem apresenta sucesso.
- Se outro gestor despachou parte dos pontos simultaneamente, o update pode afetar apenas os restantes. O código acusa divergência e exige atualizar a fila. O lote não é uma transação com o aviso; atomicidade completa exige RPC com esquema/RLS validados em homologação.
- Aviso persistente em `avisos_gestor` é direcionado ao motorista. Falha no aviso não desfaz o lote nem pede reenvio da rota.
- Cadastro de endereço passa pelo texto completo, sem regras de rua/número fixos, sem GPS de conclusão como memória automática e sem município padrão. O gestor confirma o resultado antes de salvar.
- Geocodificação sem endereço numerado/alta relevância é recusada. Relevância não garante acerto; conferir o destino encontrado continua necessário.
- Rotas antigas já salvas não são corrigidas retroativamente.

## Limites importantes

`NewV10` atualmente tem notificações locais, sem Firebase Messaging/configuração Android/servidor de push. O aviso fica salvo e a rota aparece na consulta inicial/ao reconectar. A notificação local pode aparecer enquanto o processo está vivo, e ao reabrir para um roteiro ainda não avisado. **Notificação com o app totalmente encerrado ainda não está implementada.**

Para essa etapa é necessário configurar FCM no aplicativo e um emissor autenticado no servidor, com tokens por motorista, autorização do gestor, retentativas e deduplicação por atribuição. Nunca colocar credencial do emissor no dashboard/aplicativo. Nenhuma tabela/migração foi aplicada no banco atual.

O banco V10 não aparece entre os projetos acessíveis pelo conector nesta sessão. Consulta somente da estrutura via chave existente retornou HTTP 401; não foram lidos registros nem escritos dados. Validar permissões de SELECT/UPDATE/INSERT e formatos dos IDs em ambiente de testes.

O app antigo continua usando o mesmo banco. A garantia de aprovação precisa também de permissões no banco e validação dos clientes antigos, a tratar separadamente. O teste do cliente novo não prova autorização no servidor.

## Testes sem banco real

`npm ci --ignore-scripts`
`npm run test:routes`
`npm run build`

Os testes exercitam aprovação, offline, seleção obrigatória, retorno parcial/vazio, outro proprietário, erro de banco e falha do aviso; geocodificação usa respostas simuladas. Não são prova de persistência em produção ou de precisão geográfica real.

## Validação conjunta

1. Cadastrar motorista novo no APK de teste. Sem abrir a home, confirmar que aparece pendente no dashboard de teste.
2. Login antes da aprovação: mensagem de espera, sem autoaprovação. Aprovar pelo gestor; confirmar uma linha atualizada.
3. Deixar o motorista offline/app fechado. Selecioná-lo, organizar uma fila pequena e enviar. Confirmar mensagem com o nome correto e conferir `motorista_id`, `status` e ordem dos IDs esperados.
4. Sem motorista escolhido: envio bloqueado, nenhum update.
5. Abrir o APK: pontos corretos aparecem na ordem definida, com aviso de novo roteiro. Reabrir: sem duplicação ou repetição do aviso do mesmo lote.
6. Cortar/restaurar internet com app aberto: confirmar que o roteiro reaparece sem precisar reenviar. Motorista B não recebe roteiro de A.
7. Conferir roteiro em_rota com criação anterior a sete dias: permanece visível; concluídos/falhas não entram na lista ativa.
8. Simular falha de UPDATE/zero linhas: erro, fila preservada. Falha só no aviso: roteiro permanece salvo, feedback informa falha do aviso.
9. Testar endereço numerado com bairro e município: Palhoça, São José e Florianópolis; rua com hífen e com número no nome. Resultado encontrado deve corresponder ao endereço antes da confirmação.
10. Comparar endereço digitado, destino encontrado, `lat/lng` salvos e pino aberto no Google Maps. Recusar resultado errado; não registrar coordenada aproximada como destino exato.
11. App completamente fechado: o recebimento do roteiro ao abrir deve funcionar. Notificação push antes de abrir permanece pendente e não deve ser declarada aprovada.
12. Capturar telas, IDs de teste, horário, versão e resultado de cada cenário, sem senhas/tokens.
