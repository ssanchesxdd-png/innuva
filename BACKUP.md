# Sistema de Backup — Innova Forn Bot

Duas camadas independentes de proteção: **código** (Git + Windows) e **dados da loja** (snapshots diários + envio na DM do dono).

> ⚠️ **Fonte única da verdade:** este repositório (`C:\Users\sanches\Projects\innuva`). A pasta antiga `Documents\Default Project` foi a origem do código até 26/08/2026 e deve ser tratada como arquivo histórico — não editar mais lá.

---

## 1. Backup do CÓDIGO

### O que roda todo dia (06:00, tarefa agendada no Windows: `InnuvaBackupDiario`)
O script `scripts/backup-diario.ps1` faz:
1. **Commita e empurra** qualquer mudança pendente para o GitHub (`main`) — o repositório é o backup principal
2. Gera **ZIP local** em `%USERPROFILE%\Backups\innuva-codigo\` (sem `.git`/`node_modules`)
3. **Retenção de 30 dias**: apaga zips antigos automaticamente
4. Salva log (`backup-log.txt`) e hash do último commit estável (`ultimo-commit-estavel.txt`)

### Como restaurar o código
```powershell
Get-Content "$env:USERPROFILE\Backups\innuva-codigo\ultimo-commit-estavel.txt"
cd C:\Users\sanches\Projects\innuva
git checkout <hash>    # ou git reset --hard <hash>
```

## 2. Backup dos DADOS DA LOJA (produtos, cupons, FAQ, receipts, config)

Dados em `/data/<guildId>.json` no volume persistente da Fly.io (**região iad**, volume `innova_data`).

### Backup diário às 03:00 (America/Sao_Paulo) faz DUAS coisas:
1. **Snapshot persistente** em `/data/backups/<guildId>/` (retido por 30 dias)
2. **Envia o `.json` na DM do dono do servidor** (fallback: canal de logs privado)

### Comandos (staff)
| Comando | Função |
|---|---|
| `/backup criar` | Snapshot imediato |
| `/backup listar` | Lista snapshots com data/tamanho |
| `/backup enviar [arquivo]` | Baixa um snapshot como `.json` |
| `/restaurar snapshot arquivo:<nome> confirmar:Sim` | Restaura snapshot salvo |
| `/restaurar arquivo dados:<.json> confirmar:Sim` | Restaura de um `.json` enviado no chat |

### Segurança embutida no restore
- Sempre salva um snapshot **prerestauração** antes de sobrescrever (erro vira reversível)
- Validação estrutural do JSON; cards re-sincronizados após restaurar; tudo logado

## 3. Deploy

```powershell
flyctl deploy -a innuva          # direto
.\scripts\deploy-fly.ps1         # preserva dados: baixa JSON -> deploy -> restaura -> reinicia
```
O `deploy-fly.ps1` (resgatado da pasta antiga) também remove machines duplicadas. Nota: com snapshots automáticos em `/data/backups/`, o passo manual dele virou redundância saudável — pode usar qualquer um dos dois.

Releases anteriores ficam guardadas na Fly.io:
```powershell
flyctl releases -a innuva --image        # lista versões
flyctl releases rollback -a innuva       # volta para a anterior
```

### Regras de ouro aprendidas em 26/08/2026
1. **Nunca deployar por cima sem confirmar que o GitHub = código em produção** — o desalinhamento entre pasta local não-versionada e repo causou perda aparente das funções novas (resolvido)
2. Estado em memória do bot (`sessaoVendaMap`, tickets abertos) sobrevive ao restore pois `store.ticket.open` persiste no JSON
3. O `generateId()` dos IDs usa timestamp — restores nunca colidem com dados novos