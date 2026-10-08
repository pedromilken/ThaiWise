/* Adaptador do laboratório de agentes: THAIWISE (tailandês, CEFR ↔ CU-TFL, lições do FSI).
   O núcleo (laboratorio.js) é o mesmo nas cinco ferramentas; este arquivo só diz ao núcleo o que é um item, o que o
   agente "estudou" (notas) e como corrigir. Tudo vem do motor sem DOM do próprio ThaiWise (src/engine.js).

   Itens: os do jogo, com as mesmas opções (E.options) e o mesmo gabarito (E.answerKey); ficam de fora os de áudio e
   microfone. Apresentação como na tela, com a romanização "ambas" (Paiboon+ e RTGS), que é o padrão do jogo.
   "Monte a palavra" entra como ordenação dos grupos de letras, sem as 2 peças-distratoras que o jogo acrescenta.
   Notas = a matéria da habilidade no próprio jogo:
     escrita (e01–e08)        os 8 conceitos do Arsenal de escrita + a tabela da unidade (letras, vogais ou sílabas
                              com classe, sons e tom), sem a linha do item respondido nos itens de sílaba
     vocabulário (vNuNN)      a lista de palavras da unidade com romanização e glosa
     lição do FSI (fNN)       as notas da lição e o diálogo com tradução
     gramática (gN)           os pontos de gramática do nível + até 4 exemplos resolvidos de OUTROS itens
     cultura (cN)             as explicações das OUTRAS cenas do nível
   Escolha adaptativa: o pick() do próprio ThaiWise, com o domínio do Elo canônico. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
module.exports = {
  id: "thaiwise", nome: "ThaiWise",
  carregar({ ROOT, LAB }) {
    const ctx = { console, Math, Date, JSON, String }; vm.createContext(ctx);
    for (const f of ["data.js", "models.js", "game.js", "engine.js", "i18n.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, "src", f), "utf8").replace(/^const (\w+) =/gm, "var $1 ="), ctx);
    const { DATA, ENGINE: E, LANG } = ctx, caps = { voice: false, mic: false }, S = DATA.script;
    const appSrc = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8"), m0 = appSrc.match(/const THEORY0 = (\{[\s\S]*?\n\});/);
    const THEORY0 = m0 ? vm.runInNewContext("(" + m0[1] + ")") : { pt: [], en: [] };
    const units = Object.keys(E.UNITS), skillsAll = [...units, ...[1, 2, 3, 4, 5, 6].map(l => "g" + l), ...[1, 2, 3, 4, 5, 6].map(l => "c" + l)];
    const items = [], byId = {};
    for (const s of skillsAll) for (const it of E.itemsFor(s, caps)) { if (["listen", "speak", "lsn", "vlsn"].includes(it.type)) continue; items.push(it); byId[it.id] = it; }
    const t = (lang, k) => (LANG[lang] || LANG.pt)[k] != null ? (LANG[lang] || LANG.pt)[k] : LANG.pt[k] != null ? LANG.pt[k] : k;
    const area = s => s[0] === "e" ? "escrita" : s[0] === "v" ? "vocabulario" : s[0] === "f" ? "fsi" : s[0] === "g" ? "gramatica" : "cultura";
    const skillName = s => { const u = E.UNITS[s]; return u ? (u.pt || s) + " (" + s + ")" : s[0] === "g" ? "Gramática nível " + s.slice(1) : "Cultura nível " + s.slice(1); };
    const L = l => l === "en" ? "en" : "pt", gl = (w, l) => E.gloss(w, l), romOf = (p, r) => p ? p + " / " + r : "";
    const sent = toks => toks.map(x => x[0] === "___" ? "＿＿" : x[0]).join("") + "  [" + toks.map(x => x[0] === "___" ? "___" : x[1]).join(" ") + " / " + toks.map(x => x[0] === "___" ? "___" : x[2]).join(" ") + "]";
    const consLine = (c, l) => `- ${c.c}: ${t(l, "cls_full_" + c.cls)}; initial ${c.ini || "—"}; final ${c.fin ? "-" + c.fin : "—"}; name ${c.nm} (${romOf(c.nmp, c.nmr)}) "${c.nmpt}"`;
    function notes(lang, skill, exclude) {
      const u = E.UNITS[skill], l = L(lang), ex = exclude ? byId[exclude] : null;
      if (u && u.kind === "script") {
        let tb = "";
        if (/^e0[1-4]$/.test(skill)) tb = u.w.map(ch => consLine(E.CONS[ch], l)).join("\n");
        else if (skill === "e05") tb = S.vow.map(v => `- ${v.f} (ex. ${v.ex}): ${v.p} / ${v.r}, ${t(l, "len_" + v.len)}`).join("\n");
        else if (skill === "e06") tb = S.cons.filter(c => c.fin && !c.obs).map(c => `- ${c.c} at the end = -${c.fin}`).join("\n") + "\n" + S.syl.map((y, i) => [y, i]).filter(([y, i]) => !(ex && ex.sy === i)).slice(0, 12).map(([y]) => `- ${y.t} (${y.p}): ${t(l, "live_" + y.live)}`).join("\n");
        else tb = S.syl.map((y, i) => [y, i]).filter(([y, i]) => y.u === skill && !(ex && ex.sy === i)).map(([y]) => `- ${y.t} (${y.p}): ${t(l, "cls_full_" + y.cls)}, ${t(l, "live_" + y.live)}, ${t(l, "len_" + (y.long ? "l" : "s"))}, tone mark ${y.mark} → ${t(l, "tone_" + y.tone)}`).join("\n");
        return "## " + skillName(skill) + "\n" + THEORY0[l].map(([h, p]) => "- " + h + ": " + p).join("\n") + "\nTABLE:\n" + tb;
      }
      if (u && u.kind === "fsi") { const F = DATA.fsi[u.n];
        return "## FSI " + u.n + ": " + F.titulo[l] + "\n" + (F.notas || []).map(n => "- " + n.t[l] + ": " + n.e[l]).join("\n") + "\nDIALOGUE:\n" + F.dialogo.map(d => d.sp + ": " + sent(d.s) + " = " + (d[l] || d.pt)).join("\n"); }
      if (u) return "## " + skillName(skill) + " — vocabulary list\n" + u.w.map(z => { const w = E.WORD[z]; return w ? "- " + z + " (" + romOf(w.p, w.r) + "): " + gl(w, lang) : ""; }).filter(Boolean).join("\n");
      if (skill[0] === "g") { const lv = +skill.slice(1), pts = DATA.grammar[lv] || [], exs = items.filter(i => i.skill === skill && i.id !== exclude && i.type === "gap").slice(0, 4);
        return "## " + skillName(skill) + "\n" + pts.map(g => "- " + g.t + ": " + g.e + (g.ex ? " Ex.: " + sent(g.ex) + " = " + (g[l] || g.pt) : "")).join("\n") + "\nWORKED EXAMPLES:\n" + exs.map(i => "* " + sent(i.g.s.map(x => x[0] === "___" ? (i.g.o.find(o => o[0] === i.g.a) || x) : x)) + ": " + (i.g.x || "")).join("\n"); }
      const lv = +skill.slice(1), sc = items.filter(i => i.skill === skill && i.id !== exclude);
      return "## " + skillName(skill) + "\n" + sc.map(i => "- " + i.cena[l] + " → " + i.g.a + ": " + (i.g.x || "")).join("\n");
    }
    function render(lang, it, r) {
      const seed = Math.floor(r() * 1e9), opts = E.options(it, lang, seed), key = E.answerKey(it, lang), w = it.w ? E.WORD[it.w] : null, l = L(lang);
      const lab = o => it.type === "cls" ? t(l, "cls_full_" + o.key) : it.type === "tone" ? t(l, "tone_" + o.key) : it.type === "vlen" ? t(l, "len_" + o.key) : it.type === "live" ? t(l, "live_" + o.key) : it.type === "fin" ? "-" + o.key : o.th && o.p ? o.label + " (" + o.p + " / " + o.r + ")" : o.label;
      const k = t(l, "kind_" + it.type), correct = opts.find(o => o.key === key);
      const mc = prompt => correct ? { kind: "mc", prompt, options: [lab(correct), ...opts.filter(o => o.key !== key).map(lab)], correct: lab(correct) } : null;
      switch (it.type) {
        case "read": return mc(k + "\nWORD: " + w.t + " (" + romOf(w.p, w.r) + ")");
        case "rom": return mc(k + "\nWORD: " + w.t + "\nMEANING: " + gl(w, lang));
        case "translate": return mc(k + "\nMEANING: " + gl(w, lang));
        case "spell": return { kind: "order", prompt: t(l, "kind_spell") + " (letter groups)\nMEANING: " + gl(w, lang) + "\nROMANIZATION: " + romOf(w.p, w.r), pieces: E.clusters(w.t) };
        case "cls": case "ini": return mc(k + "\nLETTER: " + it.ch);
        case "fin": return mc(k + "\nLETTER: –" + it.ch);
        case "letter": { const c = E.CONS[it.ch]; return mc(k + "\nNAME: " + romOf(c.nmp, c.nmr) + " (" + c.nmpt + ")"); }
        case "vrom": { const v = S.vow[it.v]; return mc(k + "\nVOWEL: " + v.ex + " (" + v.f + ")"); }
        case "vlen": { const v = S.vow[it.v]; return mc(k + "\nVOWEL: " + v.f + " (" + v.ex + ")"); }
        case "live": case "tone": { const y = S.syl[it.sy]; return mc(k + "\nSYLLABLE: " + y.t + (l === "pt" ? " (" + y.pt + ")" : "")); }
        case "gap": return mc(k + "\nSENTENCE: " + sent(it.g.s) + (it.g.h ? "\nHINT: " + it.g.h : ""));
        case "scene": return mc(t(l, "kind_scene") + "\nSCENE: " + it.cena[l] + "\nCONTEXT: " + Object.entries(it.ctx).map(([a, b]) => t(l, "ctx_" + a) + ": " + t(l, "cv_" + b)).join(", ") + "\nSENTENCE: " + sent(it.g.s));
        case "dmean": { const d = DATA.fsi[E.UNITS[it.skill].n].dialogo[it.dl]; return mc(k + "\nLINE: " + d.sp + ": " + sent(d.s)); }
        case "order": return { kind: "order", prompt: k + "\nMEANING: " + (it.s[l] || it.s.pt || ""), pieces: it.s.t.map(x => x[0] + " (" + x[1] + ")") };
      }
      return null;
    }
    function build(lang, it, r) { const v = render(lang, it, r); if (!v) return null; return v.kind === "order" ? LAB.orderItem("", v.prompt, v.pieces, r) : LAB.mcItem("", v.prompt, v.options, r); }
    const SYS = l => `You are role-playing an adult BEGINNER learning Thai in a game. The game interface is in ${l}. You only know what is written in your NOTES below; if the NOTES do not cover the question, answer the way a beginner would guess, without using knowledge you are not supposed to have. Follow the reply format exactly and write nothing else.`;
    const langName = l => ({ pt: "Portuguese", en: "English" })[l] || l;
    return {
      dominioPt: "tailandês (escrita, tons, vocabulário, FSI)", dominioEn: "the Thai language", idiomas: ["pt", "en"],
      padrao: { habilidades: ["e01", "e02", "e05", "e06", "e07", "v1u01", "v1u02", "v2u01", "f01", "f02", "g1", "g2", "c1"], itensPorHabilidade: 10 },
      skills: skillsAll.map(id => ({ id, area: area(id) })), items, byId, area, skillName, langName, notes,
      attempt: (brain, lang, it, notesText, r) => LAB.singleTurn(brain, SYS(langName(lang)), build(lang, it, r), notesText, r),
      pick: (pool, m, recent, solved, r) => E.pick(pool, m, recent, solved, r),
      tutorTask: (lang, it, r) => { const v = render(lang, it, r); if (!v || v.kind !== "mc" || v.options.length < 2) return null;
        return { task: "ITEM:\n" + v.prompt + "\nOPTIONS:\n" + v.options.map(o => "- " + o).join("\n") + "\nTHE STUDENT CHOSE: " + v.options[1], correct: v.correct, reference: (it.g && it.g.x) || "" }; },
      preview: (lang, it, notesText, r) => "NOTES:\n" + notesText + "\n\n" + build(lang, it, r).body,
      limites: ["Tailandês é bem menos presente no treino dos LLMs pequenos do que mandarim: o contraste de vazamento entre Wikawise e ThaiWise é parte do resultado.",
        "Itens de áudio e fala ficam de fora; 'Monte a palavra' entra sem as 2 peças-distratoras do jogo (fica um pouco mais fácil).",
        "Nos itens de tom, as notas trazem a regra e a tabela; o agente precisa aplicar a regra, não só copiar."]
    };
  }
};
