/* ThaiWise - camada de jogo: economia de XP, modos de dificuldade, loja e patentes. Mesma economia do DevWise/IAWise. */

/* Modos. mult: multiplicador de XP; pen: XP perdido por erro (x dificuldade do item); hint: lente liberada? */
const MODES = {
  normal:   { mult: 1,   pen: 2,  hint: true },
  medio:    { mult: 1.5, pen: 4,  hint: true },
  dificil:  { mult: 2,   pen: 6,  hint: false },
  hardcore: { mult: 3,   pen: 10, hint: false }
};
const MODE_ICON = { normal: "🌱", medio: "⚙️", dificil: "🔥", hardcore: "💀" };
const ITEM_XP = { 1: 10, 2: 20, 3: 35 };   // XP base por dificuldade do item
const COMEBACK = 5;                       // bônus por acertar logo depois de um erro

/* Loja. kind: "power" (consumível) | "title" (cosmético, compra única). */
const SHOP = [
  { id: "shield", icon: "🛡️", kind: "power", cost: 30 },
  { id: "boost",  icon: "⚡", kind: "power", cost: 40 },
  { id: "lens",   icon: "🔍", kind: "power", cost: 20 },
  { id: "key",    icon: "🗝️", kind: "power", cost: 60 },
  { id: "tKai",   icon: "ก", kind: "title", cost: 80 },
  { id: "tChang", icon: "ช", kind: "title", cost: 150 },
  { id: "tHuuk",  icon: "ฮ", kind: "title", cost: 300 }
];

/* Patentes por XP acumulado. */
const ROLE_XP = [0, 150, 400, 900, 1600, 2600];

const GAME = {
  gain(S, d, ok) {
    const M = MODES[S.mode] || MODES.normal;
    if (ok) {
      let x = Math.round(ITEM_XP[d] * M.mult);
      if (S.boost > 0) { x *= 2; S.boost--; }
      if (S.lastWrong) x += COMEBACK;
      return x;
    }
    if (S.inv.shield > 0) { S.inv.shield--; return 0; }
    return -M.pen * d;
  },
  role(xpTotal) { let r = 0; ROLE_XP.forEach((v, i) => { if (xpTotal >= v) r = i; }); return r; }
};
