#!/usr/bin/env python3
"""ThaiWise - gera src/data.js a partir de tools/fontes/.

Fonte única da pronúncia: Paiboon+ (sílabas separadas por hífen, palavras por espaço, tom no primeiro símbolo de vogal).
O RTGS (Royal Thai General System) é DERIVADO por regra: tira tons e duração, troca as letras das oclusivas e das vogais
abertas e junta as sílabas da palavra. Assim as duas romanizações nunca divergem.
"""
import json, re, unicodedata, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
F = ROOT / "tools" / "fontes"

# ---------------- romanização ----------------
TONE_MARK = {"\u0300": "L", "\u0302": "F", "\u0301": "H", "\u030C": "R"}   # grave baixo, circunflexo descendente, agudo alto, caron ascendente
VOW = "aeiouɛɔəʉ"

def tone_of(syl):
    for ch in unicodedata.normalize("NFD", syl):
        if ch in TONE_MARK: return TONE_MARK[ch]
    return "M"

def strip_tone(s):
    return unicodedata.normalize("NFC", "".join(c for c in unicodedata.normalize("NFD", s) if c not in TONE_MARK))

INI = [("bpr", "pr"), ("bpl", "pl"), ("dtr", "tr"), ("bp", "p"), ("dt", "t"), ("ng", "ng"), ("ch", "ch"),
       ("gr", "kr"), ("gl", "kl"), ("gw", "kw"), ("kr", "khr"), ("kl", "khl"), ("kw", "khw"),
       ("pr", "phr"), ("pl", "phl"), ("tr", "thr"), ("g", "k"), ("k", "kh"), ("p", "ph"), ("t", "th"), ("j", "ch")]

def rtgs_syl(s):
    s = strip_tone(s).lower()
    ini = ""
    for a, b in INI:
        if s.startswith(a):
            ini, s = b, s[len(a):]; break
    else:
        m = re.match(r"[bdfhlmnrswy]", s)
        if m: ini, s = s[0], s[1:]
    s = re.sub(r"([aeiouɛɔəʉ])\1", r"\1", s)          # duração some
    s = s.replace("ʉ", "ue").replace("ɛ", "ae").replace("ɔ", "o").replace("ə", "oe")
    return ini + s

def rtgs(p):
    """Paiboon+ -> RTGS. Palavras separadas por espaço; sílabas por hífen são juntadas."""
    out = []
    for w in p.split(" "):
        if not w: continue
        out.append("".join(rtgs_syl(x) for x in w.split("-") if x))
    return " ".join(out)

# ---------------- regra de tom ----------------
def tone_rule(cls, live, long, mark):
    """Classe efetiva (M/H/L), sílaba viva, vogal longa, marca 0-4 -> tom M/L/F/H/R."""
    if cls == "M": return [("M" if live else "L"), "L", "F", "H", "R"][mark]
    if cls == "H": return [("R" if live else "L"), "L", "F"][mark]
    if mark: return ["", "F", "H"][mark]
    return "M" if live else ("F" if long else "H")

def fsi_level(n):
    return min(6, (n - 1) // 10 + 1)

# ---------------- leitura ----------------
def read_vocab(path, lv):
    units, words, cur = [], [], None
    for ln in path.read_text(encoding="utf-8").splitlines():
        if not ln.strip() or (ln.startswith("#") and not ln.startswith("##")): continue
        if ln.startswith("##"):
            pt, en = [x.strip() for x in ln[2:].split("|")]
            cur = {"id": f"v{lv}u{len(units)+1:02d}", "lv": lv, "n": len(units) + 1, "pt": pt, "en": en, "w": []}
            units.append(cur); continue
        th, p, gpt, gen = ln.split("\t")
        words.append({"t": th, "p": p, "r": rtgs(p), "pt": gpt, "en": gen, "lv": lv, "u": cur["id"]})
        cur["w"].append(th)
    return units, words

def toks(s):
    out = []
    for x in s.split(" "):
        th, p = x.split("|")
        out.append([th, p, rtgs(p) if th != "___" and p else ""])
    return out

def read_grammar(path):
    g = json.loads(path.read_text(encoding="utf-8"))
    lv, pts, gaps, sents = g["lv"], [], [], []
    for P in g["pontos"]:
        pts.append({"id": P["id"], "t": P["t"], "e": P["e"], "ex": toks(P["ex"]), "pt": P["pt"], "en": P.get("en", ""), "lv": lv})
        for k, G in enumerate(P.get("gaps", [])):
            s = toks(G["s"].replace("___", "___|"))
            opts = [o.split("|") for o in G["o"]]
            gaps.append({"id": f"{P['id']}g{k+1}", "lv": lv, "pt_id": P["id"], "s": s, "h": G.get("h", ""),
                         "o": [[a, b, rtgs(b)] for a, b in opts], "a": G["a"], "x": G.get("x", "")})
        for k, O in enumerate(P.get("ord", [])):
            sents.append({"id": f"{P['id']}o{k+1}", "lv": lv, "pt_id": P["id"], "t": toks(O["s"]), "pt": O["pt"], "en": O.get("en", "")})
    return lv, pts, gaps, sents

def main():
    errs = []
    E = json.loads((F / "escrita.json").read_text(encoding="utf-8"))
    cons = [{"c": c[0], "cls": c[1], "ini": c[2], "fin": c[3], "nm": c[4], "nmp": c[5], "nmr": rtgs(c[5]), "nmpt": c[6], "obs": len(c) > 7}
            for c in E["consoantes"]]
    vow = [{"f": v[0], "ex": v[1], "p": v[2], "r": rtgs(v[2]), "v": v[3], "len": v[4]} for v in E["vogais"]]
    syl = []
    for s in E["silabas"]:
        th, p, cls, lead, live, long_, mark, u, pt = s
        t = tone_rule(cls, live, long_, mark)
        if t != tone_of(p): errs.append(f"tom: {th} {p} regra={t} paiboon={tone_of(p)}")
        syl.append({"t": th, "p": p, "r": rtgs(p), "cls": cls, "lead": lead, "live": live, "long": long_, "mark": mark, "u": u, "pt": pt, "tone": t})
    groups = E["grupos"]
    low = [c["c"] for c in cons if c["cls"] == "L"]
    sunits = []
    for i, gp in enumerate(groups):
        u = {"id": gp["id"], "lv": 0, "n": i + 1, "pt": gp["pt"], "en": gp["en"], "kind": "script"}
        if gp.get("cls") == "M": u["w"] = [c["c"] for c in cons if c["cls"] == "M"]
        elif gp.get("cls") == "H": u["w"] = [c["c"] for c in cons if c["cls"] == "H"]
        elif gp.get("cls") == "L1": u["w"] = low[:12]
        elif gp.get("cls") == "L2": u["w"] = low[12:]
        sunits.append(u)

    LEVELS = [
        (0, "Escrita", "pré-A1", "—"),
        (1, "A1", "A1", "Chula Novice"),
        (2, "A2", "A2", "Chula Novice (alto)"),
        (3, "B1", "B1", "Chula Intermediate"),
        (4, "B2", "B2", "Chula Advanced"),
        (5, "C1", "C1", "Chula Superior"),
        (6, "C2", "C2", "Chula Distinguished"),
    ]
    levels, words = [], []
    for lv, code, cefr, cu in LEVELS:
        L = {"lv": lv, "code": code, "cefr": cefr, "cu": cu, "units": []}
        if lv == 0: L["units"] = sunits
        else:
            p = F / f"vocab_{code.lower()}.tsv"
            if p.exists():
                us, ws = read_vocab(p, lv); L["units"] = us; words += ws
        levels.append(L)

    seen = {}
    for w in words:
        if w["t"] in seen: errs.append(f"palavra repetida: {w['t']} ({seen[w['t']]} e {w['u']})")
        seen[w["t"]] = w["u"]

    grammar, gItems, gSent = {}, [], []
    for p in sorted(F.glob("gramatica_*.json")):
        lv, pts, gaps, sents = read_grammar(p)
        grammar[lv] = pts; gItems += gaps; gSent += sents
    for g in gItems:
        if g["a"] not in [o[0] for o in g["o"]]: errs.append(f"lacuna {g['id']}: resposta fora das opções")
        if len({o[0] for o in g["o"]}) != len(g["o"]): errs.append(f"lacuna {g['id']}: opções repetidas")
        if sum(1 for t in g["s"] if t[0] == "___") != 1: errs.append(f"lacuna {g['id']}: precisa de exatamente um ___")

    # ---------- FSI Thai Basic Course: lição n -> nível CEFR (1-10 A1, 11-20 A2, 21-30 B1, 31-40 B2) ----------
    fsi = {}
    fp = F / "fsi"
    for f in (sorted(fp.glob("licao-*.json")) if fp.exists() else []):
        Lj = json.loads(f.read_text(encoding="utf-8"))
        n, lv = Lj["n"], fsi_level(Lj["n"])
        for d in Lj.get("dialogo", []):
            d["s"] = toks(d["s"])
        for x in Lj.get("notas", []):
            if x.get("ex"): x["ex"] = toks(x["ex"])
        uid = f"f{n:02d}"
        unit = {"id": uid, "lv": lv, "n": n, "kind": "fsi", "pt": Lj["titulo"]["pt"], "en": Lj["titulo"]["en"], "w": []}
        for v in Lj.get("vocab", []):
            if v["th"] not in unit["w"]: unit["w"].append(v["th"])
            if v["th"] not in seen:
                seen[v["th"]] = uid
                words.append({"t": v["th"], "p": v["p"], "r": rtgs(v["p"]), "pt": v["pt"], "en": v["en"], "lv": lv, "u": uid, "fsi": v.get("fsi", "")})
        levels[lv]["units"].append(unit)
        fsi[n] = {k: Lj[k] for k in ("n", "titulo", "dialogo", "notas", "paginas") if k in Lj}

    DATA = {"levels": levels, "words": words, "script": {"cons": cons, "vow": vow, "syl": syl}, "grammar": grammar,
            "gItems": gItems, "gSent": gSent, "fsi": fsi}
    if errs:
        print("\n".join("ERRO: " + e for e in errs)); sys.exit(1)
    js = "/* Gerado por tools/build_data.py. Não edite à mão. */\nconst DATA = " + json.dumps(DATA, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "src" / "data.js").write_text(js, encoding="utf-8")
    nU = sum(len(L["units"]) for L in levels)
    print(f"data.js: {len(words)} palavras, {nU} unidades, {len(cons)} consoantes, {len(vow)} vogais, {len(syl)} sílabas de tom, "
          f"{sum(len(v) for v in grammar.values())} pontos de gramática, {len(gItems)} lacunas, {len(gSent)} frases, {len(fsi)} lições FSI; "
          f"{len(js.encode())//1024} KB")

if __name__ == "__main__":
    main()
