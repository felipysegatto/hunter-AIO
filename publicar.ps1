$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$repo = 'felipysegatto/hunter-AIO'
$v = (Get-Content package.json -Raw | ConvertFrom-Json).version
if (Test-Path dist) { Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "Gerando o instalador da versao $v ..."
npm install
npm run build
if ($LASTEXITCODE -ne 0) { throw 'O build falhou.' }
$file = Get-ChildItem dist -Filter "Grimorio-Hunter-Setup-$v.exe" | Select-Object -First 1
if (-not $file) { throw "Instalador nao encontrado na pasta dist." }
$sha = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower()
$notas = @()
if (Test-Path notas.txt) { $notas = @(Get-Content notas.txt -Encoding UTF8 | Where-Object { $_.Trim() }) }
$obj = [ordered]@{
  version  = $v
  date     = (Get-Date -Format 'yyyy-MM-dd')
  file     = $file.Name
  download = "https://github.com/$repo/releases/download/v$v/$($file.Name)"
  page     = "https://github.com/$repo"
  sha256   = $sha
  size     = $file.Length
  kind     = 'setup'
  notes    = $notas
}
$text = $obj | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'latest.json'), $text, (New-Object System.Text.UTF8Encoding $false))
Write-Host ''
Write-Host "PRONTO. Agora, nesta ordem:"
Write-Host "1) No GitHub, crie uma Release com a tag v$v e anexe: dist\$($file.Name)"
Write-Host "2) Depois envie (commit e push) o arquivo latest.json que foi criado nesta pasta."
