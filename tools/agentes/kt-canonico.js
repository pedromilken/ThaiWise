/* KT canônico do laboratório multidomínio: cópia literal de DevWise/src/models.js (commit a2bebf3), com ITEM_B exposto e exportação para Node.
   É o MESMO código nos cinco domínios: diferenças entre domínios não podem vir de implementações divergentes. Não editar aqui; regenerar a partir do DevWise. */
/* DevWise - modelos de rastreamento do conhecimento.

   Um modelo PILOTA o jogo (calcula o domínio exibido, libera fases, escolhe a dificuldade do próximo ticket). Os demais rodam como
   SOMBRAS: antes de cada resposta registram no log a probabilidade de acerto que previam, e atualizam o próprio estado, sem interferir.
   A seleção segue as ferramentas do estudo de confundidores com o ENEM que podem rodar no navegador sem treino prévio:
     elo  Elo/Rasch online com dificuldade de item e chute (estrutura do lado do item; piloto padrão)
     irt  TRI de 3 parâmetros com habilidade por EAP numa grade de 81 pontos, só com as respostas anteriores (o "teto" psicométrico)
     bkt  Bayesian Knowledge Tracing (Corbett e Anderson)
     pfa  Performance Factors Analysis (sucessos e falhas anteriores)
     afm  Additive Factor Model (contagem de oportunidades)
   As arquiteturas profundas do estudo (DKT, DKVMN, SAKT, AKT, SAINT, SimpleKT) exigem treino em muitos alunos: o log exportado tem o
   formato necessário para treiná-las fora do jogo.

   TODOS os parâmetros abaixo são a priori de projeto, não estimativas. A recomendação do próprio estudo vale aqui: recalibrar os itens
   na população real, a partir dos logs exportados, e republicar as dificuldades em ITEM_B. */
const KT = (() => {
  const sig = x => 1 / (1 + Math.exp(-x)), logit = p => Math.log(p / (1 - p)), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const B_SCALE = 1.2;                                   // dificuldade autoral 1, 2, 3 vira b = -1,2, 0, +1,2 logits
  const ITEM_B = {};                                     // recalibração empírica por item (id -> b), quando houver dados
  const itemB = it => ITEM_B[it.id] != null ? ITEM_B[it.id] : (it.d - 2) * B_SCALE;
  const GRID = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);

  const MODELS = {
    /* K0 e DEC calibrados por simulação (iniciante domina uma habilidade em ~10 tickets). WRONG < 1 amortece a queda após um erro isolado
       (tolerância a deslize, como o 'slip' do BKT): sem isso um único erro num item fácil apagava dois acertos. Custo assumido: leve viés para cima. */
    elo: { master: 0.85, K0: 1.8, DEC: 0.06, WRONG: 0.7,
      init: L => ({ th: logit(clamp(L, .02, .98)), n: 0 }),
      predict: (m, it, c) => c + (1 - c) * sig(m.th - itemB(it)),
      update(m, it, c, y) { const p = this.predict(m, it, c); m.th = clamp(m.th + this.K0 / (1 + this.DEC * m.n) * (y - p) * (y ? 1 : this.WRONG), -4, 5); m.n++; },
      mastery: m => sig(m.th) },
    irt: { master: 0.85, shadowOnly: true,   // referência psicométrica ESTÁTICA (o "teto" do estudo): não acompanha quem está aprendendo, então nunca pilota
      /* Posterior EAP acumulada em log numa grade de 81 pontos: cada resposta soma log P(resposta | θ) em cada ponto.
         Mesmo resultado de refazer o produto sobre todo o histórico, mas a custo constante por resposta e com estado de tamanho fixo. */
      init: L => { const mu = logit(clamp(L, .02, .98)); return { mu, n: 0, lp: GRID.map(t => -0.5 * Math.pow((t - mu) / 1.2, 2)) }; },
      lpOf(m) { if (!m.lp) { m.lp = GRID.map(t => -0.5 * Math.pow((t - m.mu) / 1.2, 2)); for (const [b, c, y] of (m.r || [])) GRID.forEach((t, i) => { const p = c + (1 - c) * sig(t - b); m.lp[i] += Math.log(y ? p : 1 - p); }); m.n = (m.r || []).length; delete m.r; } return m.lp; },
      post(m) { const lp = this.lpOf(m), mx = Math.max(...lp), w = lp.map(x => Math.exp(x - mx)), s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); },
      predict(m, it, c) { const w = this.post(m), b = itemB(it); return w.reduce((a, x, i) => a + x * (c + (1 - c) * sig(GRID[i] - b)), 0); },
      update(m, it, c, y) { const lp = this.lpOf(m), b = itemB(it); GRID.forEach((t, i) => { const p = c + (1 - c) * sig(t - b); lp[i] += Math.log(y ? p : 1 - p); }); m.n++; },
      mastery(m) { const w = this.post(m); return sig(w.reduce((a, x, i) => a + x * GRID[i], 0)); } },
    bkt: { master: 0.95, T: 0.2, SLIP: 0.1,
      init: L => ({ L }),
      predict(m, it, c) { return m.L * (1 - this.SLIP) + (1 - m.L) * c; },
      update(m, it, c, y) { const s = this.SLIP, L = m.L, post = y ? L * (1 - s) / (L * (1 - s) + (1 - L) * c) : L * s / (L * s + (1 - L) * (1 - c)); m.L = Math.min(.995, post + (1 - post) * this.T); },
      mastery: m => m.L },
    pfa: { master: 0.85, BETA: -1.4, GAMMA: 0.75, RHO: -0.15,
      init: L => ({ s: 0, f: 0, b0: logit(clamp(L, .02, .98)) - (-1.4) - 0.34 }),
      lin(m) { return this.BETA + m.b0 + 0.34 + this.GAMMA * m.s + this.RHO * m.f; },
      predict(m) { return sig(this.lin(m)); },
      update(m, it, c, y) { if (y) m.s++; else m.f++; },
      mastery(m) { return sig(this.lin(m)); } },
    afm: { master: 0.85, BETA: -1.4, GAMMA: 0.45,
      init: L => ({ n: 0, b0: logit(clamp(L, .02, .98)) - (-1.4) - 0.34 }),
      lin(m) { return this.BETA + m.b0 + 0.34 + this.GAMMA * m.n; },
      predict(m) { return sig(this.lin(m)); },
      update(m) { m.n++; },
      mastery(m) { return sig(this.lin(m)); } }
  };
  const IDS = Object.keys(MODELS);
  return {
    IDS, MODELS, itemB, ITEM_B, PILOTS: IDS.filter(k => !MODELS[k].shadowOnly),
    ensure(tr) { if (!tr.m) tr.m = {}; for (const k of IDS) if (!tr.m[k]) tr.m[k] = MODELS[k].init(tr.L); return tr; },
    predictAll(tr, it, c) { this.ensure(tr); const o = {}; for (const k of IDS) o[k] = +clamp(MODELS[k].predict(tr.m[k], it, c), .001, .999).toFixed(4); return o; },
    updateAll(tr, it, c, y) { this.ensure(tr); for (const k of IDS) MODELS[k].update(tr.m[k], it, c, y); },
    mastery(tr, pilot) { this.ensure(tr); return clamp(MODELS[pilot].mastery(tr.m[pilot]), .001, .999); },
    master: pilot => MODELS[pilot].master,
    /* Replay: reconstrói os cinco modelos do zero, a partir do mesmo prior neutro, reprocessando o registro na ordem.
       Devolve, para cada linha, a previsão que cada modelo teria feito ANTES daquela resposta. Serve à pesquisa:
       independe do piloto, cobre linhas antigas sem previsão gravada e é reprodutível a partir do registro. */
    replay(rows, L0) {
      const st = {};
      return rows.map(r => {
        const k = r.key; if (!st[k]) st[k] = this.ensure({ L: L0 });
        const p = this.predictAll(st[k], r.item, r.c); this.updateAll(st[k], r.item, r.c, r.y); return p; });
    },
    /* métricas de previsão sobre um log: Brier, AUC (Mann-Whitney) e acurácia a 0,5 */
    score(log, k) { const rows = log.filter(l => l.preds && l.preds[k] != null); if (!rows.length) return null;
      const brier = rows.reduce((a, l) => a + Math.pow(l.preds[k] - (l.ok ? 1 : 0), 2), 0) / rows.length, acc = rows.filter(l => (l.preds[k] >= .5) === !!l.ok).length / rows.length;
      const pos = rows.filter(l => l.ok).map(l => l.preds[k]), neg = rows.filter(l => !l.ok).map(l => l.preds[k]); let auc = null;
      if (pos.length && neg.length) { let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? .5 : 0; auc = w / (pos.length * neg.length); }
      return { n: rows.length, brier, auc, acc }; }
  };
})();
if (typeof module !== "undefined") module.exports = KT;
