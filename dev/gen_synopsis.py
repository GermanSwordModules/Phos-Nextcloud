#!/usr/bin/env python3
"""BVC's gospel synopsis data → src/synopsis/pericopes.json (the web's copy).

    python3 -I dev/gen_synopsis.py [path/to/BVC]

Source: BVC/data/compositeGospel.1.2.xml (the desktop's and the phone's synopsis) plus the German
titles BVC/data/synopsis-titles-de.csv ("id|title"). Same parse as Phos Mobile's SynopsisData.kt.
"""
import html, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BVC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'BVC')

def ref(r):
    a, _, b = r.partition('-')
    s = a.split('.'); e = (b or a).split('.')
    if len(s) < 3:
        return None
    c1, v1 = int(s[1]), int(s[2])
    c2, v2 = (int(e[1]), int(e[2])) if len(e) >= 3 else (c1, v1)
    return {'book': s[0], 'c1': c1, 'v1': v1, 'c2': c2, 'v2': v2}

xml = open(os.path.join(BVC, 'data', 'compositeGospel.1.2.xml'), encoding='utf-8').read()
titles = {}
for line in open(os.path.join(BVC, 'data', 'synopsis-titles-de.csv'), encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '|' in line:
        k, v = line.split('|', 1)
        titles[k.strip()] = v.strip()

out = []
for m in re.finditer(r'<Pericope ([^>]*)>(.*?)</Pericope>', xml, re.S):
    head, body = m.group(1), m.group(2)
    pid = re.search(r'rdf:ID="([^"]*)"', head)
    title = re.search(r'hasTitle="([^"]*)"', head)
    srcs = [ref(r) for r in re.findall(r'<PericopeSource[^>]*\bhasReference="([^"]*)"', body)]
    srcs = [s for s in srcs if s]
    if pid and title and srcs:
        out.append({'id': pid.group(1), 'en': html.unescape(title.group(1)), 'de': titles.get(pid.group(1), ''), 'src': srcs})

dst = os.path.join(ROOT, 'src', 'synopsis', 'pericopes.json')
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(len(out), 'pericopes →', dst)
