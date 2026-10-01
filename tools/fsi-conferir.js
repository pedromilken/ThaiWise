#!/usr/bin/env node
/* Confere as lições convertidas pelo Qwen (tools/fontes/fsi/licao-NN.json).
   ERRO (precisa corrigir): formato, campos faltando, token sem "tailandês|paiboon", escrita fora do alfabeto tailandês,
     Paiboon com símbolos inválidos, sílabas com mais de um tom.
   AVISO (revise): o campo "fsi" (transcrição do curso, sistema Haas) convertido por regra para Paiboon+ diverge do Paiboon escrito;
     palavra já existente no ThaiWise com pronúncia diferente.
   Uso: node tools/fsi-conferir.js [NN ...]   (sem argumento confere todas) */
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "fontes", "fsi"), ROOT = path.join(__dirname, "..");
const MARKS = /[\u0300\u0301\u0302\u030C]/g;
const nfd = s => String(s || "").normalize("NFD"), nfc = s => s.normalize("NFC");
const lex = {};
for (const f of ["vocab_a1.tsv", "vocab_a2.tsv"]) { const p = path.join(__dirname, "fontes", f); if (fs.existsSync(p)) fs.readFileSync(p, "utf8").split("\n").forEach(l => { const c = l.split("\t"); if (c.length === 4 && !l.startsWith("#")) lex[c[0]] = c[1]; }); }

/* Haas (FSI) -> Paiboon+. O FSI junta as sílabas da palavra, então a regra olha o que vem depois de cada consoante:
   oclusiva seguida de vogal abre sílaba (p t k c -> bp dt g j); no fim de sílaba fica p t k. Formas coloquiais do FSI
   (máj, kháw, chán) voltam à forma de dicionário antes de comparar. */
const COLLOQ = [[/\bmáj\b/g, "mǎj"], [/\bkháw\b/g, "khǎw"], [/\bchán\b/g, "chǎn"], [/\bdichán\b/g, "dichǎn"]];
function haas2paiboon(h, clusters = true) {
  let s = nfc(String(h || "").toLowerCase());
  COLLOQ.forEach(([re, to]) => { s = s.replace(re, to); });
  s = nfd(s).replace(/ʔ/g, "|").replace(/[-,.?!'’"()]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/y/g, "ʉ").replace(/ŋ/g, "Ŋ").replace(/ph/g, "P").replace(/th/g, "T").replace(/kh/g, "K").replace(/ch/g, "C");
  const V = "(?=[aeiouɛɔəʉ])", VC = clusters ? "(?=[rlw]?[aeiouɛɔəʉ])" : V;   /* VC: encontros pr, kr, pl, kl, kw, tr abrem sílaba */
  s = s.replace(new RegExp("p" + VC, "g"), "BP").replace(new RegExp("t" + VC, "g"), "DT").replace(new RegExp("k" + VC, "g"), "G").replace(/c/g, "J");
  s = s.replace(new RegExp("j" + V, "g"), "Y").replace(/j/g, "i").replace(/w(?![aeiouɛɔəʉ])/g, "o");
  s = s.replace(/BP/g, "bp").replace(/DT/g, "dt").replace(/G/g, "g").replace(/J/g, "j").replace(/Y/g, "y").replace(/C/g, "ch").replace(/P/g, "p").replace(/T/g, "t").replace(/K/g, "k").replace(/Ŋ/g, "ng").replace(/\|/g, "");
  s = s.replace(/i([\u0300-\u030C]?)a/g, "i$1ia").replace(/ʉ([\u0300-\u030C]?)a/g, "ʉ$1ʉa").replace(/u([\u0300-\u030C]?)a(?!a)/g, "u$1ua");
  return nfc(s);
}
const skel = s => nfd(s).replace(MARKS, "").replace(/[-\s]/g, "").toLowerCase();
const tones = s => (nfd(s).match(MARKS) || []).join("");
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const THAI = /^[\u0E00-\u0E7F]+$/, PB = /^[a-zɛɔəʉ\u0300-\u030C-]+$/;
function checkPaiboon(p, where, E) {
  for (const syl of nfd(p).split(/[-\s]+/).filter(Boolean)) {
    if (!PB.test(syl)) E.push(`${where}: Paiboon com símbolo inválido em "${nfc(syl)}"`);
    if ((syl.match(MARKS) || []).length > 1) E.push(`${where}: sílaba "${nfc(syl)}" com mais de um tom`);
  }
}
/* tons: o FSI deixa sem marca as sílabas átonas (sa-, ka-, pra-), então só se exige que os tons marcados no FSI
   apareçam, na mesma ordem, entre os tons do Paiboon */
function subseq(a, b) { let j = 0; for (const c of b) if (c === a[j]) j++; return j === a.length; }
function compare(fsi, p, where, W) {
  if (!fsi) return;
  /* p/t/k + r/l/w no meio da palavra é ambíguo: encontro (kr-, pl-) ou final + início (nák-riian). Aceita a leitura que bater. */
  const shrink = x => x.replace(/([aeiouɛɔəʉ])\1/g, "$1"), b = skel(p);
  const convs = [haas2paiboon(fsi, true), haas2paiboon(fsi, false)];
  const conv = convs.find(c => shrink(skel(c)) === shrink(b)) || convs[0];
  const a = skel(conv), d = lev(a, b), r = 1 - d / Math.max(a.length, b.length, 1);
  if (shrink(a) !== shrink(b)) W.push(`${where}: FSI "${fsi}" → ${conv} difere de "${p}" (${Math.round(r * 100)}% igual)`);
  else if (!subseq(tones(conv), tones(p))) W.push(`${where}: tons diferentes — FSI ${conv} × Paiboon ${p}`);
}
const alvo = process.argv.slice(2).map(n => `licao-${String(n).padStart(2, "0")}.json`);
const files = fs.readdirSync(DIR).filter(f => /^licao-\d+\.json$/.test(f) && (!alvo.length || alvo.includes(f))).sort();
let totE = 0, totW = 0;
for (const f of files) {
  const E = [], W = []; let L;
  try { L = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch (e) { console.log(`${f}: JSON inválido — ${e.message}`); totE++; continue; }
  if (!Number.isInteger(L.n) || `licao-${String(L.n).padStart(2, "0")}.json` !== f) E.push("campo n não bate com o nome do arquivo");
  if (!L.titulo || !L.titulo.pt || !L.titulo.en) E.push("titulo.pt e titulo.en são obrigatórios");
  if (!(L.dialogo || []).length) E.push("dialogo vazio");
  (L.dialogo || []).forEach((d, i) => {
    const w = `diálogo ${i + 1}`;
    for (const k of ["sp", "s", "en", "pt"]) if (!d[k]) E.push(`${w}: falta "${k}"`);
    const toks = String(d.s || "").split(" ").filter(Boolean);
    toks.forEach(t => { const [th, p] = t.split("|"); if (!th || !p || t.split("|").length !== 2) E.push(`${w}: token "${t}" fora do formato tailandês|paiboon`); else { if (!THAI.test(th)) E.push(`${w}: "${th}" não é só escrita tailandesa`); checkPaiboon(p, w, E); } });
    compare(d.fsi, toks.map(t => t.split("|")[1] || "").join(" "), w, W);
  });
  (L.vocab || []).forEach((v, i) => {
    const w = `vocab ${v.th || i + 1}`;
    for (const k of ["th", "p", "pt", "en"]) if (!v[k]) E.push(`${w}: falta "${k}"`);
    if (v.th && !THAI.test(v.th)) E.push(`${w}: escrita fora do alfabeto tailandês`);
    if (v.p) { checkPaiboon(v.p, w, E); compare(v.fsi, v.p, w, W); if (lex[v.th] && lex[v.th] !== v.p) W.push(`${w}: o ThaiWise já tem ${v.th} como "${lex[v.th]}" (aqui "${v.p}")`); }
  });
  (L.notas || []).forEach((x, i) => { if (!x.t || !x.e || !x.t.pt || !x.e.pt) E.push(`nota ${i + 1}: t.pt e e.pt são obrigatórios`); if (x.ex) x.ex.split(" ").forEach(t => { if (t.split("|").length !== 2) E.push(`nota ${i + 1}: token "${t}" fora do formato`); }); });
  totE += E.length; totW += W.length;
  console.log(`${f}: ${E.length ? "❌ " + E.length + " erro(s)" : "✅"}${W.length ? " · ⚠️ " + W.length + " aviso(s)" : ""}`);
  E.forEach(x => console.log("   ERRO  " + x)); W.forEach(x => console.log("   aviso " + x));
}
console.log(totE ? `\n${totE} erro(s): corrija e rode de novo.` : `\nSem erros. Revise os avisos e depois: python tools/build_data.py && python build.py && node tests.js`);
process.exitCode = totE ? 1 : 0;
