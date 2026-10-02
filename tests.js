/* Testes sem navegador: node tests.js */
const fs = require("fs"), vm = require("vm");
const ctx = { console, Math, Date, JSON, String };
vm.createContext(ctx);
for (const f of ["data.js", "models.js", "game.js", "engine.js"]) vm.runInContext(fs.readFileSync(__dirname + "/src/" + f, "utf8").replace(/^const (\w+) =/gm, "var $1 ="), ctx);
const { DATA, ENGINE: E, KT, GAME } = ctx;
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FALHOU:", m); } };
const caps = { voice: true, mic: true };

/* escrita */
const C = DATA.script.cons;
ok(C.length === 44, "44 consoantes: " + C.length);
ok(C.filter(c => c.cls === "M").length === 9 && C.filter(c => c.cls === "H").length === 11 && C.filter(c => c.cls === "L").length === 24, "9 médias, 11 altas, 24 baixas");
ok(new Set(C.map(c => c.c)).size === 44, "consoantes sem repetição");
ok(DATA.script.syl.every(s => E.toneRule(s.cls, s.live, s.long, s.mark) === E.toneOf(s.p)), "regra de tom = tom do Paiboon em todas as sílabas de treino");
ok(["e01","e02","e03","e04","e05","e06","e07","e08"].every(id => E.itemsFor(id, caps).length > 0), "toda unidade de escrita gera exercícios");
const allLetters = DATA.levels[0].units.filter(u => u.w).flatMap(u => u.w);
ok(allLetters.length === 44 && new Set(allLetters).size === 44, "as 4 unidades de consoantes cobrem as 44 letras");

/* vocabulário e romanização */
const W = DATA.words;
ok(new Set(W.map(w => w.t)).size === W.length, "palavras sem repetição");
ok(W.every(w => w.pt && w.en && w.p && w.r), "toda palavra tem pt, en, Paiboon e RTGS");
ok(W.every(w => /^[\u0E00-\u0E7F]+$/.test(w.t)), "toda palavra está só em escrita tailandesa");
ok(W.every(w => !/[\u0300-\u030C]/.test(w.r.normalize("NFD")) && !/[ɛɔəʉ]/.test(w.r)), "RTGS sem tons nem símbolos IPA");
const R = Object.fromEntries(W.map(w => [w.t, w.r]));
ok(R["ขอบคุณ"] === "khopkhun" && R["ประเทศ"] === "prathet" && R["ก๋วยเตี๋ยว"] === "kuaitiao" && R["เพื่อน"] === "phuean", "RTGS no padrão oficial");
ok(W.filter(w => w.lv === 1).length >= 300 && W.filter(w => w.lv === 2).length >= 180, "A1 e A2 com vocabulário suficiente");

/* itens e opções */
for (const u of DATA.levels.flatMap(L => L.units)) {
  const its = E.itemsFor(u.id, caps);
  ok(its.length > 0, "unidade sem itens: " + u.id);
  ok(new Set(its.map(i => i.id)).size === its.length, "ids de item únicos em " + u.id);
  for (const it of its.slice(0, 60)) {
    if (["speak", "spell", "order"].includes(it.type)) continue;
    const o = E.options(it, "pt", 7), key = E.answerKey(it, "pt");
    ok(o.some(x => x.key === key), `resposta entre as opções: ${it.id}`);
    ok(new Set(o.map(x => x.key)).size === o.length, `opções distintas: ${it.id}`);
  }
}
const rv = E.romVariants("sà-wàt-dii", 3, E.rng("x"));
ok(rv.length === 3 && !rv.includes("sà-wàt-dii"), "distratores de pronúncia diferentes da resposta");
ok(E.clusters("ก๋วยเตี๋ยว").join("|") === "ก๋|ว|ย|เ|ตี๋|ย|ว", "grafemas prendem vogais e tons à consoante");
ok(W.filter(w => E.clusters(w.t).join("") !== w.t).length === 0, "grafemas remontam a palavra");

/* gramática */
ok(DATA.gItems.every(g => g.o.some(o => o[0] === g.a) && g.s.filter(t => t[0] === "___").length === 1), "lacunas: resposta nas opções e um ___");
ok(DATA.gSent.every(s => s.t.length >= 3), "frases para montar com 3+ peças");
ok(E.grammarItems(1).length > 40 && E.grammarItems(2).length > 30, "gramática A1 e A2 com exercícios");

/* FSI */
for (const k in DATA.fsi) { const L = DATA.fsi[k], u = E.UNITS["f" + String(k).padStart(2, "0")];
  ok(!!u && u.lv === Math.min(6, Math.floor((+k - 1) / 10) + 1), "lição FSI " + k + " no nível certo");
  ok(L.dialogo.every(d => d.s.every(t => t[0] && t[1])), "diálogo FSI " + k + " em tokens");
  ok(E.itemsFor(u.id, caps).some(i => i.type === "dmean"), "lição FSI " + k + " gera perguntas do diálogo"); }

/* desbloqueio e prior */
const S0 = { free: false, keyed: {} }, M0 = () => 0, M1 = () => 1;
ok(E.levelOpen(S0, 0, M0) && E.levelOpen(S0, 1, M0) && !E.levelOpen(S0, 2, M0), "escrita e A1 abertos; A2 trancado no início");
ok(E.levelOpen(S0, 2, M1), "A2 abre com o A1 dominado");
ok(E.unitOpen(S0, "v1u01", M0) && !E.unitOpen(S0, "v1u02", M0) && E.unitOpen(S0, "f01", M0), "trilhas temática e FSI encadeadas separadamente");
ok(Math.abs(E.prior("v1u01", M0) - .15) < 1e-9 && Math.abs(E.prior("v1u02", M1) - .575) < 1e-9, "prior hierárquico");
/* cenas culturais */
for (let lv = 1; lv <= 6; lv++) {
  const cs = E.cultItems(lv);
  ok(cs.length >= 8, "nível " + lv + " tem ≥ 8 cenas culturais");
  cs.forEach(it => {
    ok(it.type === "scene" && it.dim === "pragma" && it.skill === "c" + lv, it.id + " é cena com dimensão pragmática");
    ok(it.ctx && ["lugar", "relacao", "registro"].every(k => it.ctx[k]), it.id + " tem as três etiquetas de contexto");
    ok(it.cena && it.cena.pt && it.cena.en, it.id + " descreve a cena em pt e en");
    const op = E.options(it, "pt", 1).map(o => o.key); ok(op.length === 4 && op.includes(E.answerKey(it, "pt")), it.id + ": 4 opções e a resposta entre elas");
    ok(it.g.s.filter(x => x[0] === "___").length === 1, it.id + ": exatamente uma lacuna");
  });
}
ok(E.itemsFor("c3", {}).length === E.cultItems(3).length, "itemsFor reconhece a habilidade cultural");
ok(E.DIMS.includes("pragma"), "dimensão pragmática registrada");
for (let lv = 1; lv <= 6; lv++) ok((DATA.grammar[lv] || []).length >= 10, "nível " + lv + " tem gramática autoral (≥ 10 pontos)");
{ const vazio = DATA.levels.find(L => L.lv > 1 && !L.units.length);
  ok(!vazio || !E.levelOpen(S0, vazio.lv, M1), "nível sem conteúdo não abre"); }

/* motor de KT herdado */
const tr = KT.ensure({ L: .15 }); const it0 = E.itemsFor("v1u01", caps).find(i => i.d === 2);
for (let i = 0; i < 12; i++) KT.updateAll(tr, it0, .25, 1);
ok(KT.mastery(tr, "elo") > .85, "Elo domina após 12 acertos");
ok(GAME.gain({ mode: "normal", boost: 0, lastWrong: false, inv: { shield: 0 } }, 2, true) === 20, "XP por acerto");

console.log(fail ? `${fail} de ${n} testes falharam` : `${n} testes ok`);
process.exit(fail ? 1 : 0);
