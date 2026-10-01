#!/usr/bin/env node
/* Fatia o OCR do FSI Thai Basic Course (tools/fsi/ocr/) em uma pasta por lição: tools/fsi/licoes/licao-NN.txt.
   Não chama nenhuma API. Depois, dentro do Qwen Code: "siga tools/TAREFA-FSI.md para a licao-NN".
   Uso: node tools/fsi-preparar.js */
const fs = require("fs"), path = require("path");
const OCR = path.join(__dirname, "fsi", "ocr"), OUT = path.join(__dirname, "fsi", "licoes"), FEITO = path.join(__dirname, "fontes", "fsi");
const NUM = ["ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN","TWENTY"];
const TENS = { TWENTY: 20, THIRTY: 30, FORTY: 40 };
function parseNum(s) {
  s = s.replace(/[^A-Z\- ]/g, "").trim();
  const i = NUM.indexOf(s); if (i >= 0) return i + 1;
  const [a, b] = s.split(/[- ]+/); if (TENS[a] != null) return TENS[a] + (b ? NUM.indexOf(b) + 1 : 0);
  return null;
}
const pages = fs.readdirSync(OCR).filter(f => /^v[12]-\d{3}\.txt$/.test(f)).sort();
const starts = [];
for (const f of pages) {
  /* o cabeçalho "LESSON …" sai torto no OCR ("TWENTY~ SEVEN", "THIRTY-Two"); a linha "NN.0 BASIC DIALOG" é mais confiável */
  const txt = fs.readFileSync(path.join(OCR, f), "utf8").slice(0, 400);
  const b = txt.match(/^\s*(\d{1,2})\.0\s+BASIC/m), m = txt.match(/^\s*LESSON\s+([A-Za-z~\- ]+)\s*$/m);
  const n = b ? +b[1] : m ? parseNum(m[1].toUpperCase().replace(/~/g, "-")) : null;
  if (n && n <= 40 && !starts.some(s => s.n === n)) starts.push({ n, f });
}
starts.sort((a, b) => pages.indexOf(a.f) - pages.indexOf(b.f));
fs.mkdirSync(OUT, { recursive: true });
/* fim do volume: o glossário (v1-368 em diante) vira arquivo próprio, consultado pelo agente como dicionário */
const glos = pages.filter((f, i) => { const v = f.slice(0, 2), first = pages.findIndex(g => g.slice(0, 2) === v && /COMPREHENSIVE GLOSSARY/.test(fs.readFileSync(path.join(OCR, g), "utf8").slice(0, 300))); return first >= 0 && i >= first && f.slice(0, 2) === v; });
if (glos.length) fs.writeFileSync(path.join(OUT, "glossario.txt"), "# Glossário do FSI Thai Basic Course (volumes I e II), OCR. Use como dicionário: transcrição Haas, classificador entre parênteses, inglês.\n\n" + glos.map(f => fs.readFileSync(path.join(OCR, f), "utf8")).join("\n"));
const indice = [];
starts.forEach((s, k) => {
  const i0 = pages.indexOf(s.f), i1 = k + 1 < starts.length ? pages.indexOf(starts[k + 1].f) : Math.min(pages.length, i0 + 20);
  const sel = pages.slice(i0, i1).filter(f => f.slice(0, 2) === s.f.slice(0, 2) && !glos.includes(f));
  const nome = `licao-${String(s.n).padStart(2, "0")}`;
  const corpo = sel.map(f => `=== ${f.replace(".txt", "")} ===\n` + fs.readFileSync(path.join(OCR, f), "utf8").replace(/\n{3,}/g, "\n\n")).join("\n");
  fs.writeFileSync(path.join(OUT, nome + ".txt"), `# FSI Thai Basic Course, lição ${s.n} (OCR das páginas ${sel[0]}…${sel[sel.length - 1]}). Siga tools/TAREFA-FSI.md.\n\n` + corpo);
  indice.push({ n: s.n, arquivo: nome + ".txt", paginas: sel.map(f => f.replace(".txt", "")), feito: fs.existsSync(path.join(FEITO, nome + ".json")) });
});
fs.writeFileSync(path.join(OUT, "indice.json"), JSON.stringify(indice, null, 1));
const falta = indice.filter(x => !x.feito).map(x => x.n);
console.log(`${indice.length} lições encontradas em tools/fsi/licoes/. Já convertidas: ${indice.length - falta.length}. Pendentes: ${falta.join(", ") || "nenhuma"}.`);
console.log("Próximo passo, dentro do Qwen Code:  siga tools/TAREFA-FSI.md para a licao-" + String(falta[0] || 1).padStart(2, "0"));
