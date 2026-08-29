$env:MAESTRI_PIPE = '\\.\pipe\maestri-a639e3fc'

$prompt = @'
Tarefa: analisar os logs do bot Discord hospedado no Fly.io e encontrar o erro da feature nova de boas-vindas.

Contexto:
- App no Fly.io: innuva
- Acabamos de fazer deploy (as 01:03 UTC) de uma feature nova: mensagem de boas-vindas quando um membro entra no servidor (codigo em src/handlers/roles.js, funcao enviarBoasVindas).
- A feature contem UM ERRO PROPOSITAL que sera disparado quando alguem entrar no servidor. O dono do servidor vai testar agora.

Passos:
1. Rode: fly logs -a innuva --no-tail
   (use apenas comandos nao-interativos; se precisar filtrar: fly logs -a innuva --no-tail | Select-String -Pattern "boas-vindas" )
2. Procure por linhas com [boas-vindas] ou "Erro ao enviar mensagem de boas-vindas" com timestamp DEPOIS de 2026-08-29T01:03:00Z. Se ainda nao houver nada, aguarde ~30 segundos e rode de novo (tente por uns 5 minutos no maximo).
3. Identifique: qual o erro exato (mensagem da excecao), em qual arquivo/funcao acontece, e qual a causa raiz provavel.

Quando terminar, responda de volta com:
maestri ask "Shell #2" "<resumo: erro exato + arquivo/funcao + causa raiz>"
'@

maestri ask 'Shell #3' $prompt