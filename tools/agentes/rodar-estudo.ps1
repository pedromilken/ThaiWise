<#
  Laboratório de agentes (núcleo multidomínio): rodada longa sem supervisão, igual à do DevWise.

  Uso (na pasta do repositório da ferramenta):
    powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase piloto
    powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase completo
    powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase completo -Cerebros "qwen3:8b,gemma3:4b,gemma3:12b,llama3.1:8b,aya-expanse:8b,granite3.3:8b"

  piloto   : 2 cérebros, 3 alunos, 2 repetições
  completo : os cérebros pedidos, 5 alunos, 3 repetições (o mesmo desenho do painel do DevWise)
  -Controle: para o domínio-controle (o ENEM): a triagem não exige habilidades com degrau
  -Idiomas "pt,en,es": idiomas do estudo; os textos que a ferramenta não tem são traduzidos antes (cache em tools\agentes\idiomas)

  Se parar no meio, rode o MESMO comando com a mesma -Rodada: o que já foi feito é retomado do disco.
#>
param(
  [ValidateSet("piloto", "completo")][string]$Fase = "piloto",
  [string]$Rodada = "",
  [string]$Cerebros = "qwen3:8b,gemma3:4b",
  [string]$Apis = "",         # ex.: "deepseek:deepseek-chat" (roda depois dos locais, com chamadas em paralelo)
  [switch]$Controle,          # domínio-CONTROLE (ex.: ENEM): a triagem não exige degrau; legibilidade e acerto continuam valendo
  [string]$Idiomas = "",      # ex.: "pt,en,es" (vazio = os idiomas da ferramenta)
  [string]$Tradutor = "deepseek:deepseek-v4-pro"   # preenche o cache de tradução dos idiomas pedidos (uma vez; depois não gasta nada)
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
if ($Rodada -eq "") { $Rodada = "$Fase-" + (Get-Date -Format "yyyy-MM-dd") }

# 0. Dependências do laboratório (só o IAWise precisa: jsdom para montar os simuladores)
if ((Test-Path "tools\agentes\package.json") -and -not (Test-Path "tools\agentes\node_modules")) { Write-Host "Instalando dependências do laboratório..."; npm install --prefix tools\agentes --no-audit --no-fund }

# 1. Ollama: no caminho padrão ou no PATH
$ollama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollama)) {
  $c = Get-Command ollama -ErrorAction SilentlyContinue
  if ($c) { $ollama = $c.Source } elseif ($Cerebros -ne "") { Write-Host "Ollama não encontrado. Instale com: winget install Ollama.Ollama" -ForegroundColor Red; exit 1 }
}
$specs = @()
if ($Cerebros -ne "") {
  $lista = & $ollama list 2>$null | Out-String
  foreach ($m in $Cerebros.Split(",")) { if ($lista -notmatch [regex]::Escape($m)) { Write-Host "Baixando $m ..."; & $ollama pull $m }; $specs += "ollama:$m" }
}

# 2. Impede o Windows de hibernar enquanto esta janela estiver rodando
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[Win32.Power]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null

$alunos = if ($Fase -eq "piloto") { 3 } else { 5 }
$reps = if ($Fase -eq "piloto") { 2 } else { 3 }
$papel = if ($Controle) { "controle" } else { "estudo" }
$extra = @(); if ($Idiomas -ne "") { $extra = @("--idiomas", $Idiomas) }
# Traduções que faltarem (o "en" das ferramentas também tem textos só em português): uma vez, com cache versionado
if ($Idiomas -ne "") { foreach ($l in $Idiomas.Split(",")) { if ($l -ne "pt") {
  node tools/agentes/laboratorio.js traduzir --idioma $l --cerebro $Tradutor --paralelo 8
  if ($LASTEXITCODE -ne 0) { Write-Host "A tradução de '$l' não ficou completa. Rode de novo o mesmo comando (o que já foi traduzido fica no cache)." -ForegroundColor Yellow; exit 1 } } } }
$inicio = Get-Date
node tools/agentes/laboratorio.js info
Write-Host "`nRodada '$Rodada' | fase $Fase | cérebros $Cerebros $Apis" -ForegroundColor Cyan
Write-Host "Pode deixar rodando. O Windows não vai hibernar enquanto esta janela estiver aberta.`n"
$ok = $true
try {
  foreach ($s in $specs) {
    node tools/agentes/laboratorio.js triagem --cerebro $s --rodada $Rodada --papel $papel @extra
    if ($LASTEXITCODE -eq 2) { Write-Host "  $s reprovado na triagem (critérios fixados antes); segue para o próximo." -ForegroundColor Yellow; continue }
    node tools/agentes/laboratorio.js piloto --cerebro $s --alunos $alunos --repeticoes $reps --rodada $Rodada --papel $papel @extra
    if ($LASTEXITCODE -ne 0) { $ok = $false; break }
  }
  if ($ok -and $Apis -ne "") { foreach ($s in $Apis.Split(",")) {
    node tools/agentes/laboratorio.js piloto --cerebro $s --alunos $alunos --repeticoes $reps --rodada $Rodada --paralelo 8 --papel $papel @extra
    if ($LASTEXITCODE -ne 0) { $ok = $false; break } } }
} finally { [Win32.Power]::SetThreadExecutionState([uint32]"0x80000000") | Out-Null }

if (-not $ok) {
  Write-Host "`nA rodada parou antes do fim. Para continuar de onde parou:" -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase $Fase -Rodada $Rodada -Cerebros `"$Cerebros`""
  exit 1
}
node tools/agentes/laboratorio.js consolidar --rodada $Rodada
$nome = Split-Path -Leaf $repo
$zip = Join-Path (Split-Path -Parent $repo) "resultado-$nome-$Rodada.zip"
Compress-Archive -Path "agentes\saida\$Rodada" -DestinationPath $zip -Force
$dur = (Get-Date) - $inicio
Write-Host ("`nConcluído em {0:N1} h. Envie este arquivo: {1}" -f $dur.TotalHours, $zip) -ForegroundColor Green
