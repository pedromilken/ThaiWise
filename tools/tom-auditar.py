#!/usr/bin/env python3
"""Audita o tom de todas as palavras de UMA sílaba do ThaiWise: calcula o tom pela escrita tailandesa
(classe da consoante + sílaba viva/morta + duração + marca) e compara com o Paiboon+.
Uso: python tools/tom-auditar.py      (lista as divergências para revisão humana)"""
import json, re, unicodedata, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = json.loads(re.sub(r'^/\*.*?\*/\s*const DATA = ', '', (ROOT/'src'/'data.js').read_text(encoding='utf-8'), flags=re.S).rstrip().rstrip(';'))
MID = set('กจฎฏดตบปอ'); HIGH = set('ขฃฉฐถผฝศษสห'); LOWSON = set('งญณนมยรลวฬ')
CONS = set('กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ')
STOP = set('กขคฆจชซฌฎฏฐฑฒดตถทธศษสบปพฟภ')
MARKS = {'่': 1, '้': 2, '๊': 3, '๋': 4}
def cls(c): return 'M' if c in MID else 'H' if c in HIGH else 'L'
def rule(c, live, long_, mark):
    if c == 'M': return [('M' if live else 'L'), 'L', 'F', 'H', 'R'][mark]
    if c == 'H': return [('R' if live else 'L'), 'L', 'F', 'F', 'F'][mark]
    if mark: return ['', 'F', 'H', 'H', 'H'][mark]
    return 'M' if live else ('F' if long_ else 'H')
def tone_pb(p):
    for ch in unicodedata.normalize('NFD', p):
        if ch in '\u0300\u0302\u0301\u030C': return {'\u0300': 'L', '\u0302': 'F', '\u0301': 'H', '\u030C': 'R'}[ch]
    return 'M'
def analyse(w):
    w = re.sub(r'.ร์|.์', '', w) if 'ทร์' not in w else w.replace('ทร์', '')
    if re.search('[ตทจ]ร$', w): w = w[:-1]          # ร final mudo: บุตร, ลิตร, จักร
    w = re.sub('าติ$', 'าต', w)                     # ิ mudo: ชาติ, ญาติ
    mark = 0
    for k, v in MARKS.items():
        if k in w: mark = v; w = w.replace(k, '')
    lead = w[0] if w and w[0] in 'เแโใไ' else ''
    s = w[1:] if lead else w
    if not s or s[0] not in CONS: return None
    c0 = s[0]; i = 1; c = cls(c0)
    if c0 == 'ห' and len(s) > 1 and s[1] in LOWSON: c = 'H'; i = 2
    elif c0 == 'อ' and len(s) > 1 and s[1] == 'ย': c = 'M'; i = 2
    elif len(s) > 2 and s[1] in 'รลว' and s[2] not in CONS: i = 2          # encontro: กร, คล, กว…
    elif len(s) > 2 and s[1] in 'รลว' and s[2] in 'าีืูเอ': i = 2
    r = s[i:]
    if lead and lead in 'ใไ': return c, True, True, mark
    if lead == 'เ' and r.startswith('า'): return c, not r.endswith('ะ'), not r.endswith('ะ'), mark   # เ-า / เ-าะ
    short = False; vowel_done = False
    if r.endswith('ะ') or '็' in r: short = True
    elif lead and lead in 'เแโ':
        short = False
    elif r[:1] and r[:1] in 'ัิึุ' and not r.startswith('ัว'): short = True
    elif r[:1] == '' or (r[:1] and r[:1] in CONS and not r.startswith('อ') and not r.startswith('ว')): short = bool(r)   # vogal implícita: นก, คน
    if r.startswith('ำ'): return c, True, False, mark
    fin = ''
    rr = r.replace('ีย', '').replace('ือ', '').replace('ัว', '').lstrip('ะาิีึืุูั็')
    if lead and rr.startswith('อ'): rr = rr[1:]
    if not lead and r.startswith('อ'): rr = r[1:]
    rr = rr.rstrip('ะ')
    if rr: fin = rr[-1]
    if not r and not lead: short = False
    live = (fin and fin not in STOP) or (not fin and not short)
    if fin and fin in STOP: live = False
    if not fin and short: live = False
    return c, bool(live), not short, mark
# exceções conhecidas: ก็ (escrito curto, dito descendente), sílabas com letra muda que o analisador não modela,
# e empréstimos do inglês que seguem a pronúncia e não a escrita (เทป, ลิฟต์…)
EXCECOES = {'ก็', 'เทป', 'แฟลต'}
diffs = []
for w in D['words']:
    p = w['p']
    if '-' in p or ' ' in p or len(w['t']) > 7: continue
    if w['t'] in EXCECOES: continue
    a = analyse(w['t'])
    if not a: continue
    calc = rule(*a)
    if calc and calc != tone_pb(p): diffs.append((w['t'], p, calc, tone_pb(p), w['u']))
NAME = {'M': 'médio', 'L': 'baixo', 'F': 'descendente', 'H': 'alto', 'R': 'ascendente'}
print(f"{len(diffs)} divergência(s) entre a regra e o Paiboon (palavras de 1 sílaba):")
for t, p, c, g, u in diffs: print(f"  {t:8} {p:10} regra: {NAME[c]:11} paiboon: {NAME[g]:11} [{u}]")
