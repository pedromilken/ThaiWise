# ThaiWise

Treino adaptativo de **tailandês**: escrita e regra dos tons, vocabulário e gramática por nível **CEFR alinhado ao CU-TFL**, lições do **FSI Thai Basic Course**, romanização **Paiboon+ e RTGS** e *knowledge tracing*. Da mesma família do [ENEMWise](https://github.com/pedromilken/enemwise), do [DevWise](https://github.com/pedromilken/DevWise) e do [Wikawise](https://github.com/pedromilken/Wikawise): mesmo motor de rastreamento, mesma economia de XP, mesmo tutor com chave própria.

**Usar:** https://pedromilken.github.io/ThaiWise/ (depois de ativar o GitHub Pages na branch `main`, pasta raiz).

## O que tem dentro

| Conteúdo | Origem | Quantidade |
|---|---|---|
| Módulo 0: escrita e tons | autoral | 44 consoantes (3 classes, nome acrofônico, som inicial e final), 28 vogais curtas e longas, 46 sílabas de treino de tom |
| Vocabulário temático | autoral, por tema | A1 e A2: 501 palavras em 20 unidades · C1: 153 palavras em 8 unidades (registro formal) · C2: 108 palavras em 6 unidades (linguagem real, monástica, provérbios, คำซ้อน, diplomacia, literatura) |
| Gramática | autoral, com analogia, exemplo, Paiboon+, 2 lacunas e 1 frase por ponto | **92 pontos** em todos os níveis (A1 22 · A2 20 · B1 12 · B2 13 · C1 13 · C2 12), 177 lacunas, 92 frases para montar |
| Cultura | pontos marcados com “Cultura:” dentro da gramática | nomes e apelidos, parentesco como pronome, escada da polidez, เกรงใจ e o “não” indireto, pronomes por contexto, títulos, o wai, partículas de gênero, agradecer e desculpar, tabus, interjeições; e no C2 ราชาศัพท์, linguagem monástica, verbos de morte por hierarquia |
| Lições do FSI | FSI Thai Basic Course (Foreign Service Institute, domínio público), convertidas para escrita tailandesa | **40 de 40**: diálogos, vocabulário e notas de gramática (A1–B2) |
| Cultura em prática | autoral | 48 cenas (8 por nível) com etiquetas de lugar, relação e registro |
| Total | | **1.585 palavras**, 82 unidades, 6.969 testes automáticos |

## Qualidade da pronúncia

O OCR do FSI perdeu quase todas as marcas de tom, então três camadas conferem cada palavra:

- `tools/fsi-conferir.js` converte a transcrição Haas do livro para Paiboon+ por regra e compara consoantes, vogais e tons;
- `tools/tom-auditar.py` recalcula o tom de toda palavra de uma sílaba a partir da escrita tailandesa (classe + sílaba viva/morta + marca) e aponta divergências; empréstimos irregulares (เทป, แฟลต, เมตร, แบงก์…) ficam numa lista de exceções;
- `tools/nivel-conferir.js` valida os níveis autorais (formato, Paiboon+, duplicatas entre níveis).

## Cultura em prática e *knowledge tracing* contextual

Cada módulo de A1 a C2 tem a aba **Cultura**: 48 cenas (8 por nível) em que o aluno lê a situação — quem fala, com quem, onde — e escolhe a forma adequada (pronome, partícula, título, gesto, registro, provérbio). As cenas ficam em `tools/fontes/cultura.json`.

- **Habilidade própria por nível** (`c1`…`c6`) e **dimensão própria** (`pragma`), separadas da gramática: errar ครับ/ค่ะ não derruba o domínio de classificadores, e vice-versa.
- **Etiquetas de contexto** em toda cena: `lugar` (mercado, escritório, templo, palácio…), `relacao` (mais velho, mais novo, superior, monge, realeza…) e `registro` (informal → cerimonial). Cada etiqueta tem seu próprio rastreador (`S.dims["ctx:lugar=templo"]`), e o Relatório mostra a tabela **Cultura por contexto**.
- Cada resposta é registrada no log com as etiquetas (`ctx`), o que permite estudar **transferência pragmática entre contextos** (o acerto no mercado se mantém no escritório?) a partir do JSON exportado.
- O `build_data.py` rejeita etiqueta sem tradução, e o `tom-auditar.py` confere também os tokens das cenas.

## Níveis: CEFR alinhado ao CU-TFL

O exame de referência para estrangeiros é o **CU-TFL** (Sirindhorn Thai Language Institute, Chulalongkorn), que tem cinco níveis e descreve competências, sem publicar listas de vocabulário. O ThaiWise usa seis níveis CEFR com este **alinhamento pedagógico próprio** (não é uma tabela oficial):

| ThaiWise | CU-TFL | Lições do FSI |
|---|---|---|
| Módulo 0 · Escrita e tons | — | — |
| A1 | Chula Novice | 1–10 |
| A2 | Chula Novice (alto) | 11–20 |
| B1 | Chula Intermediate | 21–30 |
| B2 | Chula Advanced | 31–40 |
| C1 | Chula Superior | — (autoral) |
| C2 | Chula Distinguished | — (autoral) |

Cada nível tem duas trilhas no mapa: **unidades temáticas** (autorais) e **lições do FSI**. Os módulos do Arsenal têm todos as mesmas abas: Teoria, Praticar, Vocabulário, Lições FSI e Material de apoio. O módulo 0 tem Escrita, Teoria, Praticar e Material de apoio.

## Escrita e tons

O tom tailandês é **calculado**: classe da consoante inicial (média, alta, baixa) + sílaba viva ou morta (e a duração da vogal, na morta) + marca de tom. O módulo 0 ensina a regra e o feedback de cada exercício mostra o cálculo (“classe baixa + morta (longa) + sem marca → tom descendente”). O `build_data.py` confere a regra contra o tom anotado em todas as sílabas de treino e para o build se alguma divergir.

## Romanização

- **Paiboon+** é a fonte única: marca tom (à baixo, â descendente, á alto, ǎ ascendente), duração (vogal dobrada) e aspiração (bp, dt sem aspiração). Cada sílaba aparece na cor do seu tom.
- **RTGS** (oficial, das placas) é **derivado do Paiboon+ por regra**: tira tom e duração, escreve ph/th/kh e ue/ae/o/oe. Assim as duas nunca divergem.
- Em **Ajustes**: Paiboon+, RTGS, ambas ou nenhuma (só escrita tailandesa), e as cores dos tons podem ser desligadas.

## Habilidades e exercícios

| Habilidade | Exercícios |
|---|---|
| Ler | palavra → significado; som inicial e final da consoante; leitura da vogal; diálogo do FSI |
| Tom | pronúncia (distratores com tom ou duração trocados); classe da consoante; sílaba viva ou morta; qual o tom |
| Escrever | montar a palavra com peças (vogais e marcas já presas à consoante); escolher a letra pelo nome |
| Traduzir | significado → palavra; montar a frase |
| Ouvir | ouvir e escolher (voz tailandesa do sistema; sem voz, fica oculto) |
| Falar | reconhecimento de fala `th-TH` (Chrome e Edge) |
| Gramática | autoral, com analogia, exemplo, Paiboon+, 2 lacunas e 1 frase por ponto | **92 pontos** em todos os níveis (A1 22 · A2 20 · B1 12 · B2 13 · C1 13 · C2 12), 177 lacunas, 92 frases para montar |
| Cultura | pontos marcados com “Cultura:” dentro da gramática | nomes e apelidos, parentesco como pronome, escada da polidez, เกรงใจ e o “não” indireto, pronomes por contexto, títulos, o wai, partículas de gênero, agradecer e desculpar, tabus, interjeições; e no C2 ราชาศัพท์, linguagem monástica, verbos de morte por hierarquia |

## Rastreamento e jogo (herdados do Wikawise)

Elo/Rasch pilota (60% libera, 85% domina); TRI 3PL, BKT, PFA e AFM rodam como sombras e registram a previsão antes de cada resposta. Prior hierárquico, domínio por unidade e por habilidade em cada nível, seleção adaptativa em dois passos, XP, modos, loja, modo livre e relatório imprimível e exportável em JSON (formato longo de KT, com `preds`, `dim`, `type`, `rom`, `free`).

## Lições do FSI com o Qwen (traga sua própria assinatura)

O FSI Thai Basic Course está em **domínio público**, mas usa só transcrição (sistema Haas), sem escrita tailandesa. O OCR dos dois volumes já está em `tools/fsi/ocr/`. A conversão é feita **dentro do Qwen Code**, lição por lição, como no Wikawise (o Token Plan não pode ser usado em scripts em lote):

```powershell
node tools/fsi-preparar.js          # fatia o OCR em tools/fsi/licoes/licao-NN.txt + glossario.txt (não chama API)
qwen                                # no Qwen Code: "siga tools/TAREFA-FSI.md para a licao-04"
node tools/fsi-conferir.js 4        # confere a lição gravada
python tools/build_data.py; python build.py; node tests.js
```

O **conferidor** converte por regra a transcrição do FSI (`fsi`) para Paiboon+ e compara com o Paiboon que o Qwen escreveu. Ele recusa formato errado e escrita fora do alfabeto tailandês e avisa sobre tom, vogal ou consoante divergentes, além de pronúncia diferente da que o ThaiWise já usa para a mesma palavra. As lições 1 a 3 servem de gabarito.

## Tutor de IA

Em **Ajustes**: Anthropic, OpenAI, Gemini, DeepSeek, Groq, Mistral, OpenRouter ou endpoint OpenAI-compatível. A chave fica só no `localStorage`. O tutor recebe o exercício e explica tons pela regra (classe + sílaba + marca), com analogias.

## Dados e privacidade

Não há servidor. Progresso e log ficam no `localStorage` (`thaiwise-v1`). Para pesquisa, o estudante exporta o JSON; coleta automática exigiria destino configurado, aprovação ética (CEP) e consentimento.

## Estrutura

```
index.html              arquivo único gerado (é o que o GitHub Pages serve)
build.py                junta src/ em index.html
tests.js                testes sem navegador (node tests.js)
src/data.js             gerado por tools/build_data.py
src/engine.js           itens, tons, grafemas, seleção, desbloqueio, priors (sem DOM)
src/app.js · i18n.js · style.css · models.js · game.js · llm.js
tools/build_data.py     gera data.js; deriva o RTGS; confere a regra dos tons, lacunas e duplicatas
tools/fontes/           vocab_a1.tsv, vocab_a2.tsv, gramatica_a1/a2.json, escrita.json, fsi/licao-NN.json
tools/fsi/ocr/          OCR das 847 páginas dos dois volumes do FSI
tools/fsi-preparar.js · fsi-conferir.js · TAREFA-FSI.md
```

```powershell
python tools/build_data.py
python build.py
node tests.js
```

## Fontes e direitos

- FSI Thai Basic Course, volumes I e II (Foreign Service Institute, Departamento de Estado dos EUA): obra do governo dos EUA, domínio público. Escrita tailandesa e Paiboon+ reconstruídos para o ThaiWise.
- CU-TFL: nomes dos níveis do Sirindhorn Thai Language Institute, Chulalongkorn University; o alinhamento com o CEFR é do ThaiWise.
- Vocabulário, gramática, módulo de escrita e analogias dos níveis A1 e A2: autorais.
- Fontes tipográficas: Noto Sans Thai Looped (com laço, a forma tradicional que os livros didáticos usam), Atkinson Hyperlegible, Bricolage Grotesque, Noto Sans (Google Fonts, OFL).
