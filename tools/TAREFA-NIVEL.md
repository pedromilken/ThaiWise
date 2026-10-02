# Tarefa: escrever o conteúdo autoral de um nível CEFR (C1 ou C2)

Feita **dentro do Qwen Code**, de forma interativa. O FSI cobre até B2; os níveis C1 (Chula Superior) e C2 (Chula Distinguished) são autorais.

## Para o agente

Para o nível pedido (`c1` ou `c2`), grave dois arquivos em `tools/fontes/`, **no mesmo formato** de `vocab_a1.tsv`/`vocab_a2.tsv` e `gramatica_a1.json`/`gramatica_a2.json` (leia-os antes; são o gabarito):

1. `vocab_c1.tsv` — **8 a 10 unidades temáticas** (`## tema pt | tema en`), **30 palavras cada**, 4 colunas separadas por TAB: tailandês, Paiboon+ (sílabas com hífen), português, inglês.
2. `gramatica_c1.json` — `{"lv": 5, "pontos": [...]}` (C2: `"lv": 6`), **12 a 14 pontos**, cada um com `id` (`g5-01`…), `t`, `e` (explicação em português com **uma analogia prática**), `ex`, `pt`, `en`, **2 lacunas** e **1 frase para montar**, em tokens `tailandês|paiboon`.

Depois rode `node tools/nivel-conferir.js c1`, corrija todo ERRO e rode `python tools/build_data.py`, `python build.py` e `node tests.js`.

## Escopo por nível

- **C1 (Chula Superior):** registro formal e acadêmico; política e administração; economia e trabalho; saúde pública; meio ambiente; ciência e tecnologia; mídia; direito do cotidiano; vocabulário sino-páli-sânscrito frequente (การ-, ความ-, -ภาพ, -กรรม). Gramática: nominalização com การ/ความ; conectivos formais (อย่างไรก็ตาม, นอกจากนี้, ดังนั้น, เนื่องจาก); passiva formal com ได้รับ; ซึ่ง/อัน relativos formais; โดย adverbial; ต่อ/แก่/แด่; registro escrito × falado.
- **C2 (Chula Distinguished):** linguagem real (ราชาศัพท์ básico: เสด็จ, ทรง, พระ-), provérbios e expressões idiomáticas (สำนวน), literatura e jornalismo, nuances de partículas e de registro, eufemismos, linguagem jurídica e diplomática. Gramática: prefixo ทรง + verbo; pronomes de cortesia e de hierarquia; estruturas enfáticas (ก็…ด้วย, ไม่…เลย, ถึงกับ); retórica escrita; reduplicação elaborada e compostos rimados (คำซ้อน).

## Regras de qualidade

- **Nada duplicado:** o conferidor recusa palavra que já exista em outro nível (A1, A2, FSI…). Escolha outra.
- **Ortografia padrão do Royal Institute**; Paiboon+ de dicionário (tom no primeiro símbolo de vogal, vogal longa dobrada, `bp`/`dt` sem aspiração, `p`/`t`/`k` aspirados).
- **Consoante silenciada relida** (รัฐมนตรี → rát-tà-mon-dtrii): use a grafia RTGS oficial como pista.
- **Confira cada tom pela regra** (classe da consoante + sílaba viva/morta + marca); liste no fim as palavras em que teve dúvida.
- Português do Brasil natural; analogias curtas e concretas, como nos níveis A1 e A2.
