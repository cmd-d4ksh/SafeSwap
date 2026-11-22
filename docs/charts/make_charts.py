"""Builds SVG charts from docs/benchmark_results.csv (no dependencies). Run: python3 docs/charts/make_charts.py"""
import csv, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(HERE, '..', 'benchmark_results.csv'))))
SPEC = {
    'prefix': ('Prefix search: Trie vs linear scan', 'µs per query', 'Trie', 'Linear scan'),
    'phrase': ('Phrase search: KMP vs naive (realistic text)', 'µs per phrase', 'KMP', 'Naive'),
    'phrase-adversarial': ('Phrase search: KMP vs naive (adversarial text)', 'µs per phrase', 'KMP', 'Naive'),
    'membership': ('Contraindication check: Bloom filter vs HashSet', 'ns per check', 'Bloom filter', 'HashSet'),
    'pipeline': ('Substitution request: Bloom pipeline vs rule-only', 'µs per request', 'Bloom pipeline', 'Rule-only'),
}
for exp, (title, unit, a_name, b_name) in SPEC.items():
    data = [(int(r['n']), float(r['algorithm_value']), float(r['baseline_value'])) for r in rows if r['experiment'] == exp]
    if not data: continue
    W, H, L, R, T, B = 640, 360, 70, 20, 50, 60
    xs = [math.log10(n) for n, _, _ in data]
    ys = [math.log10(max(v, 1e-3)) for _, a, b in data for v in (a, b)]
    x0, x1, y0, y1 = min(xs), max(xs), math.floor(min(ys)), math.ceil(max(ys))
    if y1 == y0: y1 += 1
    X = lambda v: L + (v - x0) / ((x1 - x0) or 1) * (W - L - R)
    Y = lambda v: H - B - (math.log10(max(v, 1e-3)) - y0) / (y1 - y0) * (H - T - B)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Inter,Arial,sans-serif" font-size="12">',
           f'<rect width="{W}" height="{H}" fill="#0f1216"/>',
           f'<text x="{L}" y="28" fill="#f1f3f6" font-size="15" font-weight="700">{title}</text>']
    for e in range(y0, y1 + 1):
        y = H - B - (e - y0) / (y1 - y0) * (H - T - B)
        out.append(f'<line x1="{L}" x2="{W-R}" y1="{y:.1f}" y2="{y:.1f}" stroke="#262b33"/><text x="{L-8}" y="{y+4:.1f}" fill="#a8b0bb" text-anchor="end">10^{e}</text>')
    for n, _, _ in data:
        out.append(f'<text x="{X(math.log10(n)):.1f}" y="{H-B+18}" fill="#a8b0bb" text-anchor="middle">{n:,}</text>')
    out.append(f'<text x="{(L+W-R)/2}" y="{H-12}" fill="#a8b0bb" text-anchor="middle">input size (log scale)</text>')
    out.append(f'<text x="16" y="{(T+H-B)/2}" fill="#a8b0bb" transform="rotate(-90 16 {(T+H-B)/2})" text-anchor="middle">{unit} (log scale)</text>')
    for idx, (name, col) in enumerate([(a_name, '#ff5a2c'), (b_name, '#6ea8ff')]):
        pts = ' '.join(f'{X(math.log10(n)):.1f},{Y(v[idx]):.1f}' for n, *v in data)
        out.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="2.5"/>')
        for n, *v in data: out.append(f'<circle cx="{X(math.log10(n)):.1f}" cy="{Y(v[idx]):.1f}" r="4" fill="{col}"/>')
        out.append(f'<rect x="{W-R-170}" y="{T-8+idx*18}" width="12" height="12" fill="{col}"/><text x="{W-R-152}" y="{T+2+idx*18}" fill="#f1f3f6">{name}</text>')
    out.append('</svg>')
    open(os.path.join(HERE, f'{exp}.svg'), 'w').write('\n'.join(out))
    print('wrote', exp)
