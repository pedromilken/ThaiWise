<#
  Compara os domínios: lê a rodada mais recente (ou a indicada) de cada ferramenta que estiver na MESMA pasta-mãe
  (ex.: Documents\DevWise, Documents\IAWise, Documents\enemwise, Documents\Wikawise, Documents\ThaiWise) e gera
  COMPARACAO-DOMINIOS.md na pasta-mãe.

  Uso (de dentro de qualquer um dos repositórios):
    powershell -ExecutionPolicy Bypass -File tools\agentes\comparar-dominios.ps1
    powershell -ExecutionPolicy Bypass -File tools\agentes\comparar-dominios.ps1 -Rodada completo-2026-10-20
#>
param([string]$Rodada = "")
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$mae = Split-Path -Parent $repo
$pares = @()
foreach ($n in @("DevWise", "IAWise", "enemwise", "Wikawise", "ThaiWise")) {
  $s = Join-Path $mae "$n\agentes\saida"
  if (-not (Test-Path $s)) { Write-Host "  $n : sem resultados em $s (fica de fora)"; continue }
  $r = if ($Rodada -ne "" -and (Test-Path (Join-Path $s $Rodada))) { Join-Path $s $Rodada } else {
    (Get-ChildItem $s -Directory | Where-Object { Get-ChildItem $_.FullName -Recurse -Filter metricas.json -ErrorAction SilentlyContinue } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
  if ($r) { Write-Host "  $n : $r"; $pares += "$n=$r" }
}
if ($pares.Count -lt 2) { Write-Host "São precisos pelo menos 2 domínios com resultados." -ForegroundColor Red; exit 1 }
node (Join-Path $PSScriptRoot "laboratorio.js") comparar --pastas ($pares -join ",") --saida (Join-Path $mae "COMPARACAO-DOMINIOS.md")
