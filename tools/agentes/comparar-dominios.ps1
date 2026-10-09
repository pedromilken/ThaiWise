<#
  Compara os domínios com o MESMO cérebro: de cada ferramenta na MESMA pasta-mãe, a rodada mais recente desse cérebro
  (ex.: Documents\DevWise, Documents\IAWise, Documents\enemwise, Documents\Wikawise, Documents\ThaiWise) e gera
  COMPARACAO-DOMINIOS.md na pasta-mãe.

  Uso (de dentro de qualquer um dos repositórios):
    powershell -ExecutionPolicy Bypass -File tools\agentes\comparar-dominios.ps1
    powershell -ExecutionPolicy Bypass -File tools\agentes\comparar-dominios.ps1 -Cerebro "ollama:gemma3:12b"
#>
param([string]$Cerebro = "ollama:qwen3:8b")
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$mae = Split-Path -Parent $repo
$pares = @()
foreach ($n in @("DevWise", "IAWise", "enemwise", "Wikawise", "ThaiWise")) {
  $s = Join-Path $mae "$n\agentes\saida"
  if (Test-Path $s) { $pares += "$n=$s" } else { Write-Host "  $n : sem resultados em $s (fica de fora)"; continue }
  # KT ajustado (validação cruzada por aluno; sem LLM, segundos): só nas ferramentas com o núcleo multidomínio
  $lab = Join-Path $mae "$n\tools\agentes\laboratorio.js"
  if ((Test-Path $lab) -and (Test-Path (Join-Path $mae "$n\tools\agentes\adaptador.js"))) { Push-Location (Join-Path $mae $n); node tools/agentes/laboratorio.js ajustar; Pop-Location }
}
if ($pares.Count -lt 2) { Write-Host "São precisos pelo menos 2 domínios com resultados." -ForegroundColor Red; exit 1 }
# O mesmo cérebro em todos os domínios; de cada domínio vale a rodada mais recente desse cérebro
node (Join-Path $PSScriptRoot "laboratorio.js") comparar --cerebro $Cerebro --pastas ($pares -join ",") --saida (Join-Path $mae "COMPARACAO-DOMINIOS.md")
