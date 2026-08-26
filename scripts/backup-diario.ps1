# scripts/backup-diario.ps1
# Backup diario do CODIGO do bot Innova Forn:
#   1) Commita e empurra qualquer alteracao pendente para o GitHub
#   2) Cria um snapshot ZIP local do codigo em <Destino>
#   3) Apaga zips com mais de -ManterDias dias
#   4) Registra tudo em backup-log.txt e guarda o hash do ultimo commit estavel
#
# Agendado via Task Scheduler ("InnuvaBackupDiario"). Para rodar manualmente:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-diario.ps1

param(
  [string]$RepoPath = 'C:\Users\sanches\Projects\innuva',
  [string]$Destino  = "$env:USERPROFILE\Backups\innuva-codigo",
  [int]$ManterDias  = 30
)

$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'   # nunca travar pedindo senha no agendador

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$logFile = Join-Path $Destino 'backup-log.txt'

function Log($msg) {
  $linha = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $linha
  Add-Content -Path $logFile -Value $linha
}

Log '=== Backup diario do codigo (innuva) ==='

if (-not (Test-Path (Join-Path $RepoPath '.git'))) {
  Log "ERRO: repositorio git nao encontrado em '$RepoPath'"
  exit 1
}

Push-Location $RepoPath
try {
  # ---- 1) GitHub: o proprio repositorio e o backup principal ----
  $sujo = @(git status --porcelain)
  if ($sujo.Count -gt 0) {
    $mensagem = "backup diario automatico: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    Log ("Commitando {0} arquivo(s) alterado(s)..." -f $sujo.Count)
    git add -A | Out-Null
    git commit -m $mensagem | Out-Null | Out-String | ForEach-Object { $_.Trim() } | Out-Null
  } else {
    Log 'Nenhuma mudanca local desde o ultimo commit.'
  }

  git push origin main *> $null
  if ($LASTEXITCODE -eq 0) {
    Log 'Push para o GitHub OK (main sincronizada).'
  } else {
    Log "AVISO: push falhou (exit code $LASTEXITCODE). Verificar credenciais do Git."
  }

  # Guarda o ponto exato de restauracao
  $hash = (git rev-parse HEAD).Trim()
  Set-Content -Path (Join-Path $Destino 'ultimo-commit-estavel.txt') -Value $hash -NoNewline
  Log "Ponto de restauracao do codigo: $hash"

  # ---- 2) Snapshot ZIP local (sem .git nem node_modules) ----
  $zip = Join-Path $Destino ("innuva-codigo-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
  tar -a -cf $zip --exclude '.git' --exclude 'node_modules' -C $RepoPath .
  if ($LASTEXITCODE -eq 0 -and (Test-Path $zip)) {
    $tamanhoMB = [math]::Round((Get-Item $zip).Length / 1MB, 2)
    Log ("ZIP criado: {0} ({1} MB)" -f $zip, $tamanhoMB)
  } else {
    Log 'ERRO: falha ao criar o snapshot ZIP.'
  }

  # ---- 3) Retencao: apaga zips antigos ----
  $limite = (Get-Date).AddDays(-$ManterDias)
  Get-ChildItem -Path $Destino -Filter 'innuva-codigo-*.zip' |
    Where-Object { $_.LastWriteTime -lt $limite } |
    ForEach-Object {
      Log ("Removido zip antigo (> {0} dias): {1}" -f $ManterDias, $_.Name)
      Remove-Item $_.FullName -Force
    }

  Log ('=== Fim OK ===')
  exit 0
}
catch {
  Log ("ERRO inesperado: {0}" -f $_.Exception.Message)
  exit 2
}
finally {
  Pop-Location
}