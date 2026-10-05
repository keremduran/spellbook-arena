import json, glob, collections, math, sys
import numpy as np
import os; SP = os.environ.get('STATS_DIR', '.')
games = [json.loads(l) for f in sorted(glob.glob(SP + '/stats-*.jsonl')) for l in open(f)]
games = [g for g in games if g['winner']]
RM = {'common': 1.0, 'rare': 1.2, 'epic': 1.4, 'legendary': 1.7}
print(f"games {len(games)}  avg {np.mean([g['minutes'] for g in games]):.1f} min  median {np.median([g['minutes'] for g in games]):.1f}  "
      f"p10 {np.percentile([g['minutes'] for g in games],10):.1f}  p90 {np.percentile([g['minutes'] for g in games],90):.1f}  "
      f"blue wins {sum(g['winner']=='blue' for g in games)/len(games):.0%}  kills/game {np.mean([g['kills']['blue']+g['kills']['red'] for g in games]):.0f}")
rar = sorted({r for g in games for h in g['heroes'] for p in h['picks'].values() if p for r in [p[1]]})
print('rarities', rar)

# --- marginal stats
stat = collections.defaultdict(lambda: dict(n=0, w=0, dpm=0, kda=0, deaths=0))
def add(key, h, g):
    s = stat[key]; s['n'] += 1; s['w'] += h['win']; s['dpm'] += h['dealt'] / g['minutes']
    s['kda'] += (h['k'] + h['a']) / max(1, h['d']); s['deaths'] += h['d'] / g['minutes'] * 10
for g in games:
    for h in g['heroes']:
        add(('hero', h['hero']), h, g)
        for slot, p in h['picks'].items():
            if p: add(('P' if slot == 'P' else 'R' if slot == 'R' else 'B', p[0]), h, g)
        for b in {b[0] for b in h['boons']}: add(('boon', b), h, g)
        add(('rarity-total', round(sum(RM.get(p[1], 1) for p in h['picks'].values() if p), 1)), h, g)

# --- team-level ridge logistic regression: P(blue wins) = sigmoid(sum_blue - sum_red), on draft-time features only
feats = sorted({k for k in stat if k[0] in ('hero', 'P', 'B', 'R')})
idx = {f: i for i, f in enumerate(feats)}
X = np.zeros((len(games), len(feats) + 1)); y = np.zeros(len(games))
for gi, g in enumerate(games):
    for h in g['heroes']:
        sgn = 1 if h['team'] == 'blue' else -1
        X[gi, idx[('hero', h['hero'])]] += sgn
        r = 0
        for slot, p in h['picks'].items():
            if p:
                X[gi, idx[('P' if slot == 'P' else 'R' if slot == 'R' else 'B', p[0])]] += sgn; r += RM.get(p[1], 1) - 1
        X[gi, -1] += sgn * r
    y[gi] = g['winner'] == 'blue'
w = np.zeros(X.shape[1]); lam = 2.0
for it in range(4000):
    p = 1 / (1 + np.exp(-X @ w))
    grad = X.T @ (p - y) + lam * w
    w -= 0.002 * grad
coef = {f: w[idx[f]] for f in feats}
print(f"rarity effect (log-odds per +1.0 rarity mult over common): {w[-1]:.2f}")

def table(kind, title):
    rows = [(k[1], s) for k, s in stat.items() if k[0] == kind]
    rows.sort(key=lambda r: -(coef.get((kind, r[0]), 0) if kind != 'boon' else r[1]['w'] / r[1]['n']))
    print(f"\n== {title}")
    print(f"{'name':18} {'picks':>5} {'win%':>5} {'effect':>7} {'dmg/min':>8} {'deaths/10m':>10} {'KDA':>5}")
    for name, s in rows:
        n = s['n']
        print(f"{name:18} {n:5d} {100*s['w']/n:5.0f} {coef.get((kind, name), float('nan')):7.2f} {s['dpm']/n/1000:7.1f}k {s['deaths']/n:10.1f} {s['kda']/n:5.1f}")
table('hero', 'Heroes'); table('P', 'Passives'); table('B', 'Basic abilities (Q/W/E)'); table('R', 'Ultimates'); table('boon', 'Boons (owned at end; biased: winners collect more)')
rows = sorted((k[1], s) for k, s in stat.items() if k[0] == 'rarity-total')
print('\n== total draft rarity mult -> win%'); [print(f"{k:5} n={s['n']:4d} win {100*s['w']/s['n']:.0f}%") for k, s in rows if s['n'] > 30]
nb = [len(h['boons']) for g in games for h in g['heroes']]
print(f"\nboons per hero at end: avg {np.mean(nb):.1f} max {max(nb)}  winners {np.mean([len(h['boons']) for g in games for h in g['heroes'] if h['win']]):.1f} losers {np.mean([len(h['boons']) for g in games for h in g['heroes'] if not h['win']]):.1f}")
