/* ThaiWise - interface. Mesmo motor de rastreamento (models.js), economia (game.js) e tutor (llm.js) da família DevWise/Wikawise. */
const KEY = "thaiwise-v1", PILOT = "elo";
const E = ENGINE;

/* ---------- estado ---------- */
function guessLang() { return /^pt/i.test(navigator.language || "pt") ? "pt" : "en"; }
function fresh() { return { v: 1, lang: guessLang(), skills: {}, dims: {}, solved: {}, log: [], xp: 0, xpTotal: 0, mode: "normal", inv: { shield: 0, boost: 0, lens: 0, key: 0 }, boost: 0, keyed: {}, titles: [], title: null, streak: 0, best: 0, lastWrong: false, free: false, rom: "both", tcol: true, theme: "auto", name: "", started: false }; }
function load() { try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && d.v === 1) { const f = fresh(); for (const k in f) if (d[k] === undefined) d[k] = f[k]; if (!MODES[d.mode]) d.mode = "normal"; if (!LANG[d.lang]) d.lang = "pt"; return d; } } catch (e) { } return fresh(); }
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }

/* ---------- utilidades ---------- */
const t = (k, p) => { let s = (LANG[S.lang] || LANG.pt)[k]; if (s == null) s = LANG.pt[k] != null ? LANG.pt[k] : k; if (p) for (const x in p) s = String(s).split("{" + x + "}").join(p[x]); return s; };
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) { const v = attrs[k]; if (k.startsWith("aria-") && typeof v === "boolean") { n.setAttribute(k, String(v)); continue; } if (v == null || v === false) continue; if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (k === "html") n.innerHTML = v; else n.setAttribute(k, v === true ? "" : v); }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
/* append que ignora null/false (o append do DOM escreveria "null") */
const add = (n, ...k) => { n.append(...k.flat().filter(x => x != null && x !== false)); return n; };
const pct = p => Math.round(p * 100) + "%";
const $app = () => document.getElementById("app");
const pad = n => String(n).padStart(2, "0");
const L_ = x => S.lang === "en" ? (x.en || x.pt) : x.pt;
const th = (text, cls) => el("span", { class: "th" + (cls ? " " + cls : ""), lang: "th" }, text);
/* Paiboon+ com cada sílaba colorida pelo tom */
function paiboon(p) { const n = el("span", { class: "rom pb" + (S.tcol ? " tc" : "") }); E.syllables(p).forEach(x => n.append(x.sep != null ? x.sep : el("span", { class: "t" + x.t }, x.s))); return n; }
/* romanização conforme o ajuste: Paiboon+, RTGS, ambas ou nenhuma; force sobrepõe o ajuste */
function rom(p, r, force) {
  const m = force || S.rom; if (m === "off" || !p) return null;
  if (m === "paiboon") return paiboon(p);
  if (m === "rtgs") return el("span", { class: "rom rt" }, r);
  return el("span", { class: "rom both" }, paiboon(p), el("span", { class: "rt" }, r));
}
/* frase em tokens [tailandês, paiboon, rtgs]: tailandês corrido (sem espaços, como se escreve) e a romanização embaixo */
function sentence(toks, gapLabel) {
  const thai = toks.map(x => x[0] === "___" ? (gapLabel || "＿＿") : x[0]).join("");
  const p = toks.map(x => x[0] === "___" ? "___" : x[1]).join(" "), r = toks.map(x => x[0] === "___" ? "___" : x[2]).join(" ");
  return el("span", { class: "sent" }, th(thai), rom(p, r));
}
const LVCODE = lv => DATA.levels[lv].code;
const skillName = s => {
  if (s[0] === "g") return `${LVCODE(+s.slice(1))} · ${t("theory")}`;
  const u = E.UNITS[s]; if (!u) return s;
  if (u.kind === "script") return `${t("lvScript")} · ${L_(u)}`;
  if (u.kind === "fsi") return `${LVCODE(u.lv)} · ${t("fsiLesson")} ${u.n}`;
  return `${LVCODE(u.lv)} · ${t("unit")} ${u.n} · ${L_(u)}`;
};

/* ---------- rastreamento (idêntico ao Wikawise) ---------- */
const M = skill => { const tr = S.skills[skill]; return tr ? KT.mastery(tr, PILOT) : E.prior(skill, x => S.skills[x] ? KT.mastery(S.skills[x], PILOT) : 0); };
function track(skill) { if (!S.skills[skill]) { const p = E.prior(skill, M); S.skills[skill] = { L: p, n: 0, c: 0, prior: +p.toFixed(3) }; } return KT.ensure(S.skills[skill]); }
function dimTrack(lv, dim) { const k = lv + ":" + dim; if (!S.dims[k]) S.dims[k] = { L: E.L0, n: 0, c: 0 }; return KT.ensure(S.dims[k]); }
function blendUpdate(tr, it, c, y, w) {
  const before = JSON.parse(JSON.stringify(tr.m)); KT.updateAll(tr, it, c, y);
  if (w < 1) for (const k in tr.m) for (const f in tr.m[k]) if (typeof tr.m[k][f] === "number" && typeof before[k][f] === "number") tr.m[k][f] = before[k][f] + (tr.m[k][f] - before[k][f]) * w;
}
function record(it, ok, opts = {}) {
  const tr = track(it.skill), c = opts.c != null ? opts.c : it.c, w = opts.hint ? .5 : 1, was = tr.L;
  const preds = KT.predictAll(tr, it, c);
  blendUpdate(tr, it, c, ok ? 1 : 0, w); tr.L = KT.mastery(tr, PILOT); tr.n++; if (ok) tr.c++;
  const dt = dimTrack(it.lv, it.dim); blendUpdate(dt, it, c, ok ? 1 : 0, w); dt.L = KT.mastery(dt, PILOT); dt.n++; if (ok) dt.c++;
  if (ok) S.solved[it.id] = 1;
  const x = GAME.gain(S, it.d, ok); S.xp = Math.max(0, S.xp + x); if (x > 0) S.xpTotal += x;
  S.streak = ok ? S.streak + 1 : 0; S.best = Math.max(S.best, S.streak); S.lastWrong = !ok;
  S.log.push({ ts: Date.now(), item: it.id, skill: it.skill, lv: it.lv, dim: it.dim, type: it.type, ok: ok ? 1 : 0, counted: 1, w, c: +c.toFixed(3), d: it.d, hint: opts.hint ? 1 : 0, keyed: S.keyed[it.skill] ? 1 : 0, free: S.free ? 1 : 0, prior: tr.prior, lang: S.lang, rom: S.rom, mode: S.mode, before: +was.toFixed(3), after: +tr.L.toFixed(3), preds, extra: opts.extra || undefined });
  save(); return x;
}
function status(skill) {
  if (!E.skillOpen(S, skill, M)) return "locked";
  const tr = S.skills[skill]; if (!tr || !tr.n) return "open";
  const m = M(skill); return m >= KT.master(PILOT) ? "master" : m >= E.UNLOCK ? "ok" : "learning";
}

/* ---------- voz e fala ---------- */
const CAPS = { voice: false, mic: !!(window.SpeechRecognition || window.webkitSpeechRecognition) };
let TH_VOICE = null;
function loadVoices() { try { const v = speechSynthesis.getVoices(); TH_VOICE = v.find(x => /^th(-|_)?TH/i.test(x.lang)) || v.find(x => /^th/i.test(x.lang)) || null; CAPS.voice = !!TH_VOICE; } catch (e) { } }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { const had = CAPS.voice; loadVoices(); if (had !== CAPS.voice) render(); }; }
function say(text, onend) { if (!TH_VOICE) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.voice = TH_VOICE; u.lang = TH_VOICE.lang; u.rate = .75; if (onend) u.onend = onend; speechSynthesis.speak(u); } catch (e) { } }
const ICON_SAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
const sayBtn = text => el("button", { class: "say", type: "button", title: CAPS.voice ? "▶" : t("noVoice"), "aria-label": "▶ " + text, disabled: !CAPS.voice, onclick: () => say(text), html: ICON_SAY });

/* ---------- navegação ---------- */
let ROUTE = { page: S.started ? "map" : "home" }, TAB = {}, CUR = null, RECENT = [], CHAT = [];
function go(page, arg) { ROUTE = { page, arg }; CUR = null; CHAT = []; render(); window.scrollTo(0, 0); }
function header() {
  const r = GAME.role(S.xpTotal);
  const nav = [["home", "🏠"], ["map", "🗺️"], ["arsenal", "📚"], ["report", "📊"], ["shop", "🛒"], ["settings", "⚙️"]];
  return el("header", { class: "top" },
    el("div", { class: "bar" },
      el("button", { class: "brand", onclick: () => go("home") }, th("ท", "logo"), el("b", {}, "ThaiWise")),
      el("div", { class: "hud" }, el("span", { title: t("xp") }, "✨ " + S.xp), el("span", { title: t("streak") }, "🔥 " + S.streak), el("span", {}, (S.title ? (SHOP.find(x => x.id === S.title) || {}).icon + " " : "") + t("role")[r]), el("span", { title: t("mode") }, MODE_ICON[S.mode]))),
    el("nav", { class: "tabs", "aria-label": "ThaiWise" }, nav.map(([p, ic]) => el("button", { "aria-current": ROUTE.page === p ? "page" : null, onclick: () => go(p) }, el("span", { "aria-hidden": "true" }, ic), " ", t(p)))));
}
function render() {
  document.documentElement.setAttribute("data-theme", S.theme === "auto" ? "" : S.theme);
  document.documentElement.lang = S.lang === "pt" ? "pt-BR" : "en";
  const app = $app(); app.innerHTML = ""; app.append(header());
  const main = el("main", {}); app.append(main);
  ({ home: pHome, map: pMap, arsenal: pArsenal, module: pModule, report: pReport, shop: pShop, settings: pSettings, skill: pSkill }[ROUTE.page] || pHome)(main);
}

/* ---------- início ---------- */
const FIVE = [["คา", "kaa", "M", "preso, entalado", "stuck"], ["ข่า", "kàa", "L", "galanga", "galangal"], ["ค่า", "kâa", "F", "valor", "value"], ["ค้า", "káa", "H", "comerciar", "to trade"], ["ขา", "kǎa", "R", "perna", "leg"]];
function pHome(m) {
  const nU = DATA.levels.reduce((a, L) => a + L.units.length, 0), nF = Object.keys(DATA.fsi).length, played = S.log.length > 0;
  add(m, 
    el("section", { class: "hero" },
      el("p", { class: "hero-th", "aria-hidden": "true" }, th("ภาษาไทย")),
      el("h1", {}, "ThaiWise"),
      el("p", { class: "lead" }, t("tagline")),
      el("p", { class: "muted" }, t("stats", { w: DATA.words.length, u: nU, g: Object.values(DATA.grammar).reduce((a, x) => a + x.length, 0), f: nF })),
      el("div", { class: "row" }, el("button", { class: "btn", onclick: () => { S.started = true; save(); go(played ? "map" : "skill", played ? null : "e01"); } }, played ? t("continue") : t("start")), el("button", { class: "btn ghost", onclick: () => go("arsenal") }, "📚 " + t("arsenal")))),
    el("section", { class: "five" }, el("p", { class: "muted" }, t("toneStrip")),
      el("div", { class: "five-row" }, FIVE.map(([w, p, tn, pt, en]) => el("button", { class: "tone-card t" + tn, onclick: () => say(w) }, th(w), paiboon(p), el("small", {}, t("tone_" + tn)), el("span", { class: "muted small" }, S.lang === "en" ? en : pt))))),
    el("section", { class: "pillars" }, ["script", "cefr", "skills", "kt"].map(k => el("article", {}, el("h3", {}, t("p_" + k)), el("p", {}, t("p_" + k + "Txt"))))),
    el("section", { class: "levels-strip" }, DATA.levels.map(L => el("button", { class: "lvl", onclick: () => { S.started = true; save(); go("map", L.lv); } }, el("b", {}, L.lv ? L.code : "ก ข ค"), el("span", {}, L.lv ? L.cu : t("lvScript")), el("span", { class: "muted small" }, L.lv ? (DATA.words.filter(w => w.lv === L.lv).length + " " + t("words")) : "44 · 28 · 5")))),
    el("p", { class: "muted small" }, t("dataNote")), el("p", { class: "muted small" }, t("cefrNote")));
}

/* ---------- mapa ---------- */
function unitChip(u) {
  const st = status(u.id), mm = M(u.id);
  return el("button", { class: "unit " + st, onclick: () => go("skill", u.id), title: L_(u), "aria-label": `${skillName(u.id)}: ${pct(mm)}` },
    el("span", { class: "n" }, st === "locked" ? "🔒" : (u.kind === "script" ? u.w ? u.w[0] : ["", "", "", "", "", "–ะ", "-k", "่", "้"][u.n] : u.n)),
    el("span", { class: "ring", style: `--p:${Math.round(mm * 100)}` }), el("span", { class: "pc" }, st === "locked" ? "" : pct(mm)), el("span", { class: "lbl" }, L_(u)));
}
function pMap(m) {
  const focus = ROUTE.arg;
  DATA.levels.forEach(L => {
    const open = E.levelOpen(S, L.lv, M), them = L.units.filter(u => u.kind !== "fsi"), fsi = L.units.filter(u => u.kind === "fsi");
    const sec = el("section", { class: "level" + (open ? "" : " closed"), id: "lv" + L.lv },
      el("div", { class: "level-h" }, el("h2", {}, L.lv ? L.code : t("lvScript")), L.lv ? el("span", { class: "tag" }, L.cu) : el("span", { class: "tag" }, "pré-A1"),
        el("button", { class: "linkish small", onclick: () => go("module", L.lv) }, "📚 " + t("module") + " " + L.lv)),
      open ? null : el("p", { class: "muted" }, t("lockedLevel"), " ", S.inv.key > 0 ? el("button", { class: "btn small", onclick: () => { S.inv.key--; S.keyed["L" + L.lv] = true; save(); render(); } }, t("useKey", { n: S.inv.key })) : null));
    if (!L.units.length) add(sec, el("p", { class: "muted small" }, t("pending")));
    if (them.length) add(sec, L.lv ? el("h4", { class: "track" }, t("themes")) : null, el("div", { class: "units" }, them.map(unitChip)));
    if (fsi.length) add(sec, el("h4", { class: "track" }, t("fsiTrack")), el("div", { class: "units" }, fsi.map(unitChip)));
    if (L.lv && DATA.grammar[L.lv]) add(sec, el("div", { class: "row" }, el("button", { class: "btn ghost small", disabled: !open, onclick: () => go("module", L.lv) }, "📐 " + t("theory") + " " + L.code + " · " + pct(M("g" + L.lv)))));
    add(m, sec);
  });
  if (focus != null) setTimeout(() => { const n = document.getElementById("lv" + focus); if (n) n.scrollIntoView({ block: "start" }); }, 0);
}

/* ---------- arsenal: um módulo por nível, mesmas abas ---------- */
function pArsenal(m) {
  add(m, el("h2", {}, "📚 " + t("arsenal")), el("p", { class: "muted" }, t("arsenalTxt")));
  DATA.levels.forEach(L => {
    const nw = DATA.words.filter(w => w.lv === L.lv).length, pts = (DATA.grammar[L.lv] || []).length, its = L.lv ? E.grammarItems(L.lv).length : 0, nf = L.units.filter(u => u.kind === "fsi").length;
    const open = E.levelOpen(S, L.lv, M);
    add(m, el("button", { class: "lesson", onclick: () => go("module", L.lv) },
      el("span", { class: "ln" }, L.lv),
      el("span", {}, el("b", {}, `${t("module")} ${L.lv} · ${L.lv ? L.code : t("lvScript")}`), " ", el("span", { class: "tag" }, L.lv ? L.cu : "pré-A1"), open ? null : el("span", { class: "tag" }, "🔒 " + t("locked")), el("br"),
        el("span", { class: "muted small" }, L.lv ? t("modCounts", { w: nw, p: pts, i: its, f: nf }) : "44 consoantes · 28 vogais · 46 sílabas de tom")),
      el("span", { class: "pc" }, L.lv && S.skills["g" + L.lv] ? pct(M("g" + L.lv)) : "—")));
  });
}
function pModule(m) {
  const lv = +ROUTE.arg, L = DATA.levels[lv], key = "m" + lv;
  const tabs = lv === 0 ? ["writing", "theory", "practice", "support"] : ["theory", "practice", "vocab", "fsiTab", "support"];
  if (!TAB[key] || !tabs.includes(TAB[key])) TAB[key] = tabs[0];
  add(m, el("div", { class: "row between" }, el("button", { class: "btn ghost small", onclick: () => go("arsenal") }, "← " + t("back")),
    lv ? el("div", { class: "meter" }, el("span", {}, t("mastery") + " " + pct(M("g" + lv))), el("div", { class: "track" }, el("div", { class: "fill", style: `width:${pct(M("g" + lv))}` }))) : null),
    el("h2", {}, `${t("module")} ${lv} · ${lv ? L.code + " · " + L.cu : t("lvScript")}`),
    el("div", { class: "subtabs", role: "tablist" }, tabs.map(k => el("button", { role: "tab", "aria-selected": TAB[key] === k, onclick: () => { TAB[key] = k; CUR = null; render(); } }, t(k)))));
  const box = el("section", { class: "tabbody" }); add(m, box);
  const tab = TAB[key];
  if (tab === "writing") scriptTables(box);
  else if (tab === "theory") lv === 0 ? theory0(box) : grammarTheory(box, lv);
  else if (tab === "practice") { if (lv === 0) unitList(box, L.units); else if (!E.levelOpen(S, lv, M)) add(box, el("p", { class: "note" }, t("lockedLevel"))); else practice(box, "g" + lv, E.grammarItems(lv)); }
  else if (tab === "vocab") { add(box, el("p", { class: "muted" }, t("modIntro", { c: L.cefr, cu: L.cu, w: DATA.words.filter(w => w.lv === lv).length, u: L.units.length }))); unitList(box, L.units.filter(u => u.kind !== "fsi")); }
  else if (tab === "fsiTab") { const f = L.units.filter(u => u.kind === "fsi"); if (!f.length) add(box, el("p", { class: "note" }, t("fsiNone"))); else unitList(box, f); }
  else if (tab === "support") supportTab(box);
}
function unitList(box, units) { if (!units.length) { add(box, el("p", { class: "muted" }, t("pending"))); return; } add(box, el("div", { class: "units" }, units.map(unitChip))); }
function supportTab(box) {
  const links = [["mat_fsi", "https://www.livelingua.com/fsi/Thai"], ["mat_fsiRG", "https://www.livelingua.com/fsi/Thai"], ["mat_cutfl", "https://www.stli.chula.ac.th"], ["mat_paiboon", "https://www.thai-language.com"], ["mat_cefr", "https://www.coe.int/en/web/common-european-framework-reference-languages"]];
  add(box, el("ul", { class: "links" }, links.map(([k, u]) => el("li", {}, el("a", { href: u, target: "_blank", rel: "noopener" }, t(k))))), el("p", { class: "muted small" }, t("cefrNote")));
}
function grammarTheory(box, lv) {
  const pts = DATA.grammar[lv] || [];
  if (!pts.length) { add(box, el("p", { class: "note" }, t("gramPending"))); return; }
  pts.forEach(g => { const ex = g.ex.map(x => x[0]).join(""); add(box, el("div", { class: "rule" }, el("div", {}, el("h3", {}, g.t), el("p", {}, g.e), el("p", { class: "ex" }, sentence(g.ex), el("span", { class: "tr" }, S.lang === "en" ? g.en : g.pt))), sayBtn(ex))); });
}

/* ---------- módulo 0: tabelas e teoria ---------- */
function scriptTables(box) {
  const C = DATA.script.cons;
  add(box, el("h3", {}, t("th_cons")), el("div", { class: "legend" }, ["M", "H", "L"].map(k => el("span", { class: "chip c" + k }, t("cls_full_" + k)))));
  add(box, el("div", { class: "consgrid" }, C.map(c => el("button", { class: "cons c" + c.cls + (c.obs ? " obs" : ""), onclick: () => say(c.nm), title: c.nmpt },
    th(c.c, "big"), el("small", { class: "th" }, c.nm), rom(c.nmp, c.nmr), el("span", { class: "muted small" }, (c.ini || "∅") + " · -" + (c.fin || "∅") + (c.obs ? " · " + t("obs") : ""))))));
  add(box, el("h3", {}, t("th_vow")), el("div", { class: "scroll" }, el("table", { class: "grid" }, el("tbody", {}, DATA.script.vow.map(v => el("tr", {}, el("td", {}, th(v.f, "big")), el("td", {}, th(v.ex)), el("td", {}, rom(v.p, v.r, "both")), el("td", {}, t("len_" + v.len)), el("td", {}, sayBtn(v.ex))))))));
  const rowT = (lab, a, b, c) => el("tr", {}, el("th", {}, lab), [a, b, c].map(x => el("td", { class: x ? "t" + x : "" }, x ? t("tone_" + x) : "—")));
  add(box, el("h3", {}, t("tonesTable")), el("div", { class: "scroll" }, el("table", { class: "grid tones" },
    el("thead", {}, el("tr", {}, el("th", {}), ["M", "H", "L"].map(k => el("th", {}, t("cls_full_" + k))))),
    el("tbody", {}, rowT(t("t_none_live"), "M", "R", "M"), rowT(t("t_none_dead_s"), "L", "L", "H"), rowT(t("t_none_dead_l"), "L", "L", "F"),
      rowT("่  (mái èek)", "L", "L", "F"), rowT("้  (mái too)", "F", "F", "H"), rowT("๊  (mái dtrii)", "H", null, null), rowT("๋  (mái jàt-dtà-waa)", "R", null, null)))));
}
const THEORY0 = {
  pt: [
    ["Por que começar pela escrita", "O tailandês escreve o tom de forma indireta: ele sai da combinação entre a classe da consoante inicial, o tipo de sílaba e a marca de tom. Analogia: é como calcular o preço final de um produto — preço de tabela (classe) + tipo de pagamento (sílaba viva ou morta) + cupom (marca) dão o valor final (tom). Quem domina a regra lê em voz alta palavras que nunca viu."],
    ["As três classes", "As 44 consoantes se dividem em média (9), alta (11) e baixa (24). A classe não muda o som da consoante, só o tom. Por isso existem letras com o mesmo som em classes diferentes: ข (alta) e ค (baixa) soam k. Analogia: são dois interruptores ligando a mesma lâmpada, cada um num circuito de tom diferente."],
    ["Vogais em volta da consoante", "A vogal pode vir depois (กา), antes (เก), acima (กิ), abaixo (กุ) ou em volta (เกีย) da consoante, mas sempre se pronuncia depois dela. Cada vogal tem par curto e longo, e a duração muda o significado. Analogia: a consoante é o centro de uma bússola, e a vogal pode ficar em qualquer direção, mas o som sai sempre na mesma ordem."],
    ["Finais: só oito sons", "No fim da sílaba, dezenas de letras se reduzem a oito sons: k, t, p (oclusivos, sem soltar o ar), n, m, ng e as semivogais i (ย) e o (ว). Por isso ด, ต, จ, ส e outras terminam todas em t."],
    ["Sílaba viva e sílaba morta", "Viva: termina em vogal longa ou em som que continua (n, m, ng, i, o), além de –ำ, ใ–, ไ–, เ–า. Morta: termina em vogal curta ou em k, t, p. Analogia: a viva é uma nota que você pode sustentar cantando; a morta é uma batida seca de tambor."],
    ["A regra dos tons", "Sem marca: média viva = médio; alta viva = ascendente; baixa viva = médio; média ou alta morta = baixo; baixa morta curta = alto, baixa morta longa = descendente. Com ่ (mái èek): média e alta = baixo, baixa = descendente. Com ้ (mái too): média e alta = descendente, baixa = alto. ๊ e ๋ só aparecem com consoantes médias e dão alto e ascendente. A tabela na aba Escrita resume tudo."],
    ["ห e อ líderes", "Um ห mudo antes de uma consoante baixa sonora (ง ญ น ม ย ร ล ว) faz a sílaba seguir a classe alta: หมา = mǎa. Um อ mudo antes de ย faz seguir a classe média, em quatro palavras: อย่า, อยู่, อย่าง, อยาก."],
    ["Como ler a romanização", "Paiboon+ marca tudo: vogal dobrada = longa (aa), acentos = tons (à baixo, â descendente, á alto, ǎ ascendente, sem acento = médio), bp e dt = p e t sem aspiração, p, t, k = aspirados, ʉ = 'u' com lábios abertos, ɛ = é aberto, ɔ = ó aberto, ə = 'e' fechado sem arredondar. O RTGS é a romanização oficial das placas: não marca tom nem duração, escreve ph, th, kh para os aspirados e ue, ae, o, oe para as vogais. Analogia: o Paiboon é a partitura com as notas; o RTGS é só a letra da música."]
  ],
  en: [
    ["Why start with the script", "Thai writes tone indirectly: it comes from the initial consonant's class, the syllable type and the tone mark. Analogy: like working out a final price — list price (class) + payment type (live or dead syllable) + coupon (mark) give the total (tone). Know the rule and you can read aloud words you've never seen."],
    ["The three classes", "The 44 consonants split into middle (9), high (11) and low (24). Class doesn't change the consonant's sound, only the tone, which is why ข (high) and ค (low) both sound k. Analogy: two switches wired to the same bulb, each on a different tone circuit."],
    ["Vowels around the consonant", "A vowel can sit after (กา), before (เก), above (กิ), below (กุ) or around (เกีย) the consonant, but it's always pronounced after it. Each vowel has a short and a long partner, and length changes meaning."],
    ["Finals: only eight sounds", "At the end of a syllable, dozens of letters collapse into eight sounds: k, t, p (unreleased), n, m, ng and the glides i (ย) and o (ว)."],
    ["Live and dead syllables", "Live: ends in a long vowel or a sound you can hold (n, m, ng, i, o), plus –ำ, ใ–, ไ–, เ–า. Dead: ends in a short vowel or k, t, p. Analogy: a live syllable is a note you can sustain; a dead one is a dry drum hit."],
    ["The tone rules", "No mark: middle live = mid; high live = rising; low live = mid; middle or high dead = low; low dead short = high, low dead long = falling. With ่: middle and high = low, low = falling. With ้: middle and high = falling, low = high. ๊ and ๋ appear only on middle consonants (high and rising). See the table in the Script tab."],
    ["Leading ห and อ", "A silent ห before a low sonorant (ง ญ น ม ย ร ล ว) makes the syllable follow the high class: หมา = mǎa. A silent อ before ย makes it follow the middle class, in four words: อย่า, อยู่, อย่าง, อยาก."],
    ["Reading the romanisation", "Paiboon+ marks everything: doubled vowel = long, accents = tones (à low, â falling, á high, ǎ rising, none = mid), bp and dt = unaspirated p and t, p t k = aspirated. RTGS is the official road-sign system: no tones, no length, ph th kh for aspirates. Analogy: Paiboon is the sheet music; RTGS is just the lyrics."]
  ]
};
function theory0(box) {
  add(box, el("div", { class: "legend" }, el("b", {}, t("legend") + ": "), ["M", "L", "F", "H", "R"].map(k => el("span", { class: "chip t" + k }, t("tone_" + k)))));
  THEORY0[S.lang === "en" ? "en" : "pt"].forEach(([h, p]) => add(box, el("div", { class: "rule" }, el("div", {}, el("h3", {}, h), el("p", {}, p)))));
}

/* ---------- página de unidade ---------- */
function pSkill(m) {
  const s = ROUTE.arg, u = E.UNITS[s]; if (!u) return go("map");
  const open = E.skillOpen(S, s, M), items = E.itemsFor(s, CAPS);
  const tabs = u.kind === "script" ? ["practice", "writing"] : u.kind === "fsi" ? ["practice", "dialog", "vocab", "notes"] : ["practice", "vocab"];
  if (!TAB[s] || !tabs.includes(TAB[s])) TAB[s] = open ? "practice" : tabs[1];
  add(m, el("div", { class: "row between" }, el("button", { class: "btn ghost small", onclick: () => go("map", u.lv) }, "← " + t("back")),
    el("div", { class: "meter" }, el("span", {}, t("mastery") + " " + pct(M(s))), el("div", { class: "track" }, el("div", { class: "fill", style: `width:${pct(M(s))}` })))),
    el("h2", {}, skillName(s)), u.kind === "fsi" && DATA.fsi[u.n] ? el("p", { class: "muted" }, DATA.fsi[u.n].titulo ? L_(DATA.fsi[u.n].titulo) : "") : null);
  if (!open) add(m, el("p", { class: "note" }, E.levelOpen(S, u.lv, M) ? t("lockedUnit") : t("lockedLevel"), " ",
    S.inv.key > 0 ? el("button", { class: "btn small", onclick: () => { S.inv.key--; S.keyed[s] = true; if (!E.levelOpen(S, u.lv, M)) S.keyed["L" + u.lv] = true; save(); render(); } }, t("useKey", { n: S.inv.key })) : null));
  add(m, el("div", { class: "subtabs", role: "tablist" }, tabs.map(k => el("button", { role: "tab", "aria-selected": TAB[s] === k, disabled: k === "practice" && !open, onclick: () => { TAB[s] = k; CUR = null; render(); } }, t(k)))));
  const box = el("section", { class: "tabbody" }); add(m, box);
  const tab = TAB[s];
  if (tab === "practice") practice(box, s, items);
  else if (tab === "vocab") wordsTab(box, u.w);
  else if (tab === "writing") unitScriptRef(box, u);
  else if (tab === "dialog") fsiDialog(box, u.n);
  else if (tab === "notes") fsiNotes(box, u.n);
}
function wordsTab(box, list) {
  add(box, el("div", { class: "scroll" }, el("table", { class: "words" }, el("tbody", {}, list.map(z => { const w = E.WORD[z]; if (!w) return null;
    return el("tr", {}, el("td", {}, th(w.t, "big")), el("td", {}, rom(w.p, w.r, S.rom === "off" ? "both" : null)), el("td", {}, E.gloss(w, S.lang)), el("td", {}, sayBtn(w.t))); })))));
}
function unitScriptRef(box, u) {
  const S0 = DATA.script;
  if (u.w) add(box, el("div", { class: "consgrid" }, u.w.map(ch => { const c = E.CONS[ch]; return el("button", { class: "cons c" + c.cls, onclick: () => say(c.nm) }, th(c.c, "big"), el("small", { class: "th" }, c.nm), rom(c.nmp, c.nmr), el("span", { class: "muted small" }, c.nmpt + " · " + t("cls_" + c.cls))); })));
  else if (u.id === "e05") scriptTables(box);
  else { const rows = S0.syl.filter(x => u.id === "e06" || x.u === u.id); add(box, el("div", { class: "scroll" }, el("table", { class: "grid" }, el("tbody", {}, rows.map(x => el("tr", {}, el("td", {}, th(x.t, "big")), el("td", {}, paiboon(x.p)), el("td", {}, why(x)), el("td", {}, sayBtn(x.t)))))))); }
}
function why(x) {
  const mk = x.mark ? ["", "่", "้", "๊", "๋"][x.mark] : t("mark_0");
  const s = t("whyTone", { cls: t("cls_full_" + x.cls).toLowerCase(), live: t("live_" + x.live), long: x.live ? "" : " (" + t("len_" + (x.long ? "l" : "s")) + ")", mark: mk, tone: t("tone_" + x.tone) });
  return el("span", {}, s, x.lead ? el("small", { class: "muted" }, " · " + t(x.lead === "h" ? "leadH" : "leadO")) : null);
}
function fsiDialog(box, n) {
  const L = DATA.fsi[n]; if (!L) { add(box, el("p", { class: "note" }, t("fsiNone"))); return; }
  const lines = L.dialogo || [];
  add(box, el("div", { class: "row" }, el("button", { class: "btn ghost small", disabled: !CAPS.voice, onclick: () => { let i = 0; const nx = () => { if (i < lines.length) say(lines[i++].s.map(x => x[0]).join(""), nx); }; nx(); } }, "▶ " + t("playDialog"))),
    el("ol", { class: "dlg" }, lines.map(d => el("li", {}, el("span", { class: "sp " + d.sp }, d.sp), el("div", {}, sentence(d.s), el("div", { class: "tr" }, S.lang === "en" ? d.en : d.pt)), sayBtn(d.s.map(x => x[0]).join(""))))),
    el("p", { class: "muted small" }, t("dialogHint")), el("p", { class: "muted small" }, t("fsiSource", { n })));
}
function fsiNotes(box, n) {
  const L = DATA.fsi[n]; if (!L || !(L.notas || []).length) { add(box, el("p", { class: "muted" }, "—")); return; }
  L.notas.forEach(x => add(box, el("div", { class: "rule" }, el("div", {}, el("h3", {}, L_(x.t)), el("p", {}, L_(x.e)), x.ex ? el("p", { class: "ex" }, sentence(x.ex)) : null))));
  add(box, el("p", { class: "muted small" }, t("fsiSource", { n })));
}

/* ---------- prática adaptativa ---------- */
function optLabel(o, it) {
  if (it.type === "cls") return t("cls_full_" + o.key);
  if (it.type === "tone") return el("span", { class: "chip t" + o.key }, t("tone_" + o.key));
  if (it.type === "vlen") return t("len_" + o.key);
  if (it.type === "live") return t("live_" + o.key);
  if (o.rom) return o.label === o.key && it.type === "rom" ? paiboon(o.label) : el("span", { class: "rom" }, o.label);
  if (o.th) return el("span", {}, th(o.label), it.type === "gap" && o.p ? rom(o.p, o.r) : null);
  return o.label;
}
function practice(box, s, items) {
  if (!items.length) { add(box, el("p", { class: "muted" }, "—")); return; }
  if (!CUR || CUR.skill !== s) {
    const it = E.pick(items, M(s), RECENT, S.solved);
    CUR = { skill: s, it, seed: Date.now(), done: false, hint: false, removed: [], order: [] };
    RECENT.push(it.id); if (RECENT.length > 12) RECENT.shift();
  }
  const { it } = CUR, w = E.wordOf(it), Sc = DATA.script;
  const card = el("div", { class: "q" });
  add(card, el("div", { class: "kind" }, t("kind_" + it.type), el("span", { class: "tag plain" }, t("dim_" + it.dim)), el("span", { class: "tag plain" }, "d" + it.d)));
  const fb = el("div", { class: "feedback", "aria-live": "polite" });
  const speakOf = () => w ? w.t : it.ch ? E.CONS[it.ch].nm : it.v != null ? Sc.vow[it.v].ex : it.sy != null ? Sc.syl[it.sy].t : it.g ? it.g.s.map(x => x[0] === "___" ? it.g.a : x[0]).join("") : it.s ? it.s.t.map(x => x[0]).join("") : it.dl != null ? DATA.fsi[E.UNITS[it.skill].n].dialogo[it.dl].s.map(x => x[0]).join("") : "";
  const finish = (ok, extra) => {
    if (CUR.done) return; CUR.done = true;
    const x = record(it, ok, { hint: CUR.hint, extra: extra && extra.log });
    fb.className = "feedback show " + (ok ? "ok" : "no"); fb.innerHTML = "";
    const key = E.answerKey(it, S.lang);
    const ans = it.type === "read" ? E.gloss(w, S.lang) : it.type === "cls" ? t("cls_full_" + key) : it.type === "tone" ? t("tone_" + key) : it.type === "vlen" ? t("len_" + key) : it.type === "live" ? t("live_" + key) : it.type === "fin" ? "-" + key : key;
    add(fb, el("b", {}, ok ? t("correct") : t("wrongAns", { a: ans })), " ", el("span", { class: "xpd" }, (x >= 0 ? "+" : "") + x + " XP"));
    if (w) add(fb, el("div", { class: "full" }, th(w.t), " ", rom(w.p, w.r, "both"), " — ", E.gloss(w, S.lang)));
    else if (it.ch) { const c = E.CONS[it.ch]; add(fb, el("div", { class: "full" }, th(c.c), " ", th(c.nm), " ", rom(c.nmp, c.nmr, "both"), " — ", c.nmpt, " · ", t("cls_full_" + c.cls), " · ", (c.ini || "∅") + " / -" + (c.fin || "∅"))); }
    else if (it.sy != null) { const y = Sc.syl[it.sy]; add(fb, el("div", { class: "full" }, th(y.t), " ", paiboon(y.p), " — ", y.pt), el("div", { class: "muted" }, why(y))); }
    else if (it.v != null) { const v = Sc.vow[it.v]; add(fb, el("div", { class: "full" }, th(v.f), " ", th(v.ex), " ", rom(v.p, v.r, "both"), " · ", t("len_" + v.len))); }
    else if (it.g) add(fb, el("div", { class: "full" }, sentence(it.g.s.map(x => x[0] === "___" ? (it.g.o.find(o => o[0] === it.g.a) || [it.g.a, "", ""]) : x))), el("div", { class: "muted" }, it.g.x));
    else if (it.s) add(fb, el("div", { class: "full" }, sentence(it.s.t)), el("div", { class: "muted" }, S.lang === "en" ? it.s.en : it.s.pt));
    else if (it.dl != null) { const d = DATA.fsi[E.UNITS[it.skill].n].dialogo[it.dl]; add(fb, el("div", { class: "full" }, sentence(d.s)), el("div", { class: "muted" }, S.lang === "en" ? d.en : d.pt)); }
    if (extra && extra.msg) add(fb, el("div", { class: "muted" }, extra.msg));
    card.querySelectorAll("button.opt,.tok,.act").forEach(b => b.disabled = true);
    say(speakOf());
    nextRow.hidden = false; nextRow.querySelector("button").focus();
    meter(s);
  };
  const nextRow = el("div", { class: "row end", hidden: true }, el("button", { class: "btn", onclick: () => { CUR = null; CHAT = []; render(); } }, t("next") + " →"));
  const mc = (prompt, opts) => {
    add(card, prompt);
    const key = E.answerKey(it, S.lang), grid = el("div", { class: "opts" + (opts.length === 2 ? " two" : opts.length > 5 ? " many" : "") });
    opts.forEach(o => { if (CUR.removed.includes(o.key)) return; grid.append(el("button", { class: "opt", "data-k": o.key, onclick: e => { const ok = o.key === key; grid.querySelectorAll(".opt").forEach(b => { if (b.dataset.k === key) b.classList.add("ok"); }); if (!ok) e.currentTarget.classList.add("no"); finish(ok); } }, optLabel(o, it))); });
    add(card, grid);
    if (MODES[S.mode].hint && S.inv.lens > 0 && !CUR.done && opts.length > 3) add(card, el("button", { class: "btn ghost small act", onclick: () => { S.inv.lens--; CUR.hint = true; CUR.removed = E.shuffle(opts.filter(o => o.key !== key)).slice(0, 2).map(o => o.key); save(); render(); } }, "🔍 " + t("lens", { n: S.inv.lens })));
    if (CUR.hint) add(card, el("p", { class: "muted small" }, t("lensUsed")));
  };
  const opts = E.options(it, S.lang, CUR.seed);
  const big = (txt, sub) => el("div", { class: "prompt center" }, th(txt, "huge"), sub || null);
  switch (it.type) {
    case "read": mc(big(w.t, rom(w.p, w.r)), opts); break;
    case "rom": mc(big(w.t, el("div", { class: "muted" }, E.gloss(w, S.lang))), opts); break;
    case "translate": mc(el("div", { class: "prompt center big-gloss" }, E.gloss(w, S.lang)), opts); break;
    case "listen": mc(el("div", { class: "prompt center" }, el("button", { class: "btn act", onclick: () => say(w.t) }, "▶ " + t("playAgain"))), opts); if (!CUR.played) { CUR.played = true; setTimeout(() => say(w.t), 300); } break;
    case "speak": speakBody(card, w, finish); break;
    case "spell": spellBody(card, w, finish); break;
    case "cls": case "ini": case "fin": mc(big(it.ch, it.type === "fin" ? el("div", { class: "muted" }, th("–" + it.ch, "")) : null), opts); break;
    case "letter": { const c = E.CONS[it.ch]; mc(el("div", { class: "prompt center" }, rom(c.nmp, c.nmr, "both"), el("div", { class: "muted" }, c.nmpt)), opts); break; }
    case "lsn": { const c = E.CONS[it.ch]; mc(el("div", { class: "prompt center" }, el("button", { class: "btn act", onclick: () => say(c.nm) }, "▶ " + t("playAgain"))), opts); if (!CUR.played) { CUR.played = true; setTimeout(() => say(c.nm), 300); } break; }
    case "vrom": { const v = Sc.vow[it.v]; mc(big(v.ex, el("div", { class: "muted" }, th(v.f))), opts); break; }
    case "vlen": { const v = Sc.vow[it.v]; mc(big(v.f, el("div", { class: "muted" }, th(v.ex))), opts); break; }
    case "vlsn": { const v = Sc.vow[it.v]; mc(el("div", { class: "prompt center" }, el("button", { class: "btn act", onclick: () => say(v.ex) }, "▶ " + t("playAgain"))), opts); if (!CUR.played) { CUR.played = true; setTimeout(() => say(v.ex), 300); } break; }
    case "live": case "tone": { const y = Sc.syl[it.sy]; mc(big(y.t, S.lang === "pt" ? el("div", { class: "muted" }, y.pt) : null), opts); break; }
    case "gap": mc(el("div", { class: "prompt" }, sentence(it.g.s), it.g.h ? el("div", { class: "muted" }, it.g.h) : null), opts); break;
    case "order": orderBody(card, it, finish); break;
    case "dmean": { const d = DATA.fsi[E.UNITS[it.skill].n].dialogo[it.dl]; mc(el("div", { class: "prompt" }, el("span", { class: "sp " + d.sp }, d.sp), " ", sentence(d.s)), opts); break; }
  }
  add(card, fb, nextRow);
  add(box, el("p", { class: "muted small" }, t("nextChosen")), card);
  tutorPanel(box, it);
}
function meter(s) { const f = document.querySelector(".meter .fill"), l = document.querySelector(".meter span"); if (f) f.style.width = pct(M(s)); if (l) l.textContent = t("mastery") + " " + pct(M(s)); const h = document.querySelector(".hud"); if (h) { h.children[0].textContent = "✨ " + S.xp; h.children[1].textContent = "🔥 " + S.streak; } }
function tiles(card, pieces, target, finish, render1, check) {
  if (!CUR.pool) CUR.pool = E.shuffle(pieces.map((x, i) => ({ x, i })));
  const slot = el("div", { class: "slot" }), pool = el("div", { class: "pool" });
  const draw = () => {
    slot.innerHTML = ""; pool.innerHTML = "";
    if (!CUR.order.length) add(slot, el("span", { class: "muted" }, t("tapTiles")));
    CUR.order.forEach((o, k) => add(slot, el("button", { class: "tok", disabled: CUR.done, onclick: () => { CUR.order.splice(k, 1); draw(); } }, render1(o.x))));
    CUR.pool.filter(p => !CUR.order.includes(p)).forEach(p => add(pool, el("button", { class: "tok", disabled: CUR.done, onclick: () => { CUR.order.push(p); draw(); } }, render1(p.x))));
    chk.disabled = CUR.done || CUR.order.length !== target;
  };
  const chk = el("button", { class: "btn act", onclick: () => finish(check(CUR.order.map(o => o.x))) }, t("check"));
  add(card, slot, pool, el("div", { class: "row end" }, el("button", { class: "btn ghost act", onclick: () => { CUR.order = []; draw(); } }, t("clear")), chk));
  draw();
}
function orderBody(card, it, finish) {
  add(card, el("div", { class: "prompt" }, S.lang === "en" ? it.s.en : it.s.pt));
  const want = it.s.t.map(x => x[0]).join("");
  tiles(card, it.s.t, it.s.t.length, finish, x => el("span", {}, th(x[0]), S.rom !== "off" ? el("small", { class: "rom" }, S.rom === "rtgs" ? x[2] : x[1]) : null), got => got.map(x => x[0]).join("") === want);
}
function spellBody(card, w, finish) {
  const cl = E.clusters(w.t);
  if (!CUR.extra) { const r = E.rng(w.t + CUR.seed), pool = E.shuffle(DATA.words.filter(x => x.lv === w.lv && x.t !== w.t), r).flatMap(x => E.clusters(x.t)).filter(c => !cl.includes(c)); CUR.extra = [...new Set(pool)].slice(0, 2); }
  add(card, el("div", { class: "prompt center" }, el("div", { class: "big-gloss" }, E.gloss(w, S.lang)), rom(w.p, w.r, S.rom === "off" ? "paiboon" : null)), el("p", { class: "muted small" }, t("spellNote")));
  tiles(card, cl.concat(CUR.extra), cl.length, finish, x => th(x, "tile"), got => got.join("") === w.t);
}
function speakBody(card, w, finish) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, heard = el("p", { class: "muted" });
  add(card, el("div", { class: "prompt center" }, th(w.t, "huge"), rom(w.p, w.r), el("div", { class: "muted" }, E.gloss(w, S.lang))));
  const btn = el("button", { class: "btn act", onclick: () => {
    const r = new SR(); r.lang = "th-TH"; r.maxAlternatives = 5; r.interimResults = false; btn.textContent = t("speakListening"); btn.disabled = true;
    r.onresult = e => {
      const alts = [...e.results[0]].map(a => a.transcript.replace(/[\s.,?!]/g, ""));
      if (!alts.some(a => /[\u0E00-\u0E7F]/.test(a))) { CUR.notTh = true; btn.disabled = false; btn.textContent = "🎙️ " + t("speakStart"); heard.textContent = t("speakNotTh", { x: alts[0] || "" }); return; }
      btn.textContent = "🎙️ " + t("speakStart");
      finish(alts.some(a => a.includes(w.t)), { log: { heard: alts.slice(0, 3) }, msg: t("speakHeard", { x: alts[0] || "" }) });
    };
    r.onerror = r.onend = () => { if (!CUR.done && !CUR.notTh) { btn.disabled = false; btn.textContent = "🎙️ " + t("speakStart"); heard.textContent = t("speakNone"); } CUR.notTh = false; };
    try { r.start(); } catch (e) { btn.disabled = false; }
  } }, "🎙️ " + t("speakStart"));
  add(card, el("div", { class: "row center" }, el("button", { class: "btn ghost act", onclick: () => say(w.t) }, "▶"), btn, el("button", { class: "btn ghost act", onclick: () => { CUR = null; render(); } }, t("skip"))), heard);
}

/* ---------- tutor de IA ---------- */
function tutorPanel(box, it) {
  const w = E.wordOf(it), panel = el("details", { class: "tutor" }, el("summary", {}, "🤖 " + t("tutor")));
  if (!LLM.ready()) { add(panel, el("p", { class: "muted" }, t("tutorNoKey"), " ", el("button", { class: "linkish", onclick: () => go("settings") }, t("settings")))); add(box, panel); return; }
  const log = el("div", { class: "chat" }), inp = el("textarea", { rows: 2, placeholder: t("tutorAsk") }), st = el("p", { class: "muted small" });
  const draw = () => { log.innerHTML = ""; CHAT.forEach(m => log.append(el("div", { class: "msg " + m.role }, m.content))); };
  const ctx = () => {
    const Sc = DATA.script;
    const item = w ? `palavra-alvo: ${w.t} (${w.p}; RTGS ${w.r}) = ${E.gloss(w, S.lang)}` : it.ch ? `consoante ${it.ch}, ${E.CONS[it.ch].nm} (${E.CONS[it.ch].nmp}), classe ${E.CONS[it.ch].cls}` : it.sy != null ? `sílaba ${Sc.syl[it.sy].t} (${Sc.syl[it.sy].p})` : it.v != null ? `vogal ${Sc.vow[it.v].f}` : it.g ? `lacuna: ${it.g.s.map(x => x[0]).join("")} opções: ${it.g.o.map(o => o[0]).join(" / ")}` : it.s ? `montar: ${it.s.pt}` : "";
    return `Você é tutor de tailandês no ThaiWise (nível ${it.lv ? LVCODE(it.lv) : "escrita e tons"}). Responda em ${S.lang === "pt" ? "português do Brasil" : "English"}, curto, com analogias práticas, sempre com escrita tailandesa e Paiboon+ (tons marcados). ` +
      `Ao explicar tons, aplique a regra: classe da consoante + sílaba viva/morta (+ duração) + marca de tom. Exercício (${t("kind_" + it.type)}, dimensão ${it.dim}): ${item}. Já respondido: ${CUR && CUR.done ? "sim" : "não"}. ` +
      (CUR && CUR.done ? `Resposta certa: ${E.answerKey(it, S.lang)}. Explique por quê. ` : `Não revele a resposta; dê pistas e faça uma pergunta que leve o estudante a descobrir.`);
  };
  const send = async () => { const q = inp.value.trim(); if (!q) return; CHAT.push({ role: "user", content: q }); inp.value = ""; draw(); st.textContent = "…";
    try { const a = await LLM.chat(ctx(), CHAT, s => { st.textContent = s.wait ? t("tutorWait", { m: s.model, a: s.attempt }) : t("tutorFallback", { m: s.model }); }); CHAT.push({ role: "assistant", content: a }); st.textContent = ""; } catch (e) { st.textContent = "⚠️ " + e.message; } draw(); };
  add(panel, log, inp, el("div", { class: "row end" }, el("button", { class: "btn small", onclick: send }, t("tutorSend"))), st);
  draw(); add(box, panel);
}

/* ---------- relatório ---------- */
function statsOf(skill) { const rows = S.log.filter(l => l.skill === skill); return { n: rows.length, acc: rows.length ? rows.filter(l => l.ok).length / rows.length : null }; }
function pReport(m) {
  const all = S.log, acc = all.length ? all.filter(l => l.ok).length / all.length : null;
  add(m, el("div", { class: "row between noprint" }, el("h2", {}, "📊 " + t("repTitle")), el("div", { class: "row" }, el("button", { class: "btn ghost small", onclick: () => window.print() }, t("print")), el("button", { class: "btn small", onclick: exportJSON }, t("export")))),
    el("h2", { class: "printonly" }, "ThaiWise · " + t("repTitle")),
    el("p", {}, el("b", {}, S.name || "—"), " · ", new Date().toLocaleDateString(S.lang === "pt" ? "pt-BR" : "en"), " · ", t("role")[GAME.role(S.xpTotal)], " · ✨ " + S.xpTotal + " XP"),
    el("div", { class: "stats" }, el("div", {}, el("b", {}, all.length), t("answers")), el("div", {}, el("b", {}, acc == null ? "—" : pct(acc)), t("accuracy")), el("div", {}, el("b", {}, Object.keys(S.skills).filter(k => M(k) >= KT.master(PILOT)).length), t("mastered"))));
  const lvls = DATA.levels.filter(L => L.units.length);
  add(m, el("h3", {}, t("repSkills")), el("div", { class: "scroll" }, el("table", { class: "grid" }, el("thead", {}, el("tr", {}, el("th", {}, t("colSkill")), lvls.map(L => el("th", {}, L.lv ? L.code : "ก")))),
    el("tbody", {}, E.DIMS.map(d => el("tr", {}, el("td", {}, t("dim_" + d)), lvls.map(L => { const tr = S.dims[L.lv + ":" + d]; return el("td", {}, tr && tr.n ? el("span", { class: "cellbar", style: `--p:${Math.round(KT.mastery(tr, PILOT) * 100)}` }, pct(KT.mastery(tr, PILOT)), el("small", {}, " n=" + tr.n)) : el("span", { class: "muted" }, "—")); })))))));
  if (!CAPS.voice) add(m, el("p", { class: "muted small" }, t("noVoice"))); if (!CAPS.mic) add(m, el("p", { class: "muted small" }, t("noMic")));
  add(m, el("h3", {}, t("repLevels")));
  lvls.forEach(L => {
    const ids = L.units.map(u => u.id).concat(L.lv && DATA.grammar[L.lv] ? ["g" + L.lv] : []); if (!ids.some(id => S.skills[id] && S.skills[id].n) && !E.levelOpen(S, L.lv, M)) return;
    add(m, el("h4", {}, L.lv ? L.code + " · " + L.cu : t("lvScript")), el("div", { class: "scroll" }, el("table", { class: "grid" }, el("thead", {}, el("tr", {}, ["colSkill", "colN", "colAcc", "colMastery", "colStatus"].map(k => el("th", {}, t(k))))),
      el("tbody", {}, ids.map(id => { const s = statsOf(id), st = status(id); return el("tr", { class: st }, el("td", {}, skillName(id)), el("td", {}, s.n), el("td", {}, s.acc == null ? "—" : pct(s.acc)), el("td", {}, S.skills[id] && S.skills[id].n ? pct(M(id)) : t("notYet")), el("td", {}, t("st_" + st))); })))));
  });
  const todo = []; Object.keys(S.skills).forEach(id => { if (id[0] === "g" || status(id) === "locked") return; const its = E.itemsFor(id, CAPS), miss = its.filter(i => !S.solved[i.id]).length; if (miss) todo.push(el("li", {}, skillName(id) + ": " + t("itemsLeft", { n: miss }))); });
  add(m, el("h3", {}, t("repTodo")), todo.length ? el("ul", {}, todo.slice(0, 20)) : el("p", { class: "muted" }, t("nothingLeft")));
  add(m, el("h3", {}, t("repModels")), el("div", { class: "scroll" }, el("table", { class: "grid" }, el("thead", {}, el("tr", {}, ["", "n", "Brier ↓", "AUC ↑", "Acc ↑"].map(x => el("th", {}, x)))),
    el("tbody", {}, KT.IDS.map(k => { const sc = KT.score(all, k); return el("tr", {}, el("td", {}, k + (k === PILOT ? " (piloto)" : "")), el("td", {}, sc ? sc.n : 0), el("td", {}, sc ? sc.brier.toFixed(3) : "—"), el("td", {}, sc && sc.auc != null ? sc.auc.toFixed(3) : "—"), el("td", {}, sc ? pct(sc.acc) : "—")); })))));
}
function exportJSON() {
  const data = { app: "ThaiWise", version: 1, exported: new Date().toISOString(), student: S.name || null, pilot: PILOT, settings: { lang: S.lang, mode: S.mode, free: S.free, rom: S.rom },
    mastery: Object.fromEntries(Object.keys(S.skills).map(k => [k, +M(k).toFixed(4)])), dims: Object.fromEntries(Object.keys(S.dims).map(k => [k, +KT.mastery(S.dims[k], PILOT).toFixed(4)])), log: S.log };
  const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: `thaiwise-${(S.name || "log").replace(/\W+/g, "_")}-${Date.now()}.json` }); document.body.append(a); a.click(); a.remove();
}

/* ---------- loja ---------- */
function pShop(m) {
  add(m, el("h2", {}, "🛒 " + t("shop")), el("p", { class: "muted" }, t("shopTxt"), " ✨ " + S.xp + " XP"));
  const msg = el("p", { class: "muted", "aria-live": "polite" });
  add(m, el("div", { class: "shop" }, SHOP.map(x => {
    const own = x.kind === "title" && S.titles.includes(x.id);
    return el("article", {}, el("div", { class: "ic" + (x.kind === "title" ? " th" : "") }, x.icon), el("p", {}, t("shop_" + x.id)), x.kind === "power" ? el("small", { class: "muted" }, "× " + (x.id === "boost" ? S.boost : S.inv[x.id])) : null,
      own ? el("button", { class: "btn ghost small", onclick: () => { S.title = S.title === x.id ? null : x.id; save(); render(); } }, S.title === x.id ? "✓ " + t("owned") : t("equip"))
        : el("button", { class: "btn small", onclick: () => { if (S.xp < x.cost) { msg.textContent = t("notEnough"); return; } S.xp -= x.cost; if (x.kind === "title") S.titles.push(x.id); else if (x.id === "boost") S.boost += 5; else S.inv[x.id]++; save(); render(); } }, t("buy") + " · " + x.cost + " XP"));
  })), msg);
}

/* ---------- ajustes ---------- */
function pSettings(m) {
  const sel = (label, val, opts, on) => el("label", { class: "field" }, el("span", {}, label), el("select", { onchange: e => on(e.target.value) }, opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l))));
  const chk = (label, val, on) => el("label", { class: "check" }, el("input", { type: "checkbox", checked: val, onchange: e => on(e.target.checked) }), el("span", {}, label));
  add(m, el("h2", {}, "⚙️ " + t("settings")),
    sel(t("rom"), S.rom, ["both", "paiboon", "rtgs", "off"].map(k => [k, t("rom_" + k)]), v => { S.rom = v; save(); render(); }),
    el("p", { class: "muted small" }, "สวัสดี → ", rom("sà-wàt-dii", "sawatdi")),
    chk(t("toneColors"), S.tcol, v => { S.tcol = v; save(); render(); }),
    sel(t("lang"), S.lang, [["pt", "Português"], ["en", "English"]], v => { S.lang = v; save(); render(); }),
    sel(t("mode"), S.mode, Object.keys(MODES).map(k => [k, MODE_ICON[k] + " " + t("mode_" + k)]), v => { S.mode = v; save(); render(); }),
    sel(t("theme"), S.theme, [["auto", t("theme_auto")], ["light", t("theme_light")], ["dark", t("theme_dark")]], v => { S.theme = v; save(); render(); }),
    chk(t("freeTxt"), S.free, v => { S.free = v; save(); render(); }),
    el("label", { class: "field" }, el("span", {}, t("name")), el("input", { value: S.name, onchange: e => { S.name = e.target.value; save(); } })));
  add(m, el("h3", {}, t("capsTitle")), el("ul", {}, el("li", {}, (CAPS.voice ? "✅ " + t("voiceOk") : "❌ " + t("noVoice"))), el("li", {}, (CAPS.mic ? "✅ " + t("micOk") : "❌ " + t("noMic")))));
  const c = LLM.cfg(), ok = el("span", { class: "muted" });
  const pv = el("select", {}, Object.entries(PROVIDERS).map(([k, p]) => el("option", { value: k, selected: k === c.provider }, p.name)));
  const key = el("input", { type: "password", value: c.key, autocomplete: "off" }), mod = el("input", { value: c.model }), url = el("input", { value: c.url, placeholder: "https://…/v1/chat/completions" });
  add(m, el("h3", {}, "🤖 " + t("llmH")), el("label", { class: "field" }, el("span", {}, t("provider")), pv), el("label", { class: "field" }, el("span", {}, t("apiKey")), key),
    el("label", { class: "field" }, el("span", {}, t("model")), mod), el("label", { class: "field" }, el("span", {}, t("url")), url), el("p", { class: "muted small" }, t("keyNote")),
    el("div", { class: "row" }, el("button", { class: "btn small", onclick: () => { LLM.save({ provider: pv.value, key: key.value.trim(), model: mod.value.trim(), url: url.value.trim() }); ok.textContent = t("saved"); } }, t("save")), ok),
    el("hr"), el("button", { class: "btn danger small", onclick: () => { if (confirm(t("resetConfirm"))) { const lang = S.lang; S = fresh(); S.lang = lang; save(); go("home"); } } }, t("reset")));
}

render();
