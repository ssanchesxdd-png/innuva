# deploy.ps1 — Deploy na fly.io PRESERVANDO os dados da loja
# Uso: .\deploy.ps1
# Fluxo: backup dos dados (do container vivo) -> fly deploy -> restore -> restart

$ErrorActionPreference = "Stop"
$app = "innuva"
$guildFile = "1520278367968952390.json"   # arquivo de dados do servidor
$tmp = "$env:TEMP\innova-backup"

New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function LimparDuplicatas {
  $ms = @(fly machines list --json | ConvertFrom-Json)
  if ($ms.Count -gt 1) {
    Write-Host "      ⚠ $($ms.Count) machines detectadas — mantendo a mais recente, removendo extras..." -ForegroundColor Yellow
    $ordenadas = $ms | Sort-Object -Property { [datetime]$_.created_at } -Descending
    $mantida = $ordenadas[0].id
    foreach ($extra in $ordenadas | Select-Object -Skip 1) {
      Write-Host "      destruindo duplicata $($extra.id)..." -ForegroundColor Yellow
      fly machine destroy $extra.id --force 2>$null | Out-Null
    }
    Write-Host "      machine ativa: $mantida" -ForegroundColor Green
  } else {
    Write-Host "      1 machine, sem duplicatas" -ForegroundColor Green
  }
}

Write-Host "[0/5] Verificando duplicatas pre-deploy..." -ForegroundColor Cyan
LimparDuplicatas

Write-Host "[1/5] Backup dos dados do container vivo..." -ForegroundColor Cyan
Remove-Item "$tmp\$guildFile" -Force -ErrorAction SilentlyContinue
fly ssh sftp get "/data/$guildFile" "$tmp\$guildFile" 2>$null
if (Test-Path "$tmp\$guildFile") {
  $size = (Get-Item "$tmp\$guildFile").Length
  Write-Host "      backup ok ($size bytes)" -ForegroundColor Green
} else {
  Write-Host "      sem dados no container (deploy limpo)" -ForegroundColor Yellow
}

Write-Host "[2/5] fly deploy (buildando e subindo codigo novo)..." -ForegroundColor Cyan
fly deploy --app $app --yes
if ($LASTEXITCODE -ne 0) { throw "deploy falhou" }

Write-Host "[3/5] Aguardando machine subir..." -ForegroundColor Cyan
Start-Sleep -Seconds 20

Write-Host "[4/5] Restaurando dados..." -ForegroundColor Cyan
if (Test-Path "$tmp\$guildFile") {
  # So restaura se o backup tiver conteudo real (produto ou FAQ)
  $valido = $false
  try {
    $bk = [System.IO.File]::ReadAllText("$tmp\$guildFile", [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($bk.sales.products.Count -gt 0 -or $bk.ticket.faq.Count -gt 0) { $valido = $true }
  } catch { }

  if ($valido) {
    fly ssh console --app $app -C "rm -f /data/$guildFile" 2>$null | Out-Null
    fly ssh sftp put "$tmp\$guildFile" "/data/$guildFile" 2>$null
    if ($LASTEXITCODE -ne 0) {
      $conteudo = [System.IO.File]::ReadAllText("$tmp\$guildFile", [System.Text.Encoding]::UTF8)
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($conteudo))
      fly ssh console --app $app -C "echo $b64 | base64 -d > /data/$guildFile" 2>$null | Out-Null
    }
    Write-Host "      dados restaurados (backup valido)" -ForegroundColor Green
  } else {
    Write-Host "      backup vazio — mantendo os dados atuais do container" -ForegroundColor Yellow
  }
} else {
  Write-Host "      nada a restaurar" -ForegroundColor Yellow
}

Write-Host "[5/5] Reiniciando o bot pra recarregar os dados..." -ForegroundColor Cyan
$machines = fly machines list --json | ConvertFrom-Json
foreach ($m in $machines) {
  if ($m.state -eq "started") {
    fly machine restart $m.id 2>$null | Out-Null
  }
}
Start-Sleep -Seconds 12
fly logs --no-tail 2>&1 | Select-String -Pattern "Bot online" | Select-Object -Last 1

Write-Host "[6/6] Verificando duplicatas pos-deploy..." -ForegroundColor Cyan
LimparDuplicatas
Write-Host "OK - Deploy concluido com dados preservados!" -ForegroundColor Green
