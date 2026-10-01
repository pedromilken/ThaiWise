/* ThaiWise - motor sem DOM: gera itens, escolhe o próximo, decide desbloqueios e priors.
   Níveis: 0 = Escrita e tons (pré-A1); 1..6 = CEFR A1..C2, alinhados pedagogicamente aos cinco níveis do CU-TFL.
   Habilidades (dim): ouvir, falar, ler, escrever, traduzir, tom (classe + sílaba viva/morta + marca) e gramática.
   Ids de habilidade: e01..e08 escrita; v{nível}u{nn} vocabulário; f{nn} lição do FSI Thai Basic Course; g{nível} gramática. */
const ENGINE = (() => {
  const WORD = {}; DATA.words.forEach(w => { if (!WORD[w.t]) WORD[w.t] = w; });
  const UNITS = {}; DATA.levels.forEach(L => L.units.forEach(u => { UNITS[u.id] = u; }));
  const CONS = {}; DATA.script.cons.forEach(c => { CONS[c.c] = c; });
  const DIMS = ["listen", "speak", "read", "write", "translate", "tone", "grammar"];
  const TONES = ["M", "L", "F", "H", "R"];
  const UNLOCK = 0.6, L0 = 0.15;

  function rng(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const shuffle = (a, r = Math.random) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const gloss = (w, lang) => (lang === "en" ? (w.en || w.pt) : (w.pt || w.en)) || "—";

  /* ---------- tons no Paiboon+ ---------- */
  const MARK = { L: "\u0300", F: "\u0302", H: "\u0301", R: "\u030C" };
  const MARK2T = { "\u0300": "L", "\u0302": "F", "\u0301": "H", "\u030C": "R" };
  const toneOf = syl => { for (const ch of syl.normalize("NFD")) if (MARK2T[ch]) return MARK2T[ch]; return "M"; };
  const bare = syl => [...syl.normalize("NFD")].filter(c => !MARK2T[c]).join("").normalize("NFC");
  function setTone(syl, t) {
    const b = [...bare(syl).normalize("NFD")], i = b.findIndex(c => "aeiouɛɔəʉ".includes(c));
    if (i < 0 || t === "M") return b.join("").normalize("NFC");
    b.splice(i + 1, 0, MARK[t]); return b.join("").normalize("NFC");
  }
  /* sílabas com o tom de cada uma (para colorir e para os distratores) */
  const syllables = p => String(p || "").split(/([\s-]+)/).map(x => /[\s-]/.test(x) || !x ? { sep: x } : { s: x, t: toneOf(x) });
  /* distratores de pronúncia: troca o tom de uma ou duas sílabas; às vezes a duração da vogal */
  function romVariants(p, n, r = Math.random) {
    const parts = p.split(/([\s-]+)/), idx = parts.map((x, i) => /[a-zɛɔəʉ]/i.test(x) ? i : -1).filter(i => i >= 0), out = new Set();
    let guard = 0;
    while (out.size < n && guard++ < 80) {
      const q = parts.slice(), i = idx[Math.floor(r() * idx.length)], cur = toneOf(q[i]);
      if (r() < .8) { let t = TONES[Math.floor(r() * 5)]; if (t === cur) t = TONES[(TONES.indexOf(t) + 1 + Math.floor(r() * 4)) % 5]; q[i] = setTone(q[i], t);
        if (idx.length > 1 && r() < .3) { const j = idx[Math.floor(r() * idx.length)]; if (j !== i) q[j] = setTone(q[j], TONES[(TONES.indexOf(toneOf(q[j])) + 1 + Math.floor(r() * 4)) % 5]); } }
      else { const b = bare(q[i]), m = b.match(/([aeiouɛɔəʉ])\1/); const nb = m ? b.replace(m[0], m[1]) : b.replace(/([aeiouɛɔəʉ])/, "$1$1"); q[i] = setTone(nb, cur); }
      const s = q.join(""); if (s !== p) out.add(s);
    }
    return [...out].slice(0, n);
  }

  /* ---------- grafemas tailandeses (base + vogais e marcas acima/abaixo) ---------- */
  const COMB = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  function clusters(t) { const out = []; for (const ch of String(t)) { if (COMB.test(ch) && out.length) out[out.length - 1] += ch; else out.push(ch); } return out; }

  /* ---------- itens ---------- */
  function distractors(w, n, lang, r) {
    const pool = shuffle(DATA.words.filter(x => x.lv === w.lv && x.t !== w.t), r).concat(shuffle(DATA.words.filter(x => x.lv !== w.lv && x.t !== w.t), r));
    const g = gloss(w, lang), seen = new Set([g]), out = [];
    for (const x of pool) { const gx = gloss(x, lang); if (!seen.has(gx)) { seen.add(gx); out.push(x); } if (out.length >= n) break; }
    return out;
  }
  function wordItems(u, caps) {
    const items = [];
    u.w.forEach(t => {
      const w = WORD[t]; if (!w) return; const base = { skill: u.id, lv: u.lv, w: t };
      items.push({ ...base, id: `${u.id}:${t}:r`, type: "read", dim: "read", d: 1, c: .25 });
      items.push({ ...base, id: `${u.id}:${t}:p`, type: "rom", dim: "tone", d: 2, c: .25 });
      items.push({ ...base, id: `${u.id}:${t}:t`, type: "translate", dim: "translate", d: 2, c: .25 });
      if (caps.voice) items.push({ ...base, id: `${u.id}:${t}:l`, type: "listen", dim: "listen", d: 2, c: .25 });
      if (caps.mic) items.push({ ...base, id: `${u.id}:${t}:s`, type: "speak", dim: "speak", d: 2, c: .1 });
      const n = clusters(t).length; if (n >= 2 && n <= 9 && !/[\s ๆฯ]/.test(t)) items.push({ ...base, id: `${u.id}:${t}:w`, type: "spell", dim: "write", d: 3, c: .05 });
    });
    return items;
  }
  function scriptItems(u, caps) {
    const S = DATA.script, out = [], base = { skill: u.id, lv: 0 };
    if (u.w) u.w.forEach(ch => {
      const c = CONS[ch];
      out.push({ ...base, id: `${u.id}:${ch}:cls`, type: "cls", dim: "tone", d: 1, c: .33, ch });
      if (c.ini) out.push({ ...base, id: `${u.id}:${ch}:ini`, type: "ini", dim: "read", d: 1, c: .25, ch });
      out.push({ ...base, id: `${u.id}:${ch}:nm`, type: "letter", dim: "write", d: 2, c: .25, ch });
      if (caps.voice) out.push({ ...base, id: `${u.id}:${ch}:l`, type: "lsn", dim: "listen", d: 2, c: .25, ch });
    });
    if (u.id === "e05") S.vow.forEach((v, i) => {
      out.push({ ...base, id: `e05:v${i}:r`, type: "vrom", dim: "read", d: 1, c: .25, v: i });
      out.push({ ...base, id: `e05:v${i}:n`, type: "vlen", dim: "read", d: 1, c: .5, v: i });
      if (caps.voice) out.push({ ...base, id: `e05:v${i}:l`, type: "vlsn", dim: "listen", d: 2, c: .25, v: i });
    });
    if (u.id === "e06") {
      S.cons.filter(c => c.fin && !c.obs).forEach(c => out.push({ ...base, id: `e06:${c.c}:f`, type: "fin", dim: "read", d: 2, c: .14, ch: c.c }));
      S.syl.forEach((s, i) => out.push({ ...base, id: `e06:s${i}:v`, type: "live", dim: "tone", d: 2, c: .5, sy: i }));
    }
    if (u.id === "e07" || u.id === "e08") S.syl.forEach((s, i) => { if (s.u === u.id) out.push({ ...base, id: `${u.id}:s${i}:t`, type: "tone", dim: "tone", d: u.id === "e07" ? 2 : 3, c: .2, sy: i }); });
    return out;
  }
  function fsiItems(u, caps) {
    const L = DATA.fsi[u.n], out = wordItems(u, caps);
    (L && L.dialogo || []).forEach((d, i) => {
      out.push({ skill: u.id, lv: u.lv, id: `${u.id}:d${i}:m`, type: "dmean", dim: "read", d: 2, c: .25, dl: i });
      if (d.s && d.s.length >= 3 && d.s.length <= 9) out.push({ skill: u.id, lv: u.lv, id: `${u.id}:d${i}:o`, type: "order", dim: "translate", d: 3, c: .05, s: { t: d.s, pt: d.pt, en: d.en } });
    });
    return out;
  }
  function grammarItems(lv) {
    const skill = "g" + lv, out = [];
    DATA.gItems.filter(g => g.lv === lv).forEach(g => out.push({ id: `${skill}:${g.id}`, skill, lv, type: "gap", dim: "grammar", d: 2, c: .25, g }));
    DATA.gSent.filter(s => s.lv === lv).forEach(s => out.push({ id: `${skill}:${s.id}`, skill, lv, type: "order", dim: "grammar", d: 3, c: .05, s }));
    return out;
  }
  function itemsFor(skill, caps) {
    if (skill[0] === "g") return grammarItems(+skill.slice(1));
    const u = UNITS[skill]; if (!u) return [];
    if (u.kind === "script") return scriptItems(u, caps);
    if (u.kind === "fsi") return fsiItems(u, caps);
    return wordItems(u, caps);
  }
  const wordOf = it => it.w ? WORD[it.w] : null;

  /* ---------- opções ---------- */
  const consOf = ch => CONS[ch];
  function options(it, lang, seed) {
    const r = rng(it.id + "|" + seed), w = wordOf(it), S = DATA.script;
    const pickCons = (n, f) => shuffle(S.cons.filter(c => c.c !== it.ch && !c.obs && (!f || f(c))), r).slice(0, n);
    switch (it.type) {
      case "read": return shuffle([w, ...distractors(w, 3, lang, r)], r).map(x => ({ key: x.t, label: gloss(x, lang) }));
      case "translate": case "listen": return shuffle([w, ...distractors(w, 3, lang, r)], r).map(x => ({ key: x.t, label: x.t, th: 1 }));
      case "rom": return shuffle([w.p, ...romVariants(w.p, 3, r)], r).map(p => ({ key: p, label: p, rom: 1 }));
      case "cls": return ["M", "H", "L"].map(k => ({ key: k, label: k }));
      case "ini": { const c = consOf(it.ch), seen = new Set([c.ini]), ds = []; for (const x of pickCons(40)) { if (x.ini && !seen.has(x.ini)) { seen.add(x.ini); ds.push(x.ini); } if (ds.length >= 3) break; } return shuffle([c.ini, ...ds], r).map(k => ({ key: k, label: k || "∅", rom: 1 })); }
      case "letter": case "lsn": return shuffle([it.ch, ...pickCons(3).map(c => c.c)], r).map(k => ({ key: k, label: k, th: 1 }));
      case "vrom": { const v = S.vow[it.v]; return shuffle([v.p, ...shuffle(S.vow.filter(x => x.p !== v.p), r).slice(0, 3).map(x => x.p)], r).map(k => ({ key: k, label: k, rom: 1 })); }
      case "vlsn": { const v = S.vow[it.v]; return shuffle([v.ex, ...shuffle(S.vow.filter(x => x.p !== v.p), r).slice(0, 3).map(x => x.ex)], r).map(k => ({ key: k, label: k, th: 1 })); }
      case "vlen": return [{ key: "s", label: "s" }, { key: "l", label: "l" }];
      case "fin": return ["k", "t", "p", "n", "m", "ng", "i", "o"].map(k => ({ key: k, label: "-" + k, rom: 1 }));
      case "live": return [{ key: "1", label: "1" }, { key: "0", label: "0" }];
      case "tone": return TONES.map(k => ({ key: k, label: k }));
      case "gap": return shuffle(it.g.o, r).map(o => ({ key: o[0], label: o[0], th: 1, p: o[1], r: o[2] }));
      case "dmean": { const L = DATA.fsi[UNITS[it.skill].n], d = L.dialogo[it.dl], key = lang === "en" ? "en" : "pt";
        const others = shuffle(L.dialogo.filter((x, j) => j !== it.dl && x[key] && x[key] !== d[key]), r).slice(0, 3);
        return shuffle([d, ...others], r).map(x => ({ key: x[key], label: x[key] })); }
    }
    return [];
  }
  function answerKey(it, lang) {
    const w = wordOf(it), S = DATA.script;
    switch (it.type) {
      case "rom": return w.p;
      case "cls": return consOf(it.ch).cls;
      case "ini": return consOf(it.ch).ini;
      case "fin": return consOf(it.ch).fin;
      case "letter": case "lsn": return it.ch;
      case "vrom": return S.vow[it.v].p;
      case "vlsn": return S.vow[it.v].ex;
      case "vlen": return S.vow[it.v].len;
      case "live": return String(S.syl[it.sy].live);
      case "tone": return S.syl[it.sy].tone;
      case "gap": return it.g.a;
      case "dmean": { const d = DATA.fsi[UNITS[it.skill].n].dialogo[it.dl]; return lang === "en" ? d.en : d.pt; }
    }
    return it.w;
  }

  /* ---------- tutor de tom: a regra aplicada passo a passo ---------- */
  function toneRule(cls, live, long, mark) {
    if (cls === "M") return [live ? "M" : "L", "L", "F", "H", "R"][mark];
    if (cls === "H") return [live ? "R" : "L", "L", "F"][mark];
    if (mark) return ["", "F", "H"][mark];
    return live ? "M" : (long ? "F" : "H");
  }

  /* ---------- seleção adaptativa (dois passos, como no Wikawise) ---------- */
  function pick(items, mastery, recent, solved, r = Math.random) {
    if (!items.length) return null;
    const target = mastery < .35 ? 1.4 : mastery < .7 ? 2 : 2.8;
    const byType = {}; items.forEach(it => (byType[it.type] = byType[it.type] || []).push(it));
    const recentTypes = recent.map(id => (items.find(i => i.id === id) || {}).type).filter(Boolean);
    const tScore = ty => { const d = byType[ty][0].d, n = recentTypes.slice(-4).filter(x => x === ty).length; return Math.abs(d - target) * .6 + n * .9 + r() * 1.1; };
    const ty = Object.keys(byType).reduce((b, x) => (b == null || tScore(x) < b.s ? { x, s: tScore(x) } : b), null).x;
    const score = it => (recent.includes(it.id) ? 5 : 0) + (solved[it.id] ? 1.5 : 0) + r();
    return byType[ty].reduce((b, it) => (b == null || score(it) < b.s ? { it, s: score(it) } : b), null).it;
  }

  /* ---------- desbloqueio e priors ---------- */
  const levelUnits = lv => (DATA.levels[lv] || { units: [] }).units;
  function levelOpen(S, lv, M) {
    if (lv <= 1 || S.free || S.keyed["L" + lv]) return true;
    const prev = levelUnits(lv - 1); if (!prev.length) return false;
    return prev.filter(u => M(u.id) >= UNLOCK).length / prev.length >= UNLOCK;
  }
  /* cada nível tem duas trilhas encadeadas: unidades temáticas (v) e lições do FSI (f); a escrita (e) é uma trilha só */
  function prevInChain(u) { const ch = levelUnits(u.lv).filter(x => (x.kind || "v") === (u.kind || "v")); const i = ch.findIndex(x => x.id === u.id); return i > 0 ? ch[i - 1] : null; }
  function unitOpen(S, uid, M) {
    const u = UNITS[uid]; if (!u) return false; if (S.free || S.keyed[uid]) return true;
    if (!levelOpen(S, u.lv, M)) return false;
    const p = prevInChain(u); return !p || M(p.id) >= UNLOCK;
  }
  function skillOpen(S, skill, M) { return skill[0] === "g" ? levelOpen(S, +skill.slice(1), M) : unitOpen(S, skill, M); }
  function prior(skill, M) {
    const u = UNITS[skill]; if (!u) return L0;
    const p = prevInChain(u); if (p) return .5 * L0 + .5 * M(p.id);
    if (u.lv <= 1) return L0;
    const prev = levelUnits(u.lv - 1); return prev.length ? .5 * L0 + .5 * prev.reduce((a, x) => a + M(x.id), 0) / prev.length : L0;
  }

  return { WORD, UNITS, CONS, DIMS, TONES, UNLOCK, L0, gloss, toneOf, setTone, bare, syllables, romVariants, clusters, itemsFor, wordItems, scriptItems, grammarItems, fsiItems,
    options, answerKey, toneRule, pick, levelOpen, unitOpen, skillOpen, prior, shuffle, rng, wordOf, levelUnits };
})();
