# Sistema de Backup — Innova Forn Bot

Duas camadas independentes de proteção: **código** (Git + Windows) e **dados da loja** (snapshots diários dentro do próprio bot).

---

## 1. Backup do CÓDIGO

### O que roda todo dia (06:00, tarefa agendada no Windows: `InnuvaBackupDiario`)
O script `scripts/backup-diario.ps1` faz:
1. **Commita e empurra** qualquer mudança pendente para o GitHub (`main`) — o repositório é o backup principal do código
2. Gera **ZIP local** em `%USERPROFILE%\Backups\innuva-codigo\` (sem `.git`/`node_modules`)
3. **Retenção de 30 dias**: apaga zips antigos automaticamente
4. Salva o log (`backup-log.txt`) e o hash do último commit estável (`ultimo-commit-estavel.txt`)

### Como restaurar o código
```powershell
# Ver onde está o último estado bom
Get-Content "$env:USERPROFILE\Backups\innuva-codigo\ultimo-commit-estavel.txt"

cd C:\Users\sanches\Projects\innuva
git checkout <hash>   # ou: git reset --hard <hash>
git push origin main --force-with-lease   # só se precisar sobrescrever a main
```
Ou extrair um zip qualquer: `Expand-Archive innuva-codigo-20260826-0600.zip .`

---

## 2. Backup dos DADOS DA LOJA (produtos, saldos, cupons, histórico, config)

Os dados vivem no volume persistente do Fly.io (`/data/<guildId>.json`). O sistema gera snapshots em `/data/backups/<guildId>/`, **retidos por 30 dias**, sem depender do Discord para existir.

### Automático
Todo dia às **03:00 (fuso America/Sao_Paulo)** o scheduler copia os dados de cada servidor. Logs no console do Fly:
```
[backup] Rotina diaria iniciada.
[backup] <servidor>: backup-2026-08-26-0300-diario.json (4.7 KB, 12 no historico)
```

### Comandos (staff)
| Comando | Função |
|---|---|
| `/backup criar` | Snapshot imediato dos dados atuais |
| `/backup listar` | Lista snapshots salvos com tamanho e data |
| `/backup enviar [arquivo]` | Baixa um snapshot como `.json` (guarde fora do servidor!) |
| `/restaurar snapshot arquivo:<nome> confirmar:Sim` | Volta o estado de um snapshot salvo |
| `/restaurar arquivo dados:<.json> confirmar:Sim` | Restaura a partir de um `.json` enviado no chat |

### Segurança embutida no restore
- Antes de sobrescrever, o bot salva automaticamente um snapshot **prerestauração** — então até uma restauração errada é reversível
- Validação estrutural do JSON antes de aplicar
- Os cards nos canais de venda são **re-sincronizados** após restaurar
- Tudo logado no canal de logs privado, se configurado

### Cenários cobertos
| Problema | Solução |
|---|---|
| Alguém apaga produto/cupom por engano | `/restaurar snapshot` de ontem |
| Arquivo JSON corrompido | A rotina diária já guardou cópia boa |
| Volume/máquina da Fly.io perdidos | Restore com `/restaurar arquivo` usando um `.json` baixado previamente |
| Código quebrado num deploy novo | `flyctl releases rollback` + rollback do Git (camada 1) |

### Dica de rotina
Uma vez por semana rode `/backup enviar` e guarde o arquivo (pasta pessoal ou canal privado). É sua proteção se o volume inteiro sumir de uma vez.

---

## Manutenção do agendamento (Windows)
```powershell
schtasks /Query /TN InnuvaBackupDiario          # ver status
schtasks /Run /TN InnuvaBackupDiario            # rodar agora
schtasks /Change /TN InnuvaBackupDiario /ST 07:00   # trocar horário
```

## Register manual de comandos (raramente necessário)
O bot agora **auto-registra** os slash commands na inicialização usando os segredos `CLIENT_ID`/`GUILD_ID`. Se precisar forçar: `npm run register`.
