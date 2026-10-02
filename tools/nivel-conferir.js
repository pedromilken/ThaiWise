#!/usr/bin/env node
/* Confere os arquivos de nível gerados pelo Qwen (vocab_XX.tsv e gramatica_XX.json).
   ERRO: formato, escrita fora do alfabeto tailandês, Paiboon inválido, palavra repetida entre níveis, lacuna mal formada.
   Uso: node tools/nivel-conferir.js c1   (ou b1, c2…) */
const fs = require("fs"), path = require("path");
const F = path.join(__dirname, "fontes"), alvo = (process.argv[2] || "").toLowerCase();
if (!alvo) { console.log("uso: node tools/nivel-conferir.js c1"); process.exit(1); }
const MARKS = /[\u0300\u0301\u0302\u030C]/g, THAI = /^[\u0E00-\u0E7Fๆฯ]+$/, PB = /^[a-zɛɔəʉ\u0300-\u030C-]+$/;
const E = [], W = [], visto = {};
function pb(p, where) {
  for (const syl of p.normalize("NFD").split(/[-\s]+/).filter(Boolean)) {
    if (!PB.test(syl)) E.push(`${where}: Paiboon com símbolo inválido em "${syl.normalize("NFC")}"`);
    if ((syl.match(MARKS) || []).length > 1) E.push(`${where}: sílaba "${syl.normalize("NFC")}" com mais de um tom`);
  }
}
for (const f of fs.readdirSync(F).filter(f => /^vocab_[a-c][12]\.tsv$/.test(f)).sort()) {
  fs.readFileSync(path.join(F, f), "utf8").split(/\r?\n/).forEach((l, i) => {
    if (!l.trim() || l.startsWith("#")) return;
    const c = l.split("\t"), where = `${f}:${i + 1}`;
    if (c.length !== 4) { if (f.includes(alvo)) E.push(`${where}: precisa de 4 colunas separadas por TAB`); return; }
    if (visto[c[0]]) { if (f.includes(alvo)) E.push(`${where}: ${c[0]} já existe em ${visto[c[0]]}`); return; }
    visto[c[0]] = where;
    if (!f.includes(alvo)) return;
    if (!THAI.test(c[0])) E.push(`${where}: "${c[0]}" não é só escrita tailandesa`);
    pb(c[1], where);
    if (!c[2] || !c[3]) E.push(`${where}: falta glosa pt ou en`);
  });
}
const vp = path.join(F, `vocab_${alvo}.tsv`);
if (!fs.existsSync(vp)) W.push(`sem ${path.basename(vp)} (o vocabulário do nível vem das lições FSI)`);
else {
  const linhas = fs.readFileSync(vp, "utf8").split(/\r?\n/);
  const unid = linhas.filter(l => l.startsWith("##")).length, pal = linhas.filter(l => l.trim() && !l.startsWith("#")).length;
  console.log(`${path.basename(vp)}: ${unid} unidades, ${pal} palavras`);
  if (unid < 6) W.push("menos de 6 unidades temáticas");
}
const gp = path.join(F, `gramatica_${alvo}.json`);
if (!fs.existsSync(gp)) E.push(`falta ${path.basename(gp)}`);
else {
  let G; try { G = JSON.parse(fs.readFileSync(gp, "utf8")); } catch (e) { E.push(`${path.basename(gp)}: JSON inválido — ${e.message}`); }
  if (G) {
    console.log(`${path.basename(gp)}: ${G.pontos.length} pontos`);
    const tok = (s, w) => s.split(" ").forEach(t => { const [th, p] = t.split("|"); if (th === "___") return; if (!th || !p) E.push(`${w}: token "${t}" fora do formato`); else { if (!THAI.test(th)) E.push(`${w}: "${th}" não é só tailandês`); pb(p, w); } });
    G.pontos.forEach(P => {
      const w = P.id;
      for (const k of ["id", "t", "e", "ex", "pt"]) if (!P[k]) E.push(`${w}: falta "${k}"`);
      if (P.ex) tok(P.ex, w + " ex");
      (P.gaps || []).forEach((g, k) => {
        if ((g.s.match(/___/g) || []).length !== 1) E.push(`${w} lacuna ${k + 1}: precisa de exatamente um ___`);
        tok(g.s, `${w} lacuna ${k + 1}`);
        const ops = g.o.map(o => o.split("|")[0]);
        if (!ops.includes(g.a)) E.push(`${w} lacuna ${k + 1}: resposta fora das opções`);
        if (new Set(ops).size !== ops.length) E.push(`${w} lacuna ${k + 1}: opções repetidas`);
      });
      (P.ord || []).forEach((o, k) => { tok(o.s, `${w} frase ${k + 1}`); if (o.s.split(" ").length < 3) E.push(`${w} frase ${k + 1}: menos de 3 peças`); });
      if (!(P.gaps || []).length) W.push(`${w}: sem lacunas`);
    });
  }
}
E.forEach(x => console.log("   ERRO  " + x)); W.forEach(x => console.log("   aviso " + x));
console.log(E.length ? `\n${E.length} erro(s).` : "\nSem erros. Rode python tools/build_data.py && python build.py && node tests.js");
process.exitCode = E.length ? 1 : 0;
