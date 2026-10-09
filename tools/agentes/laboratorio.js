#!/usr/bin/env node
/* Laboratório de agentes MULTIDOMÍNIO (tese STUDx) — o mesmo protocolo do laboratório do DevWise, aplicado a qualquer
   ferramenta da família *Wise por meio de um ADAPTADOR (tools/agentes/adaptador.js).

   Por que um núcleo único: para comparar como os modelos de KT se comportam em áreas de conhecimento diferentes,
   tudo o que não é o domínio precisa ser idêntico: os cérebros, as sementes, as condições, a seleção adaptativa,
   as métricas e o PRÓPRIO CÓDIGO DOS MODELOS DE KT (kt-canonico.js, cópia literal do DevWise). Se cada ferramenta usasse
   o seu, uma diferença entre domínios poderia ser só diferença de implementação.

   Agente = CÉREBRO (um LLM) + BASE DE CONHECIMENTO (as notas que ele "estudou": o material da própria ferramenta).
     C0  sem notas            VAZAMENTO: o quanto o cérebro já sabe do domínio sozinho
     C1  notas da habilidade  sem aprendizagem durante a partida
     C2  partida              as notas de cada habilidade só chegam depois do 3º item dela: degrau num instante CONHECIDO
                              (adaptativa: o pilote Elo escolhe a dificuldade; fixa: os mesmos itens em ordem aleatória)
     C3  C2 embaralhado       queda de AUC quando a ordem é destruída (não gasta chamadas)
   A verdade de cada resposta da C2 é MEDIDA (acerto do mesmo item em C0 antes do degrau, em C1 depois).

   Métrica central, sem depender de regime: VIÉS DE GANHO = ganho previsto pelo modelo − ganho verdadeiro medido, antes e
   depois do degrau (positivo = inventa aprendizagem; negativo = não enxerga a que existe).
   Regime de cada habilidade, fixado ANTES dos resultados (o DevWise tinha o dialeto cifrado; aqui o degrau é medido, com IC):
     PLANO   nada a aprender com as notas  → viés de ganho = ALARME FALSO (aprendizagem fantasma)
     DEGRAU  há aprendizagem real          → viés de ganho = excesso sobre o que existe (veja regimes())

   Uso (na pasta do repositório da ferramenta):
     node tools/agentes/laboratorio.js info
     node tools/agentes/laboratorio.js calibrar --cerebro ollama:qwen3:8b
     node tools/agentes/laboratorio.js triagem  --cerebro ollama:qwen3:8b
     node tools/agentes/laboratorio.js piloto   --cerebro ollama:qwen3:8b --alunos 5 --repeticoes 3
     node tools/agentes/laboratorio.js piloto   --cerebro simulado        (sem LLM: testa o encanamento)
     node tools/agentes/laboratorio.js consolidar --rodada <nome>
     node tools/agentes/laboratorio.js ajustar   [--rodada <nome>]  (KT com parâmetros estimados, validação cruzada por aluno; sem LLM)
     node tools/agentes/laboratorio.js comparar  --pastas DevWise=..\DevWise\agentes\saida\<rodada>,IAWise=agentes\saida\<rodada>,...
   Cérebros: ollama:<modelo>, openai:<modelo> (OPENAI_BASE_URL + OPENAI_API_KEY), deepseek:<modelo>, anthropic:<modelo>, simulado, aleatorio. */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const KT = require("./kt-canonico.js");
const NUCLEO_VERSAO = "1.9";
const MODELS = ["elo", "irt", "bkt", "pfa", "afm"];
const STEP = 3;                                    /* as notas chegam depois do 3º item de cada habilidade (o adaptador pode fixar outro: passo) */
const PASSO = () => (ENV && ENV.passo) || STEP;
const REGIME = { plano: 0.10, degrau: 0.10 };      /* limiares fixados antes dos resultados (veja regimes()) */
const L0_JOGO = 0.15;                              /* prior neutro do jogo (o mesmo das ferramentas) */

/* ---------------- sementes ---------------- */
function makeRng(...parts) {
  const s2 = parts.join("|"); let h = 1779033703 ^ s2.length;
  for (let i = 0; i < s2.length; i++) { h = Math.imul(h ^ s2.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuf = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------------- cérebros (os mesmos do laboratório do DevWise) ---------------- */
function makeBrain(spec) {
  const [kind, ...rest] = spec.split(":"), model = rest.join(":");
  const stats = { calls: 0, ms: 0, inTok: 0, outTok: 0, fails: 0, retries: 0 };
  let consecutive = 0, noThink = false, inflight = 0; const queue = [];
  /* limite de chamadas simultâneas: começa em --paralelo e CAI sozinho a cada 429 (limite do provedor), até 1 */
  let limit = Math.max(1, +(process.env.LAB_PARALELO || 1));
  const acquire = () => inflight < limit ? (inflight++, Promise.resolve()) : new Promise(res => queue.push(res));
  const release = () => { inflight--; while (inflight < limit && queue.length) { inflight++; queue.shift()(); } };
  const post = async (url, headers, body) => {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 120000);
    try { return await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal }); } finally { clearTimeout(tm); }
  };
  async function once(messages, temperature, max, rng) {
    if (kind === "simulado") return simulated(messages, rng);
    if (kind === "aleatorio") return "";   /* o adaptador sorteia a resposta (linha de base do acaso) */
    if (kind === "ollama") {
      const base = process.env.OLLAMA_HOST || "http://localhost:11434", h = { "content-type": "application/json" };
      const body = { model, messages, stream: false, think: false, options: { temperature, num_predict: max, num_ctx: 8192, seed: Math.floor(rng() * 2147483647) } };
      if (noThink) delete body.think;
      let r = await post(base + "/api/chat", h, body);
      if (!r.ok && r.status === 400 && !noThink) { noThink = true; delete body.think; r = await post(base + "/api/chat", h, body); }
      if (!r.ok) throw new Error("Ollama HTTP " + r.status + " " + (await r.text()).slice(0, 160));
      const d = await r.json(); stats.inTok += d.prompt_eval_count || 0; stats.outTok += d.eval_count || 0; return (d.message && d.message.content) || "";
    }
    if (kind === "openai" || kind === "deepseek") {
      const base = (kind === "deepseek" ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") : (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")).replace(/\/+$/, "");
      const key = kind === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
      /* DeepSeek: o modo "thinking" vem LIGADO por padrão e o raciocínio é cobrado como saída; aqui não serve (traduzir,
         responder com uma letra), então vai desligado. Desligar via LAB_THINKING=1 para quem quiser medir com raciocínio. */
      const body = { model, messages, temperature, max_tokens: max };
      if (kind === "deepseek" && process.env.LAB_THINKING !== "1") body.thinking = { type: "disabled" };
      const r = await post(base + "/chat/completions", { "content-type": "application/json", authorization: "Bearer " + key }, body);
      if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 160));
      const d = await r.json(); if (d.usage) { stats.inTok += d.usage.prompt_tokens; stats.outTok += d.usage.completion_tokens; } return d.choices[0].message.content || "";
    }
    if (kind === "anthropic") {
      const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
      const r = await post("https://api.anthropic.com/v1/messages", { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        { model, system: sys, messages: messages.filter(m => m.role !== "system"), temperature, max_tokens: max });
      if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 160));
      const d = await r.json(); if (d.usage) { stats.inTok += d.usage.input_tokens; stats.outTok += d.usage.output_tokens; } return d.content.map(c => c.text || "").join("");
    }
    throw new Error("cérebro desconhecido: " + spec);
  }
  async function call(messages, { temperature = 0.7, max = 80, rng = Math.random } = {}) {
    const seedDraw = rng();   /* tirada ANTES de esperar a vez: a sequência do gerador fica igual em série ou em paralelo */
    await acquire(); const t0 = Date.now(); let text = "";
    for (let att = 1, rl = 0; att <= 3; att++) {
      try { text = await once(messages, temperature, max, () => seedDraw); consecutive = 0; break; }
      catch (e) {
        const m = String(e.message || "");
        /* sem saldo ou chave inválida: não adianta insistir; para já, com a causa (o que já foi feito fica salvo) */
        if (/HTTP 40[12]\b/.test(m)) { release(); throw new Error((/402/.test(m) ? "Saldo insuficiente no provedor (" + kind + "). Recarregue o saldo, ou use um cérebro local (ex.: --cerebro ollama:qwen3:8b)," : "Chave de API recusada (" + kind + "). Confira a chave,") + " e rode o MESMO comando de novo: o que já foi feito está salvo e é retomado."); }
        /* 429: o provedor pediu calma; reduz a simultaneidade e espera mais (não conta como tentativa até 6 vezes) */
        if (/HTTP 429\b/.test(m) && rl < 6) { rl++; att--; stats.retries++; if (limit > 1) { limit--; if (stats.retries < 50) console.error("\n   aviso: limite do provedor; simultaneidade reduzida para " + limit); }
          await new Promise(r => setTimeout(r, 4000 * 2 ** (rl - 1))); continue; }
        if (att < 3) { stats.retries++; await new Promise(r => setTimeout(r, att * (kind === "simulado" ? 1 : 1500))); continue; }
        stats.fails++; consecutive++;
        if (stats.fails <= 3) console.error("\n   aviso: " + (e.name === "AbortError" ? "sem resposta em 2 min" : e.message));
        if (consecutive >= 10) { release(); throw new Error("o cérebro falhou 10 vezes seguidas; o servidor está no ar? Rode o mesmo comando de novo (com a mesma --rodada, no estudo) para retomar: o que já foi feito está salvo."); }
      }
    }
    release(); stats.calls++; stats.ms += Date.now() - t0;
    return String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
  return { spec, kind, model, call, stats };
}
/* Cérebro sem LLM: acerta 85% com notas e 30% sem; o tutor devolve a referência. Testa o encanamento, não o domínio.
   Cérebro "aleatorio": responde ao acaso (letra, ordem ou, no IAWise, comandos sorteados): a LINHA DE BASE do chute de cada
   domínio, que é o parâmetro c dos modelos de KT. Roda em minutos e não precisa de LLM. */
function simulated(messages, rng) {
  const u = messages[messages.length - 1].content, sys = messages[0].content;
  if (/^Translate/.test(sys)) return u;
  if (/^You are a professional translator/.test(sys)) return u;   /* identidade: testa o encanamento da tradução */
  if (/TUTOR/.test(sys)) { const m = u.match(/REFERENCE_HINT: (.*)/); return m ? m[1] : "..."; }
  const hasNotes = /NOTES:\n(?!\(none\))/.test(u), right = rng() < (hasNotes ? 0.85 : 0.3);
  const k = (u.match(/CORRECT_FOR_SIMULATION: (.*)/) || [])[1] || "";
  if (right) return "ANSWER: " + k;
  const W = (u.match(/WRONG_FOR_SIMULATION: (.*)/) || [])[1];
  return "ANSWER: " + (W != null ? W : "?");
}
function askKey(label) {
  return new Promise(resolve => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl._writeToOutput; let muted = false;
    rl._writeToOutput = function (s2) { if (muted) { if (s2.includes("\n") || s2.includes("\r")) w.call(rl, "\n"); } else w.call(rl, s2); };
    rl.question("Cole a chave de " + label + " e dê Enter (ela não aparece na tela): ", k => { rl.close(); resolve(String(k || "").trim()); });
    muted = true;
  });
}
const KEYVAR = { deepseek: "DEEPSEEK_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
async function preflight(brain) {
  const v = KEYVAR[brain.kind];
  if (v && !process.env[v]) { const k = await askKey(brain.kind); if (k.length < 20) throw new Error("Isso não parece uma chave. Nada foi enviado."); process.env[v] = k; }
  if (brain.kind !== "ollama") return;
  const base = process.env.OLLAMA_HOST || "http://localhost:11434"; let tags;
  try { tags = await (await fetch(base + "/api/tags")).json(); } catch (e) { throw new Error("O Ollama não respondeu em " + base + ". Instale (winget install Ollama.Ollama), abra o aplicativo e tente de novo."); }
  const have = (tags.models || []).map(m => m.name);
  if (!have.some(n => n === brain.model || n === brain.model + ":latest")) throw new Error("O modelo " + brain.model + " não está baixado. Rode: ollama pull " + brain.model);
}
const brainSlug = spec => spec.replace(/[^\w.-]+/g, "_");

/* ---------------- leitura tolerante e uma pergunta de uma rodada (para os adaptadores) ---------------- */
/* Devolve {v, fmt}: "pedido" = veio como ANSWER:; "tolerado" = entendido fora do formato; "ilegivel" = não deu para entender. */
function readAnswer(a, kind, opts) {
  const s = String(a || "").trim(), strict = /ANSWER\s*[:：]/i.test(s), after = strict ? s.replace(/^[\s\S]*?ANSWER\s*[:：]\s*/i, "") : s;
  const tag = v => v == null ? { v: null, fmt: "ilegivel" } : { v, fmt: strict ? "pedido" : "tolerado" };
  if (kind === "letter") {
    const m = after.match(/(?:^|[\s(（\[:：*])([A-H])(?=$|[)）\].:：,*]|\s+(?![a-zà-ÿ]))/);
    if (m) return tag(m[1].toUpperCase());
    if (opts) { const low = s.toLowerCase(), hit = opts.map((o, i) => [i, String(o).toLowerCase().trim()]).filter(([, o]) => o.length >= 2 && low.includes(o)); if (hit.length === 1) return tag("@" + hit[0][0]); }
    return tag(null);
  }
  if (kind === "seq") { const nums = after.match(/\d+/g) || []; return tag(nums.length ? nums.join(",") : null); }
  return tag(after || null);
}
/* Múltipla escolha genérica: o adaptador entrega enunciado e opções (a 1ª é a correta); o núcleo embaralha, pergunta e corrige. */
function mcItem(title, prompt, options, r, extra = "") {
  const L = "ABCDEFGH", ord = shuf(options.map((_, i) => i), r), key = L[ord.indexOf(0)];
  const body = (title ? "ITEM: " + title + "\n" : "") + prompt + "\n" + (extra ? extra + "\n" : "") + "\n" + ord.map((o, i) => L[i] + ") " + options[o]).join("\n") + "\n\nReply with one line: ANSWER: <letter>";
  const wrong = L[ord.findIndex(o => o !== 0)];
  /* opção com o MESMO texto da correta (ex.: duas glosas distintas que viraram a mesma palavra na tradução) também vale:
     o agente não tem como distingui-las */
  const same = new Set(ord.map((o, i) => String(options[o]).trim() === String(options[0]).trim() ? L[i] : null).filter(Boolean));
  const wrongL = L[ord.findIndex(o => String(options[o]).trim() !== String(options[0]).trim())] || wrong;
  return { body, key, wrong: wrongL, random: rr => "ANSWER: " + L[Math.floor(rr() * options.length)], grade: a => { const x = readAnswer(a, "letter", ord.map(o => options[o])); if (x.v && x.v[0] === "@") x.v = L[+x.v.slice(1)]; return { ok: same.has(x.v), fmt: x.fmt }; } };
}
/* Ordenação genérica: peças embaralhadas, resposta = números na ordem certa. */
/* accept: outras ordens que o jogo também aceita, como texto montado (peças coladas com `join`) */
function orderItem(title, prompt, pieces, r, accept = [], join = "") {
  const ord = shuf(pieces.map((_, i) => i), r), key = pieces.map((_, i) => ord.indexOf(i) + 1).join(",");
  const body = (title ? "ITEM: " + title + "\n" : "") + prompt + "\n\nPIECES (shuffled):\n" + ord.map((o, i) => (i + 1) + "  " + pieces[o]).join("\n") + "\n\nReply with one line: ANSWER: <piece numbers in the correct order, comma separated>";
  const target = new Set([pieces.join(join), ...accept]);
  return { body, key, wrong: key.split(",").reverse().join(","), random: rr => "ANSWER: " + shuf(pieces.map((_, i) => i + 1), rr).join(","), grade: a => { const x = readAnswer(a, "seq"); if (!x.v) return { ok: false, fmt: x.fmt };
    const n = x.v.split(",").map(Number); if (x.v === key) return { ok: true, fmt: x.fmt };
    const ok = n.length === pieces.length && new Set(n).size === n.length && n.every(k => k >= 1 && k <= pieces.length) && target.has(n.map(k => pieces[ord[k - 1]]).join(join));
    return { ok, fmt: x.fmt }; } };
}
async function singleTurn(brain, sys, item, notes, r, max = 40) {
  const u = "NOTES:\n" + (notes || "(none)") + "\n\n" + item.body + (brain.kind === "simulado" ? "\nCORRECT_FOR_SIMULATION: " + item.key + "\nWRONG_FOR_SIMULATION: " + (item.wrong || "?") : "");
  const a = brain.kind === "aleatorio" ? (brain.stats.calls++, item.random(r)) : await brain.call([{ role: "system", content: sys }, { role: "user", content: u }], { temperature: 0.7, max, rng: r });
  const g = item.grade(a); return { ok: !!g.ok, fmt: g.fmt, key: item.key, raw: String(a).slice(0, 200) };
}
/* ---------------- camada de tradução (idiomas que a ferramenta não tem, ou só tem em parte) ----------------
   Os adaptadores passam por LAB.tr(idioma, texto) todo texto que só existe em português na ferramenta. O texto traduzido
   vem de um CACHE versionado em tools/agentes/idiomas/<idioma>.json, preenchido UMA vez pelo comando "traduzir" (com o
   cérebro que se quiser, ex.: deepseek). Na hora do estudo não há tradução ao vivo: a mesma rodada refeita dá o mesmo
   resultado, e o piloto se recusa a começar se faltar algum texto. Analogia: o dicionário é impresso antes da prova. */
const LANGNAMES = { pt: "Portuguese", en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", zh: "Chinese", ja: "Japanese" };
const langNameOf = l => LANGNAMES[l] || l;
const TRAD = { cache: {}, missing: {} };
const tradFile = lang => path.join(__dirname, "idiomas", lang + ".json");
function tradCache(lang) { if (!TRAD.cache[lang]) { const f = tradFile(lang); TRAD.cache[lang] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}; } return TRAD.cache[lang]; }
function tr(lang, text) {
  if (text == null || lang === "pt") return text;
  const s = String(text); if (!/[A-Za-zÀ-ÿ]{2}/.test(s.replace(/\{[^}]*\}/g, ""))) return s;   /* só escrita não latina, números ou marcadores: nada a traduzir */
  const c = tradCache(lang); if (c[s] != null) return c[s];
  (TRAD.missing[lang] = TRAD.missing[lang] || new Set()).add(s); return s;
}
const LAB = { readAnswer, mcItem, orderItem, singleTurn, shuf, makeRng, tr, langName: langNameOf };

/* ---------------- domínio ---------------- */
const A = require("./adaptador.js");
let ENV = null;
function env(opts) {
  if (!ENV) { ENV = A.carregar({ ROOT, LAB, opts, KT }); }
  return ENV;
}
/* itens do estudo: habilidades padrão do adaptador (ou --habilidades), no máximo --itens por habilidade, amostra com semente */
function studyItems(E, opts) {
  const sk = opts.habilidades ? opts.habilidades.split(",") : E.padrao.habilidades;
  const r = makeRng(opts.semente, A.id, "itens");
  const out = [];
  for (const s of sk) { const pool = E.items.filter(i => i.skill === s); if (!pool.length) { console.log("   aviso: habilidade sem itens: " + s); continue; }
    out.push(...shuf(pool, r).slice(0, opts.itens || E.padrao.itensPorHabilidade)); }
  return out;
}

/* ---------------- tutor (QP2): três estratégias ---------------- */
const TUTOR_SYS = d => `You are a TUTOR in a learning game about ${d} for adult beginners. Write ONE short hint (at most 60 words) that helps the student see their mistake WITHOUT revealing the correct answer. Plain text only.`;
const SCRIPTS = { Latin: /[A-Za-zÀ-ÿĀ-žƀ-ɏ]/, Han: /[一-鿿]/, Thai: /[฀-๿]/ };
function scriptShare(text, script) { const re = SCRIPTS[script] || SCRIPTS.Latin, letters = [...text].filter(ch => /\p{L}/u.test(ch)); return letters.length ? letters.filter(ch => re.test(ch)).length / letters.length : 0; }
function chrF(hyp, ref, n = 6, beta = 2) {
  const H = hyp.replace(/\s+/g, ""), R = ref.replace(/\s+/g, ""); let P = 0, Rc = 0, k = 0;
  for (let q = 1; q <= n; q++) { const g = s => { const m = new Map(); for (let i = 0; i + q <= s.length; i++) { const x = s.slice(i, i + q); m.set(x, (m.get(x) || 0) + 1); } return m; };
    const a = g(H), b = g(R); if (!a.size || !b.size) continue; let m = 0; for (const [x, c] of a) m += Math.min(c, b.get(x) || 0);
    P += m / [...a.values()].reduce((s, v) => s + v, 0); Rc += m / [...b.values()].reduce((s, v) => s + v, 0); k++; }
  if (!k) return 0; P /= k; Rc /= k; return P + Rc ? (1 + beta * beta) * P * Rc / (beta * beta * P + Rc) * 100 : 0;
}
async function tutorRun(E, brain, lang, it, r) {
  const T = l => E.tutorTask(l, it, r); const t = T(lang); if (!t) return [];
  const L = langNameOf(lang), out = {}, sys = TUTOR_SYS(E.dominioEn), sim = s => brain.kind === "simulado" ? "REFERENCE_HINT: " + (s.reference || "...") + "\n" : "";
  out.S1 = await brain.call([{ role: "system", content: sys }, { role: "user", content: t.task + "\n" + sim(t) + "Write the hint in " + L + "." }], { temperature: 0.3, max: 160, rng: r });
  out.S2 = await brain.call([{ role: "system", content: sys }, { role: "user", content: "NOTES (" + L + "):\n" + E.notes(lang, it.skill, it.id) + "\n\n" + t.task + "\n" + sim(t) + "Write the hint in " + L + ", using the vocabulary of the NOTES." }], { temperature: 0.3, max: 160, rng: r });
  if (lang === "en") out.S3 = out.S1;
  else { const te = T("en") || t; const en = await brain.call([{ role: "system", content: sys }, { role: "user", content: te.task + "\n" + sim(te) + "Write the hint in English." }], { temperature: 0.3, max: 160, rng: r });
    out.S3 = await brain.call([{ role: "system", content: "Translate the text into " + L + ". Keep code, numbers, formulas and words of the studied language unchanged. Output only the translation." }, { role: "user", content: en }], { temperature: 0.2, max: 220, rng: r }); }
  return ["S1", "S2", "S3"].map(s => { const x = out[s] || "", c = String(t.correct || "");
    return { lang, item: it.id, skill: it.skill, strategy: s, text: x, reference: t.reference || "", script_share: +scriptShare(x, "Latin").toFixed(3),
      leak: c.length >= 2 && x.toLowerCase().includes(c.toLowerCase().slice(0, 40)) ? 1 : 0, chrf: t.reference ? +chrF(x, t.reference).toFixed(1) : "", chars: [...x].length }; });
}

/* ---------------- uma língua: medição, alunos (adaptativa e fixa), tutores ---------------- */
const csvOf = rows => { if (!rows.length) return ""; const h = [...new Set(rows.flatMap(r => Object.keys(r)))]; return [h.join(","), ...rows.map(r => h.map(k => { const v = r[k] == null ? "" : String(r[k]); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","))].join("\n"); };
const ktItem = it => ({ id: it.id, d: it.d || 2 });
async function attempt(E, brain, lang, it, withNotes, r) {
  const notes = withNotes ? E.notes(lang, it.skill, it.id) : "";
  return E.attempt(brain, lang, it, notes, r);
}
async function runLanguage(opts, E, brain, lang, items, timeLeft) {
  const L = { med: [], game: [], fixed: [], tut: [], perLang: [] }, tl = Date.now(), st0 = { ...brain.stats }, slug = brainSlug(opts.cerebro);
  process.stdout.write(lang + ": medição");
  const rM = makeRng(opts.semente, A.id, slug, lang, "medicao"), jobs = [];
  for (const it of items) for (let k = 0; k < opts.reps; k++) jobs.push({ it, k, a0: attempt(E, brain, lang, it, false, rM), a1: attempt(E, brain, lang, it, true, rM) });
  const truth = {};
  let done = 0; const tick = Math.max(1, Math.round(jobs.length / 10));
  for (const jb of jobs) { const a0 = await jb.a0, a1 = await jb.a1, it = jb.it; if (++done % tick === 0) process.stdout.write(".");
    const t = truth[it.id] = truth[it.id] || { c0: 0, c1: 0, n: 0 }; t.c0 += a0.ok; t.c1 += a1.ok; t.n++;
    L.med.push({ dominio: A.id, lang, item: it.id, skill: it.skill, area: E.area(it.skill), type: it.type, d: it.d, rep: jb.k + 1, c0: a0.ok ? 1 : 0, c1: a1.ok ? 1 : 0, fmt0: a0.fmt, fmt1: a1.fmt, turns0: a0.turns || 1, turns1: a1.turns || 1, first0: a0.first == null ? "" : a0.first, first1: a1.first == null ? "" : a1.first, timeout: (a0.timeout || a1.timeout) ? 1 : "", raw0: String(a0.raw || "").slice(0, 120), raw1: String(a1.raw || "").slice(0, 120) }); }
  for (const k in truth) { truth[k].c0 /= truth[k].n; truth[k].c1 /= truth[k].n; }
  const pTrue = (it, notes) => { const t = truth[it.id]; return t ? +(notes ? t.c1 : t.c0).toFixed(3) : ""; };
  const skills = [...new Set(items.map(i => i.skill))];

  async function oneStudent(s) {
    const student = lang + "-" + s, out = { game: [], fixed: [] };
    if (opts.partida !== "fixa") {
      /* partida adaptativa: currículo na ordem do adaptador; fica na habilidade até o domínio Elo chegar a 0,6 ou esgotar
         --porhab itens; o item é o mais próximo da dificuldade-alvo (ou o pick() do próprio jogo, quando o adaptador o expõe) */
      const rS = makeRng(opts.semente, A.id, slug, lang, "aluno", s, "adaptativa"), st = {}, seen = {}, used = new Set(), rows = [], recent = [], solved = {};
      for (let n = 1; n <= opts.tickets && timeLeft() > 0; n++) {
        const tr = sk => st[sk] = st[sk] || KT.ensure({ L: L0_JOGO });
        const sk = skills.find(x => (seen[x] || 0) < opts.porhab && KT.mastery(tr(x), "elo") < 0.6 && items.some(i => i.skill === x && !used.has(i.id))) || skills.find(x => items.some(i => i.skill === x && !used.has(i.id)));
        if (!sk) break;
        const pool = items.filter(i => i.skill === sk && !used.has(i.id)), m = KT.mastery(tr(sk), "elo");
        let it = E.pick ? E.pick(pool, m, recent, solved, rS) : null;
        if (!it) { const target = m < .35 ? 1 : m < .7 ? 2 : 3; it = pool.map(i => [i, Math.abs((i.d || 2) - target) + rS() * .5]).sort((a, b) => a[1] - b[1])[0][0]; }
        used.add(it.id); recent.push(it.id); if (recent.length > 8) recent.shift();
        seen[sk] = (seen[sk] || 0) + 1; const notes = seen[sk] > PASSO();
        const pred = KT.predictAll(tr(sk), ktItem(it), it.c);
        const a = await attempt(E, brain, lang, it, notes, rS);
        KT.updateAll(tr(sk), ktItem(it), it.c, a.ok ? 1 : 0); if (a.ok) solved[it.id] = 1;
        const row = { dominio: A.id, lang, student, row: n, item: it.id, skill: sk, area: E.area(sk), type: it.type, d: it.d, kc_index: seen[sk], has_notes: notes ? 1 : 0, p_true: pTrue(it, notes), y: a.ok ? 1 : 0, fmt: a.fmt, turns: a.turns || 1 };
        MODELS.forEach(k => row["pred_" + k] = pred[k]); rows.push(row);
      }
      if (rows.length < Math.min(opts.tickets, items.length) && timeLeft() <= 0) return null;
      const rp = KT.replay(rows.map(g => ({ key: g.skill, item: ktItem(E.byId[g.item]), c: E.byId[g.item].c, y: g.y })), L0_JOGO);
      rows.forEach((g, i) => MODELS.forEach(k => g["rpred_" + k] = rp[i][k]));
      out.game = rows;
    }
    if (opts.partida !== "adaptativa") {
      if (timeLeft() <= 0) return null;
      const rF = makeRng(opts.semente, A.id, slug, lang, "aluno", s, "fixa"), order = shuf(items, rF), seenF = {}, plan = [];
      for (const it of order) { seenF[it.skill] = (seenF[it.skill] || 0) + 1; plan.push({ it, k: seenF[it.skill], notes: seenF[it.skill] > PASSO() }); }
      const asks = plan.map(p => attempt(E, brain, lang, p.it, p.notes, rF)), rowsF = [];
      for (let i = 0; i < plan.length; i++) { const a = await asks[i], { it, k, notes } = plan[i];
        rowsF.push({ dominio: A.id, lang, student, row: i + 1, item: it.id, skill: it.skill, area: E.area(it.skill), type: it.type, d: it.d, kc_index: k, has_notes: notes ? 1 : 0, p_true: pTrue(it, notes), y: a.ok ? 1 : 0, fmt: a.fmt, turns: a.turns || 1 }); }
      const rp = KT.replay(rowsF.map(g => ({ key: g.skill, item: ktItem(E.byId[g.item]), c: E.byId[g.item].c, y: g.y })), L0_JOGO);
      rowsF.forEach((g, i) => MODELS.forEach(m => g["rpred_" + m] = rp[i][m]));
      out.fixed = rowsF;
    }
    process.stdout.write(" | aluno " + s);
    return out;
  }
  const results = await Promise.all(Array.from({ length: opts.alunos }, (_, i) => oneStudent(i + 1)));
  for (const r of results) if (r) { L.game.push(...r.game); L.fixed.push(...r.fixed); }
  if (opts.tutor > 0 && E.tutorTask && brain.kind !== "aleatorio" && timeLeft() > 0) {
    process.stdout.write(" | tutores"); const rT = makeRng(opts.semente, A.id, slug, lang, "tutor");
    const tItems = shuf(items.filter(i => E.tutorTask(lang, i, makeRng("teste"))), rT).slice(0, opts.tutor);
    for (const it of tItems) { if (timeLeft() <= 0) break; L.tut.push(...await tutorRun(E, brain, lang, it, rT)); }
  }
  const d = k => brain.stats[k] - st0[k]; L.perLang.push({ lang, calls: d("calls"), min: (Date.now() - tl) / 60000, inTok: d("inTok"), outTok: d("outTok") });
  console.log(" | " + ((Date.now() - tl) / 60000).toFixed(1) + " min");
  return L;
}

/* ---------------- métricas ---------------- */
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
function auc(p, y) { const pos = [], neg = []; p.forEach((v, i) => (y[i] ? pos : neg).push(v)); if (!pos.length || !neg.length) return null; let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? .5 : 0; return w / (pos.length * neg.length); }
/* regime de cada (idioma, habilidade) pelo degrau MEDIDO na C0/C1. Δ de cada item = acerto com notas − sem notas (média das
   repetições); o IC 95% da média de Δ entre os itens da habilidade decide (fixado antes dos resultados):
     DEGRAU  limite inferior do IC > 0 e Δ̄ ≥ 0,10        há aprendizagem real com as notas
     PLANO   o IC contém zero e |Δ̄| < 0,10              sem evidência de degrau e efeito pequeno (nada a aprender, já sabia
                                                        tudo, ou não consegue nem com as notas)
     intermediário: o resto
   Com ~10 itens por habilidade não há poder para provar equivalência a zero; por isso "plano" é "sem degrau detectável
   e pequeno", e o cérebro aleatório (que não aprende nada) serve de checagem: quase todas as habilidades dele são planas. */
function regimes(med) {
  const by = {}; med.forEach(x => { const k = x.lang + "|" + x.skill; const b = by[k] = by[k] || {}; const it = b[x.item] = b[x.item] || { c0: [], c1: [] }; it.c0.push(x.c0); it.c1.push(x.c1); });
  const out = {}; for (const k in by) { const its = Object.values(by[k]), d = its.map(i => mean(i.c1) - mean(i.c0)), n = d.length, dm = mean(d);
    const sd = n > 1 ? Math.sqrt(d.reduce((s, v) => s + (v - dm) ** 2, 0) / (n - 1)) : 1, se = sd / Math.sqrt(n), lo = dm - 1.96 * se, hi = dm + 1.96 * se;
    out[k] = { c0: mean(its.map(i => mean(i.c0))), c1: mean(its.map(i => mean(i.c1))), delta: dm, lo, hi, n,
      regime: lo > 0 && dm >= REGIME.degrau ? "degrau" : (lo <= 0 && hi >= 0 && Math.abs(dm) < REGIME.plano) ? "plano" : "intermediario" }; }
  return out;
}
/* unidade = idioma × aluno, partida fixa, PRIOR CORRETO (cada habilidade começa do acerto medido sem notas) */
function unitMetrics(E, med, game, fixed, opts) {
  const R = regimes(med), units = [], areas = [...new Set(E.skills.map(s => s.area).filter(Boolean))];
  for (const st of [...new Set(fixed.map(g => g.student))]) {
    const F = fixed.filter(g => g.student === st && g.p_true !== ""), A2 = game.filter(g => g.student === st && g.p_true !== ""), lang = F[0] ? F[0].lang : st.split("-")[0];
    const P = [];
    for (const sk of [...new Set(F.map(g => g.skill))]) { const rows = F.filter(g => g.skill === sk), rg = R[lang + "|" + sk];
      const rp = KT.replay(rows.map(g => ({ key: sk, item: ktItem(E.byId[g.item]), c: E.byId[g.item].c, y: g.y })), Math.min(.95, Math.max(.05, rg ? rg.c0 : L0_JOGO)));
      rows.forEach((g, i) => P.push({ g, p: rp[i], regime: rg ? rg.regime : "intermediario" })); }
    const u = { student: st, lang };
    const dTrue = (rows, f) => mean(rows.filter(x => f(x).kc_index > PASSO()).map(x => +f(x).p_true)) - mean(rows.filter(x => f(x).kc_index <= PASSO()).map(x => +f(x).p_true));
    u.mask_adapt = A2.length ? dTrue(A2, g => g) : null; u.mask_fixed = dTrue(F, g => g);
    const block = (Q, tag) => { if (Q.length < 6 || !Q.some(x => x.g.kc_index > PASSO()) || !Q.some(x => x.g.kc_index <= PASSO())) return;
      const dT = dTrue(Q, x => x.g); u["dtrue_" + tag] = dT; u["n_" + tag] = Q.length;
      for (const m of MODELS) { const dP = mean(Q.filter(x => x.g.kc_index > PASSO()).map(x => x.p[m])) - mean(Q.filter(x => x.g.kc_index <= PASSO()).map(x => x.p[m]));
        u[m + "_excess_" + tag] = dP - dT; u[m + "_brier_" + tag] = mean(Q.map(x => (x.p[m] - x.g.p_true) ** 2)); } };
    block(P, "all"); block(P.filter(x => x.regime === "plano"), "plano"); block(P.filter(x => x.regime === "degrau"), "degrau");
    for (const ar of areas) block(P.filter(x => x.g.area === ar), "area_" + ar);
    /* AUC contra a resposta observada e queda sob embaralhamento (C3), com o prior do jogo, como numa partida real */
    const rp0 = KT.replay(F.map(g => ({ key: g.skill, item: ktItem(E.byId[g.item]), c: E.byId[g.item].c, y: g.y })), L0_JOGO);
    const rS = makeRng(opts.semente, "c3", st), perm = shuf(F, rS);
    const rp1 = KT.replay(perm.map(g => ({ key: g.skill, item: ktItem(E.byId[g.item]), c: E.byId[g.item].c, y: g.y })), L0_JOGO);
    for (const m of MODELS) { const a0 = auc(rp0.map(x => x[m]), F.map(g => g.y)), a1 = auc(rp1.map(x => x[m]), perm.map(g => g.y));
      u[m + "_auc"] = a0; u[m + "_c3drop"] = a0 != null && a1 != null ? a0 - a1 : null; u[m + "_brier_all"] = mean(P.map(x => (x.p[m] - x.g.p_true) ** 2)); }
    units.push(u);
  }
  return units;
}
function ci(vals, B = 2000) {
  const v = vals.filter(x => x != null && !isNaN(x)); if (v.length < 2) return v.length ? { m: v[0], lo: NaN, hi: NaN, n: 1 } : null;
  const m = v.reduce((s, x) => s + x, 0) / v.length, bs = []; let a = 987654321; const r = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < v.length; i++) s += v[Math.floor(r() * v.length)]; bs.push(s / v.length); }
  bs.sort((x, y) => x - y); return { m, lo: bs[Math.floor(.025 * B)], hi: bs[Math.floor(.975 * B)], n: v.length };
}
/* Bootstrap de idiomas inteiros quando há 5+ idiomas (alunos do mesmo idioma não são independentes).
   Com 2 a 4 idiomas, sortear idiomas é degenerado (com 2 só há 3 reamostras distintas: o "IC" vira o intervalo entre as
   duas médias e sai estreito demais — erro achado na verificação de 08/10). Nesse caso o sorteio é de ALUNOS dentro de
   cada idioma (estratificado), e com 1 idioma, de alunos. Continua otimista: os alunos dividem itens e verdade medida. */
function ciLang(units, key, B = 2000) {
  const get = u => typeof key === "function" ? key(u) : u[key];
  const by = {}; for (const u of units) { const v = get(u); if (v == null || isNaN(v)) continue; (by[u.lang] = by[u.lang] || []).push(v); }
  const L = Object.keys(by); if (L.length < 2) return ci(units.map(get));
  if (L.length < 5) { const all = L.flatMap(l => by[l]); if (all.length < 2) return ci(all); const m = all.reduce((s, x) => s + x, 0) / all.length, bs = [];
    let a = 192837465; const r = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
    for (let b = 0; b < B; b++) { let s2 = 0, n = 0; for (const l of L) { const g = by[l]; for (let i = 0; i < g.length; i++) { s2 += g[Math.floor(r() * g.length)]; n++; } } bs.push(s2 / n); }
    bs.sort((x, y) => x - y); return { m, lo: bs[Math.floor(.025 * B)], hi: bs[Math.floor(.975 * B)], n: all.length }; }
  const all = L.flatMap(l => by[l]), m = all.reduce((s, x) => s + x, 0) / all.length, bs = []; let a = 123456789; const r = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
  for (let b = 0; b < B; b++) { let s2 = 0, n = 0; for (let i = 0; i < L.length; i++) { const g = by[L[Math.floor(r() * L.length)]]; for (const x of g) { s2 += x; n++; } } bs.push(s2 / n); }
  bs.sort((x, y) => x - y); return { m, lo: bs[Math.floor(.025 * B)], hi: bs[Math.floor(.975 * B)], n: all.length };
}
const fci = c => !c ? "-" : (c.m >= 0 ? "+" : "") + c.m.toFixed(2) + (isNaN(c.lo) ? "" : " [" + c.lo.toFixed(2) + ", " + c.hi.toFixed(2) + "]");
const f2 = v => v == null || isNaN(v) ? "-" : v.toFixed(2), f3 = v => v == null || isNaN(v) ? "-" : v.toFixed(3);

/* ---------------- relatório de uma passada ---------------- */
function report(E, brain, langs, med, game, fixed, tut, units, perLang, ms) {
  const st = brain.stats, R = regimes(med);
  let r = `# ${A.nome} · laboratório de agentes\n\nDomínio: **${E.dominioPt}** · cérebro \`${brain.spec}\` · idiomas ${langs.join(", ")} · ${new Set(med.map(x => x.item)).size} itens · duração ${(ms / 60000).toFixed(1)} min · chamadas ${st.calls} (${st.fails} falhas)` + (st.inTok ? ` · tokens ${st.inTok} de entrada, ${st.outTok} de saída` : "") + `\n\nKT: o código canônico (cópia do DevWise), igual nos cinco domínios. Núcleo ${NUCLEO_VERSAO}.\n\n`;
  r += "## 1. Vazamento e efeito das notas (C0 e C1)\n\nC0 é o acerto sem notas: o quanto o cérebro já sabe do domínio. Se C0 ≈ C1 não há degrau a medir.\n\n| Idioma | C0 | C1 | Ganho | Teto (itens com C0 ≥ 0,95) |\n|---|---|---|---|---|\n";
  for (const l of langs) { const m = med.filter(x => x.lang === l); if (!m.length) continue; const byI = {}; m.forEach(x => (byI[x.item] = byI[x.item] || []).push(x.c0));
    r += `| ${l} | ${f2(mean(m.map(x => x.c0)))} | ${f2(mean(m.map(x => x.c1)))} | ${f2(mean(m.map(x => x.c1 - x.c0)))} | ${Object.values(byI).filter(v => mean(v) >= .95).length}/${Object.keys(byI).length} |\n`; }
  r += "\n**Por habilidade e regime** (fixado antes: degrau se o IC 95% de Δ fica acima de zero e Δ ≥ 0,10; plano se o IC contém zero e |Δ| < 0,10):\n\n| Idioma | Habilidade | Área | C0 | C1 | Δ [IC 95%] | Regime |\n|---|---|---|---|---|---|---|\n";
  for (const k of Object.keys(R).sort()) { const [l, s] = k.split("|"), x = R[k]; r += `| ${l} | ${E.skillName(s)} | ${E.area(s) || "-"} | ${f2(x.c0)} | ${f2(x.c1)} | ${f2(x.delta)} [${f2(x.lo)}, ${f2(x.hi)}] | ${x.regime} |\n`; }
  r += "\n**Por tipo de item**:\n\n| Tipo | C0 | C1 | Ganho | n |\n|---|---|---|---|---|\n";
  for (const ty of [...new Set(med.map(x => x.type))]) { const m = med.filter(x => x.type === ty); r += `| ${ty} | ${f2(mean(m.map(x => x.c0)))} | ${f2(mean(m.map(x => x.c1)))} | ${f2(mean(m.map(x => x.c1 - x.c0)))} | ${m.length} |\n`; }
  const fm = med.flatMap(x => [x.fmt0, x.fmt1]); r += `\n**Formato**: ${f2(fm.filter(v => v === "pedido").length / fm.length)} no formato pedido, ${f2(fm.filter(v => v === "tolerado").length / fm.length)} tolerado, ${f2(fm.filter(v => v === "ilegivel").length / fm.length)} ilegível (conta como erro).\n`;
  if (med.some(x => x.turns0 > 1 || x.turns1 > 1)) { const F0 = med.filter(x => x.first0 !== ""), F1 = med.filter(x => x.first1 !== "");
    r += `\n**Episódios**: média de ${f2(mean(med.map(x => x.turns0)))} rodadas sem notas e ${f2(mean(med.map(x => x.turns1)))} com notas por tarefa. Acerto na PRIMEIRA verificação (como o jogo conta): C0 ${f2(mean(F0.map(x => +x.first0)))}, C1 ${f2(mean(F1.map(x => +x.first1)))}.` + (med.some(x => x.timeout) ? ` ${med.filter(x => x.timeout).length} tentativa(s) bateram a trava de 30 s (reprodução exata não garantida nelas).` : "") + "\n"; }
  if (E.externo) r += "\n" + E.externo(med) + "\n";
  r += `\n## 2. Os modelos de KT (partida fixa, prior correto, ${units.length} unidades idioma × aluno)\n\n**Viés de ganho** = ganho previsto − ganho verdadeiro (antes × depois do degrau), em todas as habilidades. **Alarme falso** = o mesmo nas habilidades PLANAS (aprendizagem fantasma). **Excesso no degrau** = ganho previsto menos o verdadeiro onde há aprendizagem (negativo: não enxerga). AUC contra a resposta observada; **queda C3** = AUC perdida ao embaralhar a ordem (quanto o modelo depende da sequência).\n\n| Modelo | Viés de ganho | Alarme falso (plano) | Excesso no degrau | Brier vs verdade | AUC | Queda C3 |\n|---|---|---|---|---|---|---|\n`;
  for (const m of MODELS) r += `| ${m.toUpperCase()} | ${fci(ciLang(units, m + "_excess_all"))} | ${fci(ciLang(units, m + "_excess_plano"))} | ${fci(ciLang(units, m + "_excess_degrau"))} | ${fci(ciLang(units, m + "_brier_all"))} | ${fci(ciLang(units, m + "_auc"))} | ${fci(ciLang(units, m + "_c3drop"))} |\n`;
  r += `\nGanho verdadeiro: todas ${fci(ciLang(units, "dtrue_all"))} · no degrau ${fci(ciLang(units, "dtrue_degrau"))} · no plano: ${fci(ciLang(units, "dtrue_plano"))}. Unidades com habilidades planas: ${units.filter(u => u.n_plano).length}; com degrau: ${units.filter(u => u.n_degrau).length}.\n`;
  const areas = [...new Set(E.skills.map(s => s.area).filter(Boolean))];
  if (areas.length > 1) { r += "\n**Por área do domínio** (excesso = ganho previsto − verdadeiro):\n\n| Modelo | " + areas.join(" | ") + " |\n|---|" + areas.map(() => "---").join("|") + "|\n";
    for (const m of MODELS) r += `| ${m.toUpperCase()} | ` + areas.map(a => fci(ciLang(units, m + "_excess_area_" + a))).join(" | ") + " |\n"; }
  r += `\n**Mascaramento pela adaptação**: Δ verdade antes → depois do degrau, partida adaptativa ${fci(ciLang(units, "mask_adapt"))}, fixa ${fci(ciLang(units, "mask_fixed"))}. Adaptativa abaixo da fixa = a seleção de itens mais difíceis esconde o ganho na taxa de acerto.\n`;
  const G = game.filter(g => g.p_true !== "");
  if (G.length) { r += `\n**Partida adaptativa, previsão online** (${G.length} linhas; antes de cada resposta, prior do jogo):\n\n| Modelo | AUC | Brier vs verdade |\n|---|---|---|\n`;
    for (const m of MODELS) r += `| ${m.toUpperCase()} | ${f3(auc(G.map(g => +g["pred_" + m]), G.map(g => g.y)))} | ${f3(mean(G.map(g => (+g["pred_" + m] - +g.p_true) ** 2)))} |\n`; }
  if (tut.length) { r += "\n## 3. Tutores (QP2)\n\n| Idioma | Estratégia | Vazamento | chrF vs referência | Caracteres |\n|---|---|---|---|---|\n";
    for (const l of langs) for (const s of ["S1", "S2", "S3"]) { const t = tut.filter(x => x.lang === l && x.strategy === s); if (!t.length) continue;
      const cf = t.filter(x => x.chrf !== ""); r += `| ${l} | ${s} | ${f2(mean(t.map(x => x.leak)))} | ${cf.length ? mean(cf.map(x => x.chrf)).toFixed(1) : "-"} | ${Math.round(mean(t.map(x => x.chars)))} |\n`; } }
  if (perLang.length) { r += "\n## 4. Custo por idioma\n\n| Idioma | Chamadas | Minutos | Tokens de entrada | Tokens de saída |\n|---|---|---|---|---|\n"; for (const x of perLang) r += `| ${x.lang} | ${x.calls} | ${x.min.toFixed(1)} | ${x.inTok} | ${x.outTok} |\n`; }
  r += "\n## Limites\n\n" + E.limites.map(x => "- " + x).join("\n") + "\n- Agentes não cansam nem esquecem: o laboratório valida instrumentos de medida, não substitui aprendizes reais.\n";
  return r;
}

/* ---------------- piloto/estudo ---------------- */
async function pilot(opts) {
  const E = env(opts), brain = makeBrain(opts.cerebro), langs = opts.idiomas || E.idiomas, budgetMs = opts.minutos > 0 ? opts.minutos * 60000 : Infinity, t0 = Date.now();
  const falta = faltando(E, opts, langs), nf = Object.entries(falta).filter(([, v]) => v.length);
  if (nf.length) throw new Error("Faltam traduções: " + nf.map(([l, v]) => l + " (" + v.length + " textos)").join(", ") + ". Rode antes: " + nf.map(([l]) => "node tools/agentes/laboratorio.js traduzir --idioma " + l + " --cerebro deepseek:deepseek-v4-pro").join(" ; "));
  await preflight(brain);
  const out = path.join(ROOT, "agentes", "saida", opts.rodada, brainSlug(opts.cerebro)), parc = path.join(out, "parcial"); fs.mkdirSync(parc, { recursive: true });
  const items = studyItems(E, opts);
  fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ ...opts, idiomas: langs, dominio: A.id, nucleo: NUCLEO_VERSAO, itens: items.map(i => i.id), traducoes: Object.fromEntries(langs.filter(l => l !== "pt").map(l => [l, Object.keys(tradCache(l)).length])), inicio: new Date().toISOString() }, null, 1));
  console.log(`\n== ${A.nome} · ${brain.spec} · rodada ${opts.rodada} · ${items.length} itens em ${new Set(items.map(i => i.skill)).size} habilidades · ${opts.reps} repetições · ${opts.alunos} alunos · semente ${opts.semente}`);
  const all = { med: [], game: [], fixed: [], tut: [], perLang: [] }, timeLeft = () => budgetMs - (Date.now() - t0);
  for (const lang of langs) {
    const pf = path.join(parc, lang + ".json"); let L = null;
    if (fs.existsSync(pf)) { L = JSON.parse(fs.readFileSync(pf, "utf8")); console.log(lang + ": já feito nesta rodada, retomado do disco"); }
    else { if (timeLeft() <= 0) { console.log("Tempo esgotado antes de " + lang + ". Rode o mesmo comando com --rodada " + opts.rodada + " para continuar."); break; }
      L = await runLanguage(opts, E, brain, lang, items, timeLeft);
      const nAl = new Set((opts.partida === "adaptativa" ? L.game : L.fixed).map(g => g.student)).size;
      if (nAl < opts.alunos) { console.log("   " + lang + " ficou incompleto e não foi gravado; será refeito na retomada."); break; }
      fs.writeFileSync(pf + ".tmp", JSON.stringify(L)); fs.renameSync(pf + ".tmp", pf); }
    for (const k in all) all[k].push(...L[k]);
  }
  fs.writeFileSync(path.join(out, "medicao.csv"), csvOf(all.med)); fs.writeFileSync(path.join(out, "jogo.csv"), csvOf(all.game));
  if (all.fixed.length) fs.writeFileSync(path.join(out, "jogo-fixo.csv"), csvOf(all.fixed));
  fs.writeFileSync(path.join(out, "tutores.jsonl"), all.tut.map(r => JSON.stringify(r)).join("\n"));
  const units = unitMetrics(E, all.med, all.game, all.fixed, opts), R = regimes(all.med);
  const resumoDominio = { c0: mean(all.med.map(x => x.c0)), c1: mean(all.med.map(x => x.c1)), regimes: Object.values(R).reduce((o, x) => (o[x.regime] = (o[x.regime] || 0) + 1, o), {}) };
  fs.writeFileSync(path.join(out, "metricas.json"), JSON.stringify({ dominio: A.id, dominioPt: E.dominioPt, cerebro: opts.cerebro, papel: opts.papel || "estudo", rodada: opts.rodada, nucleo: NUCLEO_VERSAO, resumo: resumoDominio, units }, null, 1));
  fs.writeFileSync(path.join(out, "RESUMO.md"), report(E, brain, langs, all.med, all.game, all.fixed, all.tut, units, all.perLang, Date.now() - t0));
  try { ajustarPasta(E, out); } catch (e) { console.log("   aviso: o ajuste dos modelos falhou (" + e.message + "); rode depois: node tools/agentes/laboratorio.js ajustar --rodada " + opts.rodada); }
  console.log("Pronto em " + ((Date.now() - t0) / 60000).toFixed(1) + " min. Resultados em " + path.relative(ROOT, out));
}

/* ---------------- triagem: critérios fixados antes de ver resultados ----------------
   (1) ≥ 90% de respostas legíveis em cada idioma do domínio; (2) acerto com notas ≥ 0,30;
   (3) há o que medir: pelo menos 2 habilidades com degrau, OU degrau global (todos os itens juntos, mesma regra). 2 repetições, até 6 itens por
   habilidade, ~40 itens no total.
   Domínio-CONTROLE (--papel controle): o papel dele é justamente não ter degrau (como engenharia de software no DevWise
   e o ENEM no artigo dos confundidores), então o critério (3) não se aplica; (1) e (2) continuam valendo. O papel fica
   gravado na triagem e em metricas.json, e a comparação o mostra. */
const GATE = { legivel: 0.90, c1: 0.30, habDegrau: 2 };
async function triage(opts) {
  const E = env(opts), brain = makeBrain(opts.cerebro); await preflight(brain);
  /* no máximo ~40 itens, como no DevWise: até 6 por habilidade, nas primeiras habilidades do estudo, sorteadas com semente */
  const all = studyItems(E, { ...opts, itens: Math.min(6, opts.itens || 6) }), sks = LAB.shuf([...new Set(all.map(i => i.skill))], makeRng(opts.semente, A.id, "triagem-hab")), keep = new Set(); let n = 0;
  for (const s of sks) { const k = all.filter(i => i.skill === s).length; if (n + k > 40 && keep.size >= 2) break; keep.add(s); n += k; }
  const items = all.filter(i => keep.has(i.skill)), res = {}, med = [], amostra = [], t0 = Date.now();
  const TL = opts.idiomas || E.idiomas, falta = faltando(E, opts, TL), nf = Object.entries(falta).filter(([, v]) => v.length);
  if (nf.length) throw new Error("Faltam traduções: " + nf.map(([l, v]) => l + " (" + v.length + " textos)").join(", ") + ". Rode antes: node tools/agentes/laboratorio.js traduzir --idioma <idioma> --cerebro deepseek:deepseek-v4-pro");
  console.log("Triagem de " + brain.spec + " em " + A.nome + ": " + items.length + " itens × 2 condições × 2 repetições em " + TL.join(", "));
  for (const lang of TL) { const rl = makeRng(opts.semente, A.id, "triagem", lang), jobs = [];
    for (const it of items) for (let k = 0; k < 2; k++) jobs.push({ it, a0: attempt(E, brain, lang, it, false, rl), a1: attempt(E, brain, lang, it, true, rl) });
    const rows = []; for (const j of jobs) { const a0 = await j.a0, a1 = await j.a1; rows.push({ it: j.it, a0, a1 }); med.push({ lang, skill: j.it.skill, item: j.it.id, c0: a0.ok ? 1 : 0, c1: a1.ok ? 1 : 0 });
      if (amostra.length < 30) amostra.push({ lang, item: j.it.id, c0: a0.ok ? 1 : 0, c1: a1.ok ? 1 : 0, resposta_sem_notas: String(a0.raw || ""), resposta_com_notas: String(a1.raw || "") }); }
    res[lang] = { legivel: mean(rows.flatMap(x => [x.a0.fmt !== "ilegivel" ? 1 : 0, x.a1.fmt !== "ilegivel" ? 1 : 0])), c0: mean(rows.map(x => +x.a0.ok)), c1: mean(rows.map(x => +x.a1.ok)) };
    console.log(`  ${lang}: legíveis ${(100 * res[lang].legivel).toFixed(0)}%  sem notas ${res[lang].c0.toFixed(2)}  com notas ${res[lang].c1.toFixed(2)}`); }
  const R = regimes(med), nDeg = Object.values(R).filter(x => x.regime === "degrau").length, motivos = [];
  /* degrau GLOBAL: a mesma regra do regime (IC 95% acima de zero e Δ̄ ≥ 0,10), com todos os itens da triagem juntos.
     Necessário porque, com 3–4 itens por habilidade (IAWise), o IC por habilidade nunca exclui zero, qualquer que seja o
     cérebro: o critério por habilidade era inalcançável ali. Vale igual para todos os domínios. */
  const G = regimes(med.map(x => ({ ...x, lang: "*", skill: "*" })))["*|*"], degGlobal = G && G.regime === "degrau";
  for (const [l, x] of Object.entries(res)) if (x.legivel < GATE.legivel) motivos.push("legíveis em " + l + ": " + (100 * x.legivel).toFixed(0) + "%");
  if (mean(Object.values(res).map(x => x.c1)) < GATE.c1) motivos.push("acerto com notas abaixo de " + GATE.c1);
  const controle = opts.papel === "controle";
  console.log(`  degrau global: Δ = ${G ? (G.delta >= 0 ? "+" : "") + G.delta.toFixed(2) + " [" + G.lo.toFixed(2) + ", " + G.hi.toFixed(2) + "]" : "-"} · habilidades com degrau: ${nDeg}`);
  if (nDeg < GATE.habDegrau && !degGlobal && !controle) motivos.push("só " + nDeg + " habilidade(s) com degrau e sem degrau global: pouco a medir (se este domínio é controle, rode com --papel controle)");
  if (controle) console.log("  papel: CONTROLE (" + nDeg + " habilidade(s) com degrau; o critério de degrau não se aplica)");
  const ok = !motivos.length, out = path.join(ROOT, "agentes", "saida", opts.rodada); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "triagem-" + brainSlug(opts.cerebro) + ".json"), JSON.stringify({ dominio: A.id, cerebro: opts.cerebro, papel: opts.papel || "estudo", aprovado: ok, motivos, criterios: GATE, resultados: res, regimes: R, degrauGlobal: G, amostra: amostra.slice(0, 30), minutos: (Date.now() - t0) / 60000 }, null, 1));
  console.log(ok ? "\nAPROVADO: entra no estudo." : "\nREPROVADO: " + motivos.join("; ") + ".");
  if (!ok) process.exitCode = 2;
}
/* textos que faltam no cache para estes idiomas (o adaptador percorre notas e itens do estudo: coletar) */
function faltando(E, opts, langs) {
  const items = studyItems(E, opts), out = {};
  for (const lang of langs) { if (lang === "pt") continue; TRAD.missing[lang] = new Set(); if (E.coletar) E.coletar(lang, items);
    if (E.tutorTask) for (const it of items) for (let k = 1; k <= 6; k++) { try { E.tutorTask(lang, it, makeRng("coleta-tutor", it.id, k)); } catch (e) {} }   /* as dicas de referência do tutor também */
    out[lang] = [...TRAD.missing[lang]]; }
  return out;
}
const PROT = /[\u3040-\u30ff\u4e00-\u9fff\u0e00-\u0e7f\u0e00-\u0e7f]+|\{[^}]*\}|\d+(?:[.,]\d+)?/g;
function validTr(src, tgt) {
  if (typeof tgt !== "string" || !tgt.trim()) return "vazio";
  for (const p of src.match(PROT) || []) if (!tgt.includes(p)) return "perdeu " + p;
  const lead = x => (x.match(/^\s*(##|-|\*|\d+\.)\s/) || [""])[0].trim();
  if (lead(src) !== lead(tgt)) return "marcador inicial";
  if (src.length > 40 && (tgt.length < .3 * src.length || tgt.length > 3 * src.length)) return "tamanho";
  return null;
}
async function translate(opts) {
  const lang = opts.idioma; if (!lang || lang === "pt") throw new Error("Use --idioma es (ou en, fr...): o português é a língua de origem.");
  if (!process.env.LAB_PARALELO) process.env.LAB_PARALELO = "4";
  const E = env(opts), brain = makeBrain(opts.cerebro); await preflight(brain);
  const miss = faltando(E, opts, [lang])[lang], cache = tradCache(lang), name = langNameOf(lang);
  console.log(`${A.nome} → ${name}: ${miss.length} textos a traduzir (${miss.reduce((s2, x) => s2 + x.length, 0)} caracteres); já no cache: ${Object.keys(cache).length}. Cérebro: ${brain.spec}`);
  if (!miss.length) { console.log("Nada a fazer."); return; }
  fs.mkdirSync(path.dirname(tradFile(lang)), { recursive: true });
  const save = () => { const f = tradFile(lang), o = {}; for (const k of Object.keys(cache).sort()) o[k] = cache[k]; fs.writeFileSync(f + ".tmp", JSON.stringify(o, null, 1)); fs.renameSync(f + ".tmp", f); };
  const SYS = `You are a professional translator. Translate each string of the JSON array from Brazilian Portuguese (a few strings may already be in English) into natural, concise ${name} for an educational game. Rules: keep EXACTLY unchanged any Chinese characters, Thai script, pinyin, romanizations (Paiboon, RTGS), IPA, numbers, formulas, code and anything inside {braces}; keep leading markers such as "## ", "- ", "* " and separators such as " · ", " → ", " = ", " / ". Do not add explanations. Return ONLY a JSON array of strings with exactly the same number of items, in the same order.`;
  const batches = []; let cur = [], sz = 0;
  for (const x of miss) { if (cur.length && (cur.length >= 30 || sz + x.length > 5000)) { batches.push(cur); cur = []; sz = 0; } cur.push(x); sz += x.length; }
  if (cur.length) batches.push(cur);
  const r = makeRng("traducao", lang), failed = [], avisos = []; let done = 0, ok = 0;
  async function run(batch, tries) {
    const a = await brain.call([{ role: "system", content: SYS }, { role: "user", content: JSON.stringify(batch) }], { temperature: 0.2, max: Math.min(8000, 400 + Math.ceil(batch.reduce((s2, x) => s2 + x.length, 0) * 1.5)), rng: r });
    let arr = null; try { const m = String(a).match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : null; } catch (e) { arr = null; }
    const bad = [];
    batch.forEach((src, i) => { const tgt = arr && arr.length === batch.length ? arr[i] : null, why = tgt == null ? "resposta fora do formato" : validTr(src, tgt);
      if (why) bad.push({ src, why, tgt }); else { cache[src] = tgt; ok++; } });
    if (bad.length && tries > 0) { for (const b of bad) await run([b.src], tries - 1); return; }
    /* Esgotadas as tentativas: "perdeu <termo>" e "tamanho" costumam ser traduções legítimas (um rótulo gramatical em
       chinês traduzido, "14h" que vira "2 PM", "sala de jantar, refeitório" que vira "comedor"). Essas são ACEITAS com
       aviso, registradas em <idioma>-avisos.json para revisão humana; formato quebrado ou vazio continua bloqueando. */
    for (const b of bad) { if (b.tgt && /^(perdeu|tamanho)/.test(b.why)) { cache[b.src] = b.tgt; ok++; avisos.push(b); } else failed.push(b); }
  }
  await Promise.all(batches.map(b => run(b, 2).then(() => { done++; save(); process.stdout.write(`\r  lotes ${done}/${batches.length} · traduzidos ${ok}`); })));
  save(); console.log("");
  if (avisos.length) { const fa = path.join(path.dirname(tradFile(lang)), lang + "-avisos.json"), prev = fs.existsSync(fa) ? JSON.parse(fs.readFileSync(fa, "utf8")) : [];
    const all = [...prev.filter(p => !avisos.some(a => a.src === p.src)), ...avisos.map(a => ({ src: a.src, tgt: a.tgt, why: a.why }))];
    fs.writeFileSync(fa, JSON.stringify(all, null, 1)); console.log(`  ${avisos.length} tradução(ões) aceita(s) com aviso (perdeu um termo ou mudou de tamanho): revise em ${path.relative(ROOT, fa)}.`); }
  const ff = path.join(path.dirname(tradFile(lang)), lang + "-falhas.json");
  if (failed.length) { fs.writeFileSync(ff, JSON.stringify(failed, null, 1)); console.log(`  ${failed.length} texto(s) não passaram na validação; ficaram em português. Veja ${path.relative(ROOT, ff)}. Rode de novo para tentar outra vez.`); }
  else if (fs.existsSync(ff)) fs.unlinkSync(ff);
  const rest = faltando(E, opts, [lang])[lang].length;
  console.log(rest ? `Ainda faltam ${rest} textos.` : `Pronto: ${name} completo para o estudo padrão. Cache em ${path.relative(ROOT, tradFile(lang))} (versione este arquivo).`);
  if (rest) process.exitCode = 2;
}
async function calibrate(opts) {
  const E = env(opts), brain = makeBrain(opts.cerebro); await preflight(brain); const r = makeRng(opts.semente, "calibrar");
  const its = shuf(studyItems(E, opts), r).slice(0, 8), lang = E.idiomas[0]; let ok = 0;
  console.log("Calibrando " + brain.spec + " em " + A.nome + " com 8 itens (com notas)...");
  for (const it of its) { const a = await attempt(E, brain, lang, it, true, r); ok += a.ok; console.log("  " + String(it.id).slice(0, 18).padEnd(18) + (a.ok ? " certo  " : " errado ") + JSON.stringify(a.raw || "").slice(0, 70)); }
  const s = brain.stats, per = s.ms / Math.max(1, s.calls) / 1000, n = studyItems(E, opts).length;
  const perLang = n * 2 * opts.reps * (E.chamadasPorTentativa || 1) + opts.alunos * (opts.tickets + n) * (E.chamadasPorTentativa || 1) + opts.tutor * 4;
  console.log(`\nLatência média ${per.toFixed(2)} s por chamada · acertos ${ok}/8 · ~${perLang} chamadas por idioma · ${E.idiomas.length} idioma(s) ≈ ${(perLang * E.idiomas.length * per / 3600).toFixed(1)} h.`);
}
function info(opts) {
  const E = env(opts), items = studyItems(E, opts);
  const ex = ["en", "es", "fr", "de", "it"].filter(l => fs.existsSync(tradFile(l)) || E.idiomas.includes(l)), fl = faltando(E, opts, ex);
  console.log(`${A.nome} · domínio: ${E.dominioPt}\nIdiomas da ferramenta: ${E.idiomas.join(", ")} · cache de tradução: ${ex.map(l => l + " (" + Object.keys(tradCache(l)).length + " textos, " + (fl[l] || []).length + " faltando)").join(", ") || "nenhum"}\nHabilidades disponíveis: ${E.skills.length} · itens disponíveis: ${E.items.length}\nEstudo padrão: ${items.length} itens em ${new Set(items.map(i => i.skill)).size} habilidades`);
  for (const s of [...new Set(items.map(i => i.skill))]) { const t = items.filter(i => i.skill === s); console.log("  " + s.padEnd(12) + String(t.length).padStart(3) + " itens · " + E.skillName(s) + " · tipos " + [...new Set(t.map(i => i.type))].join(",")); }
  const r = makeRng("info"), it = items[0]; const lang = E.idiomas[0];
  if (E.preview) console.log("\nExemplo de item (" + it.id + "), com notas:\n" + "-".repeat(60) + "\n" + E.preview(lang, it, E.notes(lang, it.skill, it.id), r) + "\n" + "-".repeat(60));
}

function readCsv(f) {   /* CSV com aspas (o formato que csvOf grava) */
  const txt = fs.readFileSync(f, "utf8"), rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < txt.length; i++) { const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (ch !== "\r") cur += ch; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const h = rows.shift() || []; return rows.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
/* ---------------- consolidação de uma rodada (vários cérebros, um domínio) ---------------- */
/* aceita a pasta de UMA rodada (agentes/saida/<rodada>) ou a pasta de TODAS (agentes/saida): aí lê cada rodada dentro dela */
function loadRuns(base, deep) {
  if (!fs.existsSync(base)) throw new Error("Pasta não encontrada: " + base);
  const dirs = fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory()).sort();
  const here = dirs.filter(d => fs.existsSync(path.join(base, d, "metricas.json"))).map(d => { const f = path.join(base, d, "metricas.json");
    /* "mais recente" pelo início gravado em config.json (sobrevive a cópias e zips, que trocam a data dos arquivos); sem ele, pela data do arquivo */
    let t = fs.statSync(f).mtimeMs; try { const c = JSON.parse(fs.readFileSync(path.join(base, d, "config.json"), "utf8")); if (c.inicio && !isNaN(Date.parse(c.inicio))) t = Date.parse(c.inicio); } catch (e) { }
    return { d, j: JSON.parse(fs.readFileSync(f, "utf8")), rodada: path.basename(base), t }; });
  if (here.length || !deep) return here;
  return dirs.flatMap(r => loadRuns(path.join(base, r), false).map(x => ({ ...x, d: path.join(r, x.d) })));
}
function kendallW(ranks, rnd) {
  const n = ranks[0].length, W = rk => { const m = rk.length, Rs = rk[0].map((_, i) => rk.reduce((s, x) => s + x[i], 0)), Rm = mean(Rs); return 12 * Rs.reduce((s, x) => s + (x - Rm) ** 2, 0) / (m * m * (n ** 3 - n)); };
  const w0 = W(ranks); let c = 0; for (let k = 0; k < 5000; k++) { const pr = ranks.map(x => { const y = x.slice(); for (let i = y.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [y[i], y[j]] = [y[j], y[i]]; } return y; }); if (W(pr) >= w0 - 1e-12) c++; }
  return { W: w0, p: c / 5000 };
}
const rankOf = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), rk = Array(v.length); o.forEach(([, i], k) => rk[i] = k + 1); return rk; };
function consolidate(opts) {
  const base = path.join(ROOT, "agentes", "saida", opts.rodada), rows = loadRuns(base);
  let rs = 2024; const rnd = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs / 4294967296; };
  let r = `# ${A.nome} · consolidado da rodada ${opts.rodada}\n\n${rows.length} cérebro(s). Médias com IC 95% (bootstrap de idiomas inteiros; com um idioma, de alunos), partida fixa, prior correto.\n\n`;
  for (const [tag, nome] of [["plano", "Alarme falso (habilidades planas)"], ["degrau", "Excesso no degrau"]]) {
    r += `## ${nome}\n\n| Cérebro | C0 | C1 | ` + MODELS.map(m => m.toUpperCase()).join(" | ") + " |\n|---|---|---|" + MODELS.map(() => "---").join("|") + "|\n";
    for (const { j } of rows) r += `| ${j.cerebro} | ${f2(j.resumo.c0)} | ${f2(j.resumo.c1)} | ` + MODELS.map(m => fci(ciLang(j.units, m + "_excess_" + tag))).join(" | ") + " |\n";
    r += "\n"; }
  if (rows.length >= 2) {
    r += "## A ordem dos modelos se repete entre cérebros? (W de Kendall)\n\n";
    for (const tag of ["plano", "degrau"]) { const rk = rows.map(({ j }) => { const v = MODELS.map(m => mean(j.units.map(u => u[m + "_excess_" + tag]).filter(x => x != null))); return v.some(x => x == null || isNaN(x)) ? null : rankOf(v); }).filter(Boolean);
      if (rk.length >= 2) { const k = kendallW(rk, rnd); r += `**${tag}**: W = ${k.W.toFixed(2)}, p = ${k.p.toFixed(4)} (${rk.length} cérebros)\n\n`; } }
    const kind = c => c.split(":")[0] === "ollama" ? "local" : c.split(":")[0] === "simulado" ? "simulado" : "API", g = { local: rows.filter(x => kind(x.j.cerebro) === "local"), API: rows.filter(x => kind(x.j.cerebro) === "API") };
    if (g.local.length && g.API.length) { r += "## Locais × API\n\n| Modelo | Regime | Locais | API |\n|---|---|---|---|\n";
      for (const m of MODELS) for (const tag of ["plano", "degrau"]) { const gm = G => mean(G.map(x => mean(x.j.units.map(u => u[m + "_excess_" + tag]).filter(v => v != null))).filter(v => v != null && !isNaN(v)));
        r += `| ${m.toUpperCase()} | ${tag} | ${f2(gm(g.local))} | ${f2(gm(g.API))} |\n`; } }
  }
  fs.writeFileSync(path.join(base, "CONSOLIDADO.md"), r); console.log(r); console.log("Gravado em " + path.relative(ROOT, path.join(base, "CONSOLIDADO.md")));
}

/* ---------------- COMPARAÇÃO ENTRE DOMÍNIOS ----------------
   Lê as rodadas de várias ferramentas (inclusive a do laboratório original do DevWise, cujas chaves são mapeadas:
   engenharia de software → plano; programação com dialeto → degrau) e pergunta:
     (1) o comportamento de cada modelo de KT muda com o domínio? (alarme falso, excesso, Brier, AUC, queda C3)
     (2) a ORDEM dos modelos se repete entre domínios? (W de Kendall, domínios como "juízes")
     (3) o vazamento do domínio (C0) acompanha o viés? (descritivo: com 5 domínios não há poder para teste) */
function compare(opts) {
  if (!opts.pastas) throw new Error("Use --pastas Nome=caminho,Nome2=caminho2 (cada caminho é a pasta de uma rodada: agentes/saida/<rodada>)");
  const doms = opts.pastas.split(",").map(x => { const i = x.indexOf("="), n = i > 0 ? x.slice(0, i) : path.basename(path.dirname(path.dirname(path.dirname(x)))), p = i > 0 ? x.slice(i + 1) : x; return { nome: n, base: path.resolve(p) }; });
  let rs = 77; const rnd = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs / 4294967296; };
  const D = [];
  for (const d of doms) { const runs = loadRuns(d.base, true);
    for (const { d: sub, j } of runs) {
      let units = j.units;
      if (!j.dominio) {   /* laboratório original do DevWise */
        units = j.units.map(u => { const v = { ...u }; for (const m of MODELS) { if (u[m + "_excess_se"] != null) v[m + "_excess_plano"] = u[m + "_excess_se"]; if (j.dialeto && u[m + "_excess_prog"] != null) v[m + "_excess_degrau"] = u[m + "_excess_prog"]; if (u[m + "_brier_prog"] != null) v[m + "_brier_all"] = u[m + "_brier_prog"]; } return v; });
        if (!j.dialeto && runs.some(x => x.j.dialeto && x.j.cerebro === j.cerebro)) units = units.map(u => { const v = { ...u }; MODELS.forEach(m => delete v[m + "_excess_degrau"]); return v; });
      }
      { const fa = path.join(d.base, sub, "ajuste.json");   /* KT ajustado (ajustar): junta as métricas por aluno */
        if (fs.existsSync(fa)) { const aj = JSON.parse(fs.readFileSync(fa, "utf8")), by = Object.fromEntries(aj.units.map(u => [u.student, u])); units = units.map(u => ({ ...u, ...(by[u.student] || {}), aj: !!by[u.student] })); } }
      let resumo = j.resumo || null;
      if (!resumo) { const f = path.join(d.base, sub, "medicao.csv"); if (fs.existsSync(f)) { const med = readCsv(f).map(x => ({ ...x, c0: +x.c0, c1: +x.c1 })), R = regimes(med);
        resumo = { c0: mean(med.map(x => x.c0)), c1: mean(med.map(x => x.c1)), regimes: Object.values(R).reduce((o, x) => (o[x.regime] = (o[x.regime] || 0) + 1, o), {}) }; } }
      D.push({ dom: d.nome, cerebro: j.cerebro, dialeto: !!j.dialeto, units, resumo, sub, rodada: runs.find(x => x.d === sub).rodada, t: runs.find(x => x.d === sub).t, papel: j.papel || (j.dominio ? "estudo" : (j.dialeto ? "estudo" : "estudo")) }); } }
  if (!D.length) throw new Error("Nenhuma métrica encontrada nas pastas indicadas.");
  /* Comparar domínios só faz sentido com o MESMO cérebro em todos: o par cérebro × domínio não pode variar junto com o domínio.
     (1) sem --cerebro, ficam de fora os cérebros de teste (simulado, aleatorio); com --cerebro a,b, só esses;
     (2) em cada domínio × cérebro vale a rodada mais recente (no DevWise, com as passadas com e sem dialeto dela);
     (3) só entram os cérebros presentes em TODOS os domínios; o que sobra é avisado no topo do relatório. */
  const want = opts.cerebroExplicito ? (opts.cerebros || opts.cerebro).split(",") : null;
  let DD = D.filter(x => want ? want.includes(x.cerebro) : !/^(simulado|aleatorio)/.test(x.cerebro));
  const latest = {}; for (const x of DD) { const k = x.dom + "|" + x.cerebro; if (!latest[k] || x.t > latest[k].t) latest[k] = x; }
  DD = DD.filter(x => x.rodada === latest[x.dom + "|" + x.cerebro].rodada);
  const allDoms = [...new Set(D.map(x => x.dom))], perBrain = {}; for (const x of DD) (perBrain[x.cerebro] = perBrain[x.cerebro] || new Set()).add(x.dom);
  const domsWith = [...new Set(DD.map(x => x.dom))], common = Object.keys(perBrain).filter(b => perBrain[b].size === domsWith.length && domsWith.length >= 2);
  const aviso = [];
  for (const n of allDoms) if (!domsWith.includes(n)) aviso.push(`**${n}** ficou de fora: só tem ${[...new Set(D.filter(x => x.dom === n).map(x => x.cerebro))].join(", ")}.`);
  for (const b of Object.keys(perBrain)) if (!common.includes(b)) aviso.push(`\`${b}\` ficou de fora: só rodou em ${[...perBrain[b]].join(", ")}.`);
  if (!common.length) throw new Error("Nenhum cérebro rodou em 2+ domínios.\n" + aviso.join("\n").replace(/\*\*|`/g, "") + "\nRode o mesmo cérebro em todos os domínios, ou escolha com --cerebro <spec>.");
  D.length = 0; D.push(...DD.filter(x => common.includes(x.cerebro)));
  const names = [...new Set(D.map(x => x.dom))], brains = [...new Set(D.map(x => x.cerebro))];
  const U = (dom, b) => D.filter(x => x.dom === dom && (!b || x.cerebro === b)).flatMap(x => x.units);
  let r = `# Comparação entre domínios\n\nDomínios: ${names.join(", ")} · cérebros (os mesmos em todos): ${brains.join(", ")}.\n\n` +
    "| Domínio | Rodada | Papel |\n|---|---|---|\n" + names.map(n => { const z = D.filter(x => x.dom === n); return `| ${n} | ${[...new Set(z.map(x => x.rodada))].join(", ")} | ${[...new Set(z.map(x => x.papel))].join(", ")} |`; }).join("\n") + "\n\n" +
    (aviso.length ? "> " + aviso.join("\n> ") + "\n\n" : "") + `O código de KT é o mesmo em todos (kt-canonico.js = DevWise/src/models.js). Médias com IC 95% por bootstrap: de idiomas inteiros com 5+ idiomas; de alunos dentro de cada idioma com menos (com 2 idiomas, sortear idiomas é degenerado).\n\n`;
  r += "## Vazamento por domínio\n\n| Domínio | C0 (sem notas) | C1 (com notas) | Habilidades planas | com degrau | intermediárias |\n|---|---|---|---|---|---|\n";
  for (const n of names) { const z = D.filter(x => x.dom === n && x.resumo); if (!z.length) { r += `| ${n} | - | - | - | - | - |\n`; continue; }
    const g = k => z.reduce((s, x) => s + (x.resumo.regimes[k] || 0), 0); r += `| ${n} | ${f2(mean(z.map(x => x.resumo.c0)))} | ${f2(mean(z.map(x => x.resumo.c1)))} | ${g("plano")} | ${g("degrau")} | ${g("intermediario")} |\n`; }
  const metric = [["excess_all", "Viés de ganho (todas as habilidades: ganho previsto − verdadeiro)"], ["excess_plano", "Alarme falso (habilidades planas: nada a aprender)"], ["excess_degrau", "Excesso no degrau (ganho previsto − verdadeiro)"], ["brier_all", "Brier contra a verdade medida"], ["auc", "AUC contra a resposta"], ["c3drop", "Queda de AUC sob embaralhamento (C3)"]];
  for (const [key, nome] of metric) {
    r += `\n## ${nome}\n\n| Domínio | ` + MODELS.map(m => m.toUpperCase()).join(" | ") + " |\n|---|" + MODELS.map(() => "---").join("|") + "|\n";
    for (const n of names) r += `| ${n} | ` + MODELS.map(m => fci(ciLang(U(n), m + "_" + key))).join(" | ") + " |\n";
    const rk = names.map(n => { const v = MODELS.map(m => mean(U(n).map(u => u[m + "_" + key]).filter(x => x != null && !isNaN(x)))); return v.some(x => x == null || isNaN(x)) ? null : { n, rk: rankOf(v) }; }).filter(Boolean);
    if (rk.length >= 2) { const k = kendallW(rk.map(x => x.rk), rnd);
      r += `\nPostos por domínio (1 = menor valor): ` + rk.map(x => x.n + " " + MODELS.map((m, i) => m.toUpperCase() + "=" + x.rk[i]).join(" ")).join(" · ") + `\n\n**W de Kendall entre domínios = ${k.W.toFixed(2)}** (p = ${k.p.toFixed(4)}, ${rk.length} domínios): perto de 1, a ordem dos modelos não depende da área de conhecimento.\n`; }
  }
  /* sinal do fantasma: o achado do DevWise (AFM e PFA inventam aprendizagem) se repete em cada domínio? */
  r += "\n## O achado do DevWise se repete? (aprendizagem fantasma)\n\nPara cada domínio, o sinal do alarme falso de cada modelo: **+** se o IC inteiro está acima de zero (inventa ganho), **−** se abaixo (subestima), **0** se o IC contém zero.\n\n| Domínio | " + MODELS.map(m => m.toUpperCase()).join(" | ") + " |\n|---|" + MODELS.map(() => "---").join("|") + "|\n";
  const sgn = (n, k) => MODELS.map(m => { const c = ciLang(U(n), m + "_" + k); return !c || isNaN(c.lo) ? "-" : c.lo > 0 ? "+" : c.hi < 0 ? "−" : "0"; }).join(" | ");
  for (const n of names) r += `| ${n} | ` + sgn(n, "excess_plano") + " |\n";
  r += "\nO mesmo sinal no **degrau** (+ = exagera a aprendizagem que existe; − = não a enxerga por inteiro):\n\n| Domínio | " + MODELS.map(m => m.toUpperCase()).join(" | ") + " |\n|---|" + MODELS.map(() => "---").join("|") + "|\n";
  for (const n of names) r += `| ${n} | ` + sgn(n, "excess_degrau") + " |\n";
  /* parâmetros do jogo × ajustados: o fantasma é de calibração ou de especificação? */
  const comAj = names.filter(n => U(n).some(u => u.aj));
  if (comAj.length) {
    r += "\n## Parâmetros do jogo × ajustados (validação cruzada por aluno)\n\nMesmo prior correto nas três variantes; muda só o parâmetro de aprendizagem: o do jogo, um único estimado nos outros alunos, ou um por habilidade (ridge para o único). Detalhes em AJUSTE.md de cada rodada.\n";
    for (const [k, nome] of [["excess_plano", "Alarme falso"], ["excess_degrau", "Excesso no degrau"], ["logloss", "Log-loss fora da amostra"]]) {
      r += `\n### ${nome}\n\n| Domínio | Variante | ` + AJ.modelos.map(m => m.toUpperCase()).join(" | ") + " |\n|---|---|" + AJ.modelos.map(() => "---").join("|") + "|\n";
      for (const n of comAj) for (const v of AJ.variantes) r += `| ${n} | ${AJNOME[v]} | ` + AJ.modelos.map(m => fci(ciLang(U(n).filter(u => u.aj), `${m}_${v}_${k}`))).join(" | ") + " |\n"; }
    r += "\n### Diagnóstico do alarme falso\n\n**calibração**: some ao estimar a taxa única · **especificação**: persiste com a taxa única e some com a taxa por habilidade · **persiste**: continua mesmo por habilidade · **sem fantasma**: já não havia com os parâmetros do jogo.\n\n| Domínio | " + AJ.modelos.map(m => m.toUpperCase()).join(" | ") + " |\n|---|" + AJ.modelos.map(() => "---").join("|") + "|\n";
    const pos = (n, m, v) => { const c = ciLang(U(n).filter(u => u.aj), `${m}_${v}_excess_plano`); return c && !isNaN(c.lo) ? c.lo > 0 : null; };
    for (const n of comAj) r += `| ${n} | ` + AJ.modelos.map(m => { const a = pos(n, m, "jogo"), b = pos(n, m, "global"), c = pos(n, m, "hab");
      return a == null ? "-" : !a ? "sem fantasma" : !b ? "calibração" : !c ? "especificação" : "persiste"; }).join(" | ") + " |\n";
    const sem = names.filter(n => !comAj.includes(n)); if (sem.length) r += `\nSem ajuste (rode \`ajustar\` no repositório): ${sem.join(", ")}.\n`;
  }
  r += "\n## Vazamento × viés (descritivo)\n\n| Modelo | ρ de Spearman entre C0 do domínio e alarme falso |\n|---|---|\n";
  const withR = names.filter(n => D.some(x => x.dom === n && x.resumo));
  if (withR.length >= 4) for (const m of MODELS) { const c0 = withR.map(n => mean(D.filter(x => x.dom === n && x.resumo).map(x => x.resumo.c0))), ex = withR.map(n => mean(U(n).map(u => u[m + "_excess_plano"]).filter(x => x != null)));
      if (ex.some(x => x == null)) continue; const a = rankOf(c0), b = rankOf(ex), ma = mean(a), mb = mean(b); let nu = 0, da = 0, db = 0; a.forEach((x, i) => { nu += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
      r += `| ${m.toUpperCase()} | ${da && db ? (nu / Math.sqrt(da * db)).toFixed(2) : "-"} (n = ${withR.length} domínios; sem teste) |\n`; }
  else r += "| - | são precisos 4+ domínios com resumo de vazamento |\n";
  if (/\|---\|---\|\n$/.test(r)) r += "| - | sem habilidades planas suficientes nos domínios |\n";
  r += "\n## Como ler\n\n- Um domínio de papel **controle** (ex.: ENEM) entra para medir alarme falso: nele não se espera degrau.\n- O DevWise é o único domínio com degrau **construído** (dialeto cifrado); nos outros o degrau é o que as notas da própria ferramenta ensinam ao cérebro, e o regime de cada habilidade é medido.\n- Com um único cérebro, diferenças entre domínios misturam domínio e o par cérebro × domínio; com 2+ cérebros, a consolidação por domínio mostra se a ordem se mantém.\n";
  const out = path.resolve(opts.saida || path.join(ROOT, "agentes", "saida", "COMPARACAO-DOMINIOS.md")); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r); console.log(r); console.log("Gravado em " + out);
}

/* ---------------- KT AJUSTADO: parâmetros do jogo × estimados nos dados (validação cruzada por aluno) ----------------
   Pergunta da verificação de 08/10: a aprendizagem fantasma de AFM/PFA/BKT vem dos PARÂMETROS a priori do jogo (calibração)
   ou da FORMA do modelo (especificação)? Três variantes, todas com o mesmo prior correto (C0 medido por idioma × habilidade,
   como em unitMetrics), para isolar o parâmetro de aprendizagem:
     jogo   os parâmetros de kt-canonico.js (Elo K0 1,8 · BKT T 0,2 / slip 0,1 · PFA γ 0,75 / ρ −0,15 · AFM γ 0,45)
     global parâmetros de aprendizagem ÚNICOS para todas as habilidades, estimados por máxima verossimilhança nas respostas
            dos OUTROS alunos (deixa-um-aluno-de-fora) e aplicados ao aluno deixado de fora
     hab    um parâmetro de aprendizagem POR HABILIDADE, com encolhimento (ridge, λ = 2) para o global
   Hipótese do transbordamento: com taxa única, as habilidades com degrau puxam a taxa para cima e ela "vaza" para as
   planas; se for isso, o alarme falso some (ou cai muito) em "hab" e persiste em "global".
   Ajuste nas respostas observadas (y), avaliação contra a verdade medida (p_true) e contra y (log-loss e AUC fora da amostra).
   A TRI fica de fora: é estática por construção (não tem parâmetro de aprendizagem). Nada aqui chama LLM. */
const AJ = { ridge: 2, jogo: { elo: { K: 1.8 }, bkt: { T: 0.2, S: 0.1 }, pfa: { g: 0.75, r: -0.15 }, afm: { g: 0.45 } }, modelos: ["elo", "bkt", "pfa", "afm"], variantes: ["jogo", "global", "hab"] };
const lgt = p => Math.log(p / (1 - p)), sgm = x => 1 / (1 + Math.exp(-x)), clp = (x, a, b) => Math.max(a, Math.min(b, x));
/* sequências (aluno × habilidade) da partida fixa, com as covariáveis de cada modelo */
function ajSeqs(E, med, fixed) {
  const R = regimes(med), seqs = [];
  for (const st of [...new Set(fixed.map(g => g.student))]) {
    const F = fixed.filter(g => g.student === st && g.p_true !== ""), lang = F[0] ? F[0].lang : st.split("-")[0];
    for (const sk of [...new Set(F.map(g => g.skill))]) {
      const rows = F.filter(g => g.skill === sk), rg = R[lang + "|" + sk], L0 = Math.min(.95, Math.max(.05, rg ? rg.c0 : L0_JOGO));
      let s = 0, f = 0; const obs = rows.map((g, i) => { const it = E.byId[g.item], c = it && it.c != null ? it.c : 0.25;
        const o = { y: +g.y, pt: +g.p_true, after: +g.kc_index > PASSO(), n: i, s, f, c, b: KT.itemB({ id: g.item, d: +g.d || 2 }), area: g.area }; if (+g.y) s++; else f++; return o; });
      seqs.push({ student: st, lang, skill: sk, L0, a: lgt(L0), regime: rg ? rg.regime : "intermediario", obs });
    }
  }
  return seqs;
}
/* previsão de cada modelo numa sequência, com parâmetros dados (p é a probabilidade ANTES da resposta) */
const AJP = {
  afm: (q, P) => q.obs.map(o => sgm(q.a + P.g * o.n)),
  pfa: (q, P) => q.obs.map(o => sgm(q.a + P.g * o.s + P.r * o.f)),
  bkt: (q, P) => { let L = q.L0; return q.obs.map(o => { const p = L * (1 - P.S) + (1 - L) * o.c, post = o.y ? L * (1 - P.S) / Math.max(1e-9, L * (1 - P.S) + (1 - L) * o.c) : L * P.S / Math.max(1e-9, L * P.S + (1 - L) * (1 - o.c)); L = Math.min(.995, post + (1 - post) * P.T); return p; }); },
  elo: (q, P) => { let th = lgt(clp(q.L0, .02, .98)); return q.obs.map((o, n) => { const p = o.c + (1 - o.c) * sgm(th - o.b); th = clp(th + P.K / (1 + 0.06 * n) * (o.y - p) * (o.y ? 1 : 0.7), -4, 5); return p; }); }
};
const ajLL = (qs, m, P) => { let s = 0; for (const q of qs) { const p = AJP[m](q, P); q.obs.forEach((o, i) => { const v = clp(p[i], 1e-4, 1 - 1e-4); s += o.y ? Math.log(v) : Math.log(1 - v); }); } return s; };
/* AFM e PFA: logística com offset conhecido (o prior), côncava: Newton com ridge para o centro dado */
function ajNewton(qs, feats, x0, centro, lam) {
  let x = x0.slice();
  for (let it = 0; it < 50; it++) { const g = x.map((v, j) => -lam * (v - centro[j])), H = x.map((_, j) => x.map((__, k) => j === k ? -lam : 0));
    for (const q of qs) for (const o of q.obs) { const z = feats(o), p = sgm(q.a + z.reduce((s, v, j) => s + v * x[j], 0)), w = p * (1 - p);
      z.forEach((v, j) => { g[j] += (o.y - p) * v; z.forEach((u, k) => H[j][k] -= w * v * u); }); }
    let d; if (x.length === 1) d = [-g[0] / Math.min(H[0][0], -1e-6)];
    else { const det = H[0][0] * H[1][1] - H[0][1] * H[1][0] || -1e-6; d = [-(H[1][1] * g[0] - H[0][1] * g[1]) / det, -(-H[1][0] * g[0] + H[0][0] * g[1]) / det]; }
    d = d.map(v => clp(v, -1, 1)); x = x.map((v, j) => clp(v + d[j], -5, 5)); if (Math.max(...d.map(Math.abs)) < 1e-6) break; }
  return x;
}
const AJGRADE = { T: Array.from({ length: 31 }, (_, i) => i * 0.02), S: Array.from({ length: 16 }, (_, i) => i * 0.02), K: Array.from({ length: 41 }, (_, i) => i * 0.1) };
/* estima os parâmetros de um modelo nas sequências de treino: { global, hab: {habilidade: params} } */
function ajFit(qs, m) {
  const lam = AJ.ridge, bySk = {}; qs.forEach(q => (bySk[q.skill] = bySk[q.skill] || []).push(q));
  if (m === "afm" || m === "pfa") {
    const feats = m === "afm" ? (o => [o.n]) : (o => [o.s, o.f]), x0 = m === "afm" ? [AJ.jogo.afm.g] : [AJ.jogo.pfa.g, AJ.jogo.pfa.r];
    const G = ajNewton(qs, feats, x0, x0.map(() => 0), 1e-3), P = x => m === "afm" ? { g: x[0] } : { g: x[0], r: x[1] };
    const hab = {}; for (const k in bySk) hab[k] = P(ajNewton(bySk[k], feats, G, G, lam));
    return { global: P(G), hab };
  }
  if (m === "bkt") {
    let best = null; for (const T of AJGRADE.T) for (const S of AJGRADE.S) { const v = ajLL(qs, "bkt", { T, S }); if (!best || v > best.v) best = { v, T, S }; }
    const lT = t => lgt(clp(t, .005, .995)), hab = {};
    for (const k in bySk) { let b = null; for (const T of AJGRADE.T) { const v = ajLL(bySk[k], "bkt", { T, S: best.S }) - lam / 2 * (lT(T) - lT(best.T)) ** 2; if (!b || v > b.v) b = { v, T }; } hab[k] = { T: b.T, S: best.S }; }
    return { global: { T: best.T, S: best.S }, hab };
  }
  let best = null; for (const K of AJGRADE.K) { const v = ajLL(qs, "elo", { K }); if (!best || v > best.v) best = { v, K }; }
  const hab = {}; for (const k in bySk) { let b = null; for (const K of AJGRADE.K) { const v = ajLL(bySk[k], "elo", { K }) - lam / 2 * (K - best.K) ** 2; if (!b || v > b.v) b = { v, K }; } hab[k] = { K: b.K }; }
  return { global: { K: best.K }, hab };
}
/* métricas de uma unidade (aluno deixado de fora): mesmas definições de unitMetrics */
function ajUnit(qs, preds) {
  const u = {};
  for (const m of AJ.modelos) for (const v of AJ.variantes) {
    const P = []; qs.forEach(q => { const p = preds[m][v].get(q); q.obs.forEach((o, i) => P.push({ o, p: p[i], regime: q.regime })); });
    const blk = (Q, tag) => { if (Q.length < 6 || !Q.some(x => x.o.after) || !Q.some(x => !x.o.after)) return;
      const dT = mean(Q.filter(x => x.o.after).map(x => x.o.pt)) - mean(Q.filter(x => !x.o.after).map(x => x.o.pt)), dP = mean(Q.filter(x => x.o.after).map(x => x.p)) - mean(Q.filter(x => !x.o.after).map(x => x.p));
      u[`${m}_${v}_excess_${tag}`] = dP - dT; };
    blk(P, "all"); blk(P.filter(x => x.regime === "plano"), "plano"); blk(P.filter(x => x.regime === "degrau"), "degrau");
    u[`${m}_${v}_brier_all`] = mean(P.map(x => (x.p - x.o.pt) ** 2));
    u[`${m}_${v}_logloss`] = -mean(P.map(x => { const p = clp(x.p, 1e-4, 1 - 1e-4); return x.o.y ? Math.log(p) : Math.log(1 - p); }));
    u[`${m}_${v}_auc`] = auc(P.map(x => x.p), P.map(x => x.o.y));
  }
  return u;
}
function ajustarPasta(E, dir) {
  const fm = path.join(dir, "medicao.csv"), ff = path.join(dir, "jogo-fixo.csv"), fj = path.join(dir, "metricas.json");
  if (!fs.existsSync(fm) || !fs.existsSync(ff) || !fs.existsSync(fj)) return null;
  const J = JSON.parse(fs.readFileSync(fj, "utf8")), med = readCsv(fm).map(x => ({ ...x, c0: +x.c0, c1: +x.c1 })), fixed = readCsv(ff);
  const seqs = ajSeqs(E, med, fixed), alunos = [...new Set(seqs.map(q => q.student))];
  if (alunos.length < 2) return null;
  const preds = {}; for (const m of AJ.modelos) { preds[m] = {}; for (const v of AJ.variantes) preds[m][v] = new Map(); }
  for (const al of alunos) {   /* deixa-um-aluno-de-fora */
    const tr = seqs.filter(q => q.student !== al), te = seqs.filter(q => q.student === al);
    for (const m of AJ.modelos) { const F = ajFit(tr, m);
      for (const q of te) { preds[m].jogo.set(q, AJP[m](q, AJ.jogo[m])); preds[m].global.set(q, AJP[m](q, F.global)); preds[m].hab.set(q, AJP[m](q, F.hab[q.skill] || F.global)); } }
  }
  const units = alunos.map(al => ({ student: al, lang: al.split("-")[0], ...ajUnit(seqs.filter(q => q.student === al), preds) }));
  /* parâmetros com TODOS os alunos (descritivo): a taxa por habilidade separa planas de degraus? */
  const params = {}, porRegime = {};
  for (const m of AJ.modelos) { const F = ajFit(seqs, m); params[m] = F; const key = m === "bkt" ? "T" : m === "elo" ? "K" : "g";
    porRegime[m] = {}; for (const rg of ["plano", "intermediario", "degrau"]) { const sk = [...new Set(seqs.filter(q => q.regime === rg).map(q => q.skill))]; porRegime[m][rg] = sk.length ? { n: sk.length, media: mean(sk.map(s => F.hab[s][key])) } : null; } }
  const out = { dominio: J.dominio, dominioPt: J.dominioPt, cerebro: J.cerebro, papel: J.papel, rodada: J.rodada, nucleo: NUCLEO_VERSAO, ridge: AJ.ridge, jogo: AJ.jogo, params, porRegime, units };
  fs.writeFileSync(path.join(dir, "ajuste.json"), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, "AJUSTE.md"), ajReport(out));
  return out;
}
const AJNOME = { jogo: "jogo", global: "ajustado (taxa única)", hab: "ajustado (por habilidade)" };
function ajReport(o) {
  const U = o.units, pk = { elo: "K", bkt: "T", pfa: "g", afm: "g" };
  let r = `# KT ajustado · ${o.dominioPt || o.dominio} · ${o.cerebro} · rodada ${o.rodada}\n\nPrior correto em todas as variantes; parâmetros de aprendizagem do jogo × estimados nos outros alunos (deixa-um-aluno-de-fora, ${U.length} alunos). Ridge λ = ${o.ridge} para o global na variante por habilidade. IC 95% por bootstrap como no resto do laboratório.\n\n`;
  for (const [k, nome] of [["excess_plano", "Alarme falso (habilidades planas)"], ["excess_degrau", "Excesso no degrau"], ["excess_all", "Viés de ganho (todas)"], ["brier_all", "Brier contra a verdade medida"], ["logloss", "Log-loss fora da amostra (respostas)"], ["auc", "AUC fora da amostra"]]) {
    r += `## ${nome}\n\n| Variante | ` + AJ.modelos.map(m => m.toUpperCase()).join(" | ") + " |\n|---|" + AJ.modelos.map(() => "---").join("|") + "|\n";
    for (const v of AJ.variantes) r += `| ${AJNOME[v]} | ` + AJ.modelos.map(m => fci(ciLang(U, `${m}_${v}_${k}`))).join(" | ") + " |\n";
    r += "\n"; }
  r += "## Parâmetro de aprendizagem estimado (todos os alunos)\n\n| Modelo | Parâmetro | Jogo | Ajustado (único) | Por habilidade: planas | intermediárias | com degrau |\n|---|---|---|---|---|---|---|\n";
  for (const m of AJ.modelos) { const p = pk[m], j = m === "elo" ? o.jogo.elo.K : m === "bkt" ? o.jogo.bkt.T : o.jogo[m].g, g = o.params[m].global[p], pr = o.porRegime[m];
    const cel = x => x ? `${f2(x.media)} (${x.n})` : "-";
    r += `| ${m.toUpperCase()} | ${m === "elo" ? "K0" : m === "bkt" ? "T" : (m === "pfa" ? "γ sucesso (ρ falha único: " + f2(o.params.pfa.global.r) + ")" : "γ oportunidade")} | ${f2(j)} | ${f2(g)} | ${cel(pr.plano)} | ${cel(pr.intermediario)} | ${cel(pr.degrau)} |\n`; }
  r += `\nComo ler: se o alarme falso cai de "jogo" para "ajustado (taxa única)", o fantasma era de calibração; se só cai em "por habilidade", era de especificação (a taxa única transborda das habilidades com degrau para as planas). Na última tabela, a taxa por habilidade das planas perto de zero e a das com degrau alta confirmam o transbordamento.\n`;
  return r;
}
function ajustar(opts) {
  const E = env(opts), base = path.join(ROOT, "agentes", "saida");
  const rodadas = opts.rodadaExplicita ? [opts.rodada] : (fs.existsSync(base) ? fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory()) : []);
  let n = 0;
  for (const rd of rodadas) for (const { d } of loadRuns(path.join(base, rd))) {
    const dir = path.join(base, rd, d), fa = path.join(dir, "ajuste.json");
    if (opts.cerebroExplicito && brainSlug(opts.cerebro) !== d) continue;
    if (!opts.refazer && fs.existsSync(fa) && JSON.parse(fs.readFileSync(fa, "utf8")).nucleo === NUCLEO_VERSAO && fs.statSync(fa).mtimeMs >= fs.statSync(path.join(dir, "metricas.json")).mtimeMs) { console.log("  " + rd + "/" + d + ": já ajustado"); continue; }
    const t = Date.now(), o = ajustarPasta(E, dir);
    if (o) { n++; const pl = m => fci(ciLang(o.units, m)); console.log(`  ${rd}/${d}: alarme falso AFM jogo ${pl("afm_jogo_excess_plano")} · único ${pl("afm_global_excess_plano")} · por habilidade ${pl("afm_hab_excess_plano")} (${((Date.now() - t) / 1000).toFixed(0)} s)`); }
  }
  console.log(n ? `Ajuste gravado em ${n} pasta(s) (ajuste.json e AJUSTE.md ao lado de metricas.json).` : "Nada novo a ajustar.");
}

/* ---------------- linha de comando ---------------- */
const argv = process.argv.slice(2), cmd = argv[0]; { const i = argv.indexOf("--paralelo"); if (i >= 0) process.env.LAB_PARALELO = argv[i + 1]; }
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const opts = { cerebro: arg("cerebro", "ollama:qwen3:8b"), idiomas: arg("idiomas") ? arg("idiomas").split(",") : null, minutos: +arg("minutos", 0), reps: +arg("repeticoes", 2),
  habilidades: arg("habilidades", null), itens: arg("itens") ? +arg("itens") : null, partida: arg("partida", "ambas"), alunos: +arg("alunos", 1), tickets: +arg("tickets", 60), porhab: +arg("porhab", 10),
  tutor: +arg("tutor", 4), semente: arg("semente", "studx"), rodada: arg("rodada", new Date().toISOString().slice(0, 10)), pastas: arg("pastas", null), saida: arg("saida", null), dificuldade: arg("dificuldade", "autoral"), turnos: +arg("turnos", 6), figuras: arg("figuras", "nao"), papel: arg("papel", "estudo"), idioma: arg("idioma", null), cerebros: arg("cerebros", null), cerebroExplicito: argv.includes("--cerebro") || argv.includes("--cerebros"), rodadaExplicita: argv.includes("--rodada"), refazer: argv.includes("--refazer") };
const run = async () => {
  if (cmd === "piloto") { for (const c of (arg("cerebros") || opts.cerebro).split(",")) await pilot({ ...opts, cerebro: c }); }
  else if (cmd === "triagem") await triage(opts);
  else if (cmd === "calibrar") await calibrate(opts);
  else if (cmd === "consolidar") consolidate(opts);
  else if (cmd === "comparar") compare(opts);
  else if (cmd === "ajustar") ajustar(opts);
  else if (cmd === "info") info(opts);
  else if (cmd === "traduzir") await translate(opts);
  else console.log("Uso: node tools/agentes/laboratorio.js info|traduzir|calibrar|triagem|piloto|consolidar|comparar|ajustar [--cerebro ollama:qwen3:8b] (veja tools/agentes/LEIA-ME.md)");
};
if (require.main === module) run().catch(e => { console.error("\nERRO: " + e.message); process.exit(1); });
module.exports = { makeRng, regimes, unitMetrics, KT, LAB, TRAD };
