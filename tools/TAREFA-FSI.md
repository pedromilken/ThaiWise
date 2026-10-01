# Tarefa: converter uma lição do FSI Thai Basic Course para o ThaiWise

Feita **dentro do Qwen Code**, lição por lição, de forma interativa (é o uso que o Token Plan e o Coding Plan permitem). Não transforme isto num script que chama a API.

O FSI Thai Basic Course (Foreign Service Institute, 1970) é obra do governo dos EUA, em **domínio público**: o diálogo, o vocabulário e as notas podem ser reaproveitados. O curso, porém, **não usa escrita tailandesa**: tudo está numa transcrição fonêmica (sistema de Mary Haas). Sua tarefa é reconstruir a escrita tailandesa, escrever a pronúncia em Paiboon+ e traduzir para o português.

## Para o agente

Para o arquivo `tools/fsi/licoes/licao-NN.txt` indicado pelo usuário:

1. Leia o OCR da lição. Ele tem ruído (veja a tabela abaixo). Use o inglês ao lado de cada fala como âncora de sentido e consulte `tools/fsi/licoes/glossario.txt` (glossário do próprio curso, cerca de 1.400 entradas com transcrição e inglês) quando uma palavra estiver ilegível.
2. Localize as seções: **BASIC DIALOG** (ou BASIC EPISODE), **NOTES ON THE DIALOG**, **GRAMMAR NOTES** e **VOCABULARY**. Ignore DRILLS, EXERCISES e COMPREHENSION TEST.
3. Grave `tools/fontes/fsi/licao-NN.json` no formato abaixo. Use `tools/fontes/fsi/licao-01.json` a `licao-03.json` como **gabarito** de estilo e nível de detalhe.
4. Rode `node tools/fsi-conferir.js NN`. Corrija todo **ERRO**. Para cada **aviso**, confira a página: se o FSI estiver certo, corrija o Paiboon; se for diferença legítima (nome estrangeiro, forma coloquial que o FSI registra), deixe como está.
5. Rode `python tools/build_data.py` e confirme que não aparece erro.

## Formato

```json
{"n": 4, "paginas": "vol. 1, p. 35–51",
 "titulo": {"pt": "…", "en": "…"},
 "dialogo": [
  {"sp": "A", "s": "คุณ|kun มี|mii แผนที่|pɛ̌ɛn-tîi ไหม|mǎi ครับ|kráp", "fsi": "khun mii phɛ̌ɛnthîi máj khráp", "en": "Do you have a map?", "pt": "Você tem um mapa?"}
 ],
 "vocab": [
  {"th": "แผนที่", "p": "pɛ̌ɛn-tîi", "fsi": "phɛ̌ɛnthîi", "pt": "mapa", "en": "map"}
 ],
 "notas": [
  {"t": {"pt": "…", "en": "…"}, "e": {"pt": "…", "en": "…"}, "ex": "นี่|nîi อะไร|à-rai"}
 ]}
```

- `sp`: quem fala, como no livro (A, B, ou a inicial do nome).
- `s`: a fala **em tokens** `tailandês|paiboon` separados por espaço, **um token por palavra** (é com eles que o ThaiWise monta o exercício de ordenar a frase). Sem pontuação, sem espaços dentro do token.
- `fsi`: a transcrição do livro **limpa** (corrija o ruído do OCR), com os tons do livro. É o que o conferidor compara com o seu Paiboon.
- `en`: o inglês do livro. `pt`: português do Brasil natural (não traduza do inglês palavra por palavra).
- `vocab`: **todas** as entradas do VOCABULARY da lição, exceto nomes próprios de pessoas. Uma entrada por sentido de dicionário; locuções do livro (ex.: `ʔìik thii`) entram como uma entrada.
- `notas`: as notas do diálogo e de gramática **reescritas com suas palavras** em português (2 a 4 frases, com uma analogia prática quando ajudar) e um resumo em inglês. Uma nota por tópico do livro; junte tópicos muito curtos. `ex` é opcional.

## Do sistema do FSI para a escrita tailandesa e o Paiboon+

| FSI (Haas) | Paiboon+ | Exemplo |
|---|---|---|
| p t k c (início de sílaba) | bp dt g j | `pàakkaa` → bpàak-gaa ปากกา |
| p t k (fim de sílaba) | p t k | `wát` → wát วัด |
| ph th kh ch | p t k ch | `phǒm` → pǒm ผม |
| j (consoante) / j (fim) | y / i | `jàa` → yàa อย่า; `máj` → mǎi ไหม |
| w (fim) | o | `kháw` → kǎo เขา |
| y | ʉ | `chʉ̂ʉ` (OCR: chfy, ch¥y) → chʉ̂ʉ ชื่อ |
| ŋ | ng | `naŋsʉ̌ʉ` → nǎng-sʉ̌ʉ หนังสือ |
| ia, ʉa, ua | iia, ʉʉa, uua | `rian` → riian เรียน |
| à â á ǎ / sem marca | iguais | o FSI deixa sem marca as sílabas átonas (`sawàtdii`); o Paiboon marca o tom de dicionário: sà-wàt-dii |

No Paiboon+ use **hífen entre sílabas** da mesma palavra e o tom no **primeiro** símbolo de vogal da sílaba. Vogal longa = símbolo dobrado.

**Formas coloquiais.** O FSI registra a fala: `máj` (ไหม), `kháw` (เขา), `chán` (ฉัน), `dâj` (ได้). No Paiboon, escreva a forma de dicionário (mǎi, kǎo, chǎn, dâai). O conferidor já sabe disso.

**Escrita tailandesa.** Escreva a ortografia padrão (Royal Institute), não uma transcrição do som: ได้ e não ด้าย; จริง e não จิง. Quando uma palavra tiver mais de uma grafia aceita, use a mais comum em textos atuais.

## Ruído típico do OCR

| No OCR | Provável |
|---|---|
| `¥`, `Y`, `f` no meio da vogal (`ch¥y`, `chfy`, `nansYy`) | ʉ (y do FSI) |
| `€`, `&` | ɛ |
| `Q`, `0` antes de consoante | ɔ ou ŋ |
| `3`, `S`, `%` grudados no k (`khSo`, `kh3on`) | ɔ̌ɔ (com tom) |
| `1` no lugar de `l`, `i`, `í` | l ou i |
| acentos perdidos | confira pelo sentido e pelo tom de dicionário |

Na dúvida sobre um tom, siga o tom de dicionário e deixe o conferidor mostrar a diferença.

## Regras de qualidade

- Português do Brasil natural, com o registro do diálogo (uma conversa educada, não um contrato).
- Nada inventado: se o OCR estiver ilegível num trecho, deixe a fala de fora e diga ao usuário qual foi.
- Palavras que o ThaiWise já tem (`tools/fontes/vocab_a1.tsv`, `vocab_a2.tsv`) devem usar **a mesma pronúncia** de lá; o conferidor avisa se divergir.
- Não copie as notas do FSI ao pé da letra: reescreva para quem fala português, com exemplos tirados do próprio diálogo.
