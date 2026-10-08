# Laboratório de agentes multidomínio (tese STUDx)

O mesmo protocolo do laboratório do DevWise, agora em **IAWise, ENEMWise, Wikawise e ThaiWise**, para ver como os modelos de KT se comportam em áreas de conhecimento diferentes.

Agente = **cérebro** (um LLM) + **base de conhecimento** (as notas que ele "estudou": o material da própria ferramenta).

| Condição | Notas | Para que serve |
|---|---|---|
| C0 | nenhuma | **vazamento**: o quanto o cérebro já sabe do domínio |
| C1 | as da habilidade | sem aprendizagem durante a partida |
| C2 | chegam depois do 3º item de cada habilidade (2º no IAWise) | degrau de aprendizagem num instante **conhecido**; partida adaptativa e fixa |
| C3 | C2 embaralhado | queda de AUC quando a ordem é destruída (não gasta chamadas) |

## Por que um núcleo único

`laboratorio.js` e `kt-canonico.js` são **idênticos nos quatro repositórios**; só `adaptador.js` muda. O código de KT é a cópia literal de `DevWise/src/models.js` (Elo/Rasch, TRI 3PL-EAP, BKT, PFA, AFM). Para comparar a temperatura de cinco salas o termômetro tem de ser o mesmo: se cada ferramenta usasse o seu KT, uma diferença entre domínios poderia ser só diferença de implementação.

## O que muda de um domínio para outro (o adaptador)

| Ferramenta | Item | Notas (o que o agente estudou) | Habilidade |
|---|---|---|---|
| **IAWise** | tarefa num **simulador real** (montado sem navegador); o agente age por comandos `SET`, `CHOOSE`, `CLICK`, `TOGGLE`, `CHECK` e o `check()` do próprio simulador corrige | 3 conceitos da aula + dicas das outras tarefas da fase | a aula (28) |
| **ENEMWise** | questão real do ENEM (só texto por padrão) com gabarito oficial | descritor da habilidade da Matriz + 4 questões resolvidas da mesma habilidade | área + habilidade (ex.: MT-H21) |
| **Wikawise** | item do jogo (ler, pinyin, traduzir, escrita em múltipla escolha, lacuna, ordenar, diálogo) com as opções e o gabarito do motor | lista de palavras da unidade, pontos de gramática, estruturas da aula | unidade, nível de gramática ou aula |
| **ThaiWise** | item do jogo (classe, som, vogal, tom, viva/morta, ler, romanização, montar palavra, lacuna, cena cultural, fala do FSI) | Arsenal de escrita + tabela da unidade, vocabulário, lição do FSI, gramática, cultura | unidade, nível de gramática ou de cultura |

Ficam de fora os itens de áudio e microfone. A escolha adaptativa usa o `pick()` do próprio Wikawise e ThaiWise; no IAWise e no ENEMWise, o item de dificuldade mais próxima do alvo do Elo.

## Regime de cada habilidade: medido, não declarado

Só o DevWise tem um degrau **construído** (o dialeto cifrado). Aqui o degrau é o que as notas ensinam, e cada habilidade é classificada pelo Δ medido (C1 − C0) com IC 95% entre os itens, por regra fixada antes dos resultados:

- **degrau**: o IC fica todo acima de zero e Δ ≥ 0,10 → excesso = ganho previsto − ganho verdadeiro;
- **plano**: o IC contém zero e |Δ| < 0,10 → ganho previsto é **alarme falso** (aprendizagem fantasma);
- intermediário: o resto.

Com ~10 itens por habilidade não há poder para provar que Δ é zero; por isso "plano" quer dizer "sem degrau detectável e pequeno". O cérebro `aleatorio` (que não aprende nada) é a checagem: quase todas as habilidades dele saem planas.

A métrica central não depende do regime: **viés de ganho** = ganho previsto − ganho verdadeiro em todas as habilidades.

## Uso

    node tools/agentes/laboratorio.js info                                  (itens, habilidades e um exemplo com notas)
    node tools/agentes/laboratorio.js piloto --cerebro simulado             (sem LLM: testa o encanamento)
    node tools/agentes/laboratorio.js calibrar --cerebro ollama:qwen3:8b
    node tools/agentes/laboratorio.js triagem  --cerebro ollama:qwen3:8b
    node tools/agentes/laboratorio.js piloto   --cerebro ollama:qwen3:8b --alunos 5 --repeticoes 3 --rodada completo
    node tools/agentes/laboratorio.js consolidar --rodada completo

Rodada longa sem supervisão (Windows, baixa os modelos, impede hibernar, triagem antes de cada cérebro, consolida e compacta):

    powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase piloto
    powershell -ExecutionPolicy Bypass -File tools\agentes\rodar-estudo.ps1 -Fase completo -Cerebros "qwen3:8b,gemma3:4b,gemma3:12b,llama3.1:8b,aya-expanse:8b,granite3.3:8b"

**IAWise**: uma vez, `npm install --prefix tools/agentes` (o jsdom monta os simuladores; o script já faz isso).

Opções: `--habilidades a,b,c` · `--itens N` por habilidade · `--partida adaptativa|fixa|ambas` · `--tickets 60` · `--porhab 10` · `--tutor 4` · `--semente studx` · `--paralelo 8` (API) · `--turnos 6` (IAWise) · `--dificuldade inep` e `--figuras descricao` (ENEMWise).

Linha de base sem LLM: `--cerebro aleatorio` responde ao acaso (no IAWise, comandos sorteados nos simuladores). Dá o chute real de cada domínio (o parâmetro c dos modelos) e roda em minutos.

Mesmas garantias do DevWise: semente fixa (a mesma rodada refeita dá os mesmos arquivos), retomada por idioma, 3 tentativas por chamada e aborto só após 10 falhas seguidas, triagem com critérios fixados antes dos resultados (≥ 90% legíveis, acerto com notas ≥ 0,30, pelo menos 2 habilidades com degrau).

## Domínio-controle (ENEM)

Com notas que não ensinam (a habilidade da Matriz e questões resolvidas de outros itens), o ENEM tende a não ter degrau: é o papel de **controle**, como engenharia de software no DevWise e o próprio ENEM no artigo dos confundidores. Nele só se mede alarme falso. Rode com `-Controle` (ou `--papel controle`): a triagem deixa de exigir degrau, mas continua exigindo legibilidade e acerto com notas; o papel fica gravado e aparece na comparação.

## Comparar os domínios

Com as pastas dos repositórios lado a lado (ex.: `Documents\DevWise`, `Documents\IAWise`, ...):

    powershell -ExecutionPolicy Bypass -File tools\agentes\comparar-dominios.ps1

ou, à mão: `node tools/agentes/laboratorio.js comparar --pastas DevWise=..\DevWise\agentes\saida\completo,IAWise=agentes\saida\completo,...`

A comparação usa **o mesmo cérebro em todos os domínios** (padrão `ollama:qwen3:8b`; outro com `-Cerebro`) e, de cada domínio, a rodada mais recente dele. Cérebros de teste (`simulado`, `aleatorio`) ficam de fora, a não ser que sejam pedidos; domínios sem o cérebro pedido aparecem num aviso no topo.

Gera `COMPARACAO-DOMINIOS.md`: vazamento por domínio, viés de ganho, alarme falso, excesso no degrau, Brier, AUC e queda C3 por domínio × modelo; **W de Kendall entre domínios** (a ordem dos modelos depende da área?); e se o achado do DevWise (AFM e PFA inventam aprendizagem) se repete em cada domínio. A rodada do DevWise entra como está (engenharia de software → plano; programação com dialeto → degrau).

## Saída

`agentes/saida/<rodada>/<cérebro>/`: `medicao.csv` (C0/C1), `jogo.csv` (partida adaptativa, com previsões online e de replay), `jogo-fixo.csv`, `tutores.jsonl`, `metricas.json` (unidades idioma × aluno), `RESUMO.md`.

## Limites

Agentes não cansam, não esquecem e já sabem muito do domínio (a C0 mede isso, e é diferente em cada domínio: mandarim e ENEM estão muito mais presentes no treino dos LLMs do que tailandês ou os simuladores do IAWise). O laboratório valida **instrumentos de medida**; não substitui aprendizes reais. Com um único cérebro, diferença entre domínios mistura domínio e par cérebro × domínio: o painel de cérebros separa as duas coisas.
