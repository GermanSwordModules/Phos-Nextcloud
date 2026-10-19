#!/usr/bin/env python3
"""Generates lib/Service/Sword/v11n.json from libsword's canon_*.h.

    python3 -I dev/gen_v11n.py <sword-source>/include > lib/Service/Sword/v11n.json
    python3 -I dev/gen_v11n.py <sword-source>/include --maps > lib/Service/Sword/v11n-maps.json

Run once per libsword release; the output is committed. Systems with a
mapping table (mappings_* in canon_*.h, rules towards KJVA) carry it as
"map": {"extra": [osis…], "rules": [[book, c, v, vEnd, kjvaC, kjvaV, kjvaVEnd(, book2)]…]}
in libsword's order (Versification::translate replays it), written by --maps.
"""
import json
import re
import sys
from pathlib import Path

# name -> (ot array, nt array, verse-max array), as registered in
# src/mgr/versificationmgr.cpp (sword 1.9)
SYSTEMS = {
    'KJV': ('otbooks', 'ntbooks', 'vm'),
    'Leningrad': ('otbooks_leningrad', 'ntbooks_null', 'vm_leningrad'),
    'MT': ('otbooks_mt', 'ntbooks_null', 'vm_mt'),
    'KJVA': ('otbooks_kjva', 'ntbooks', 'vm_kjva'),
    'NRSV': ('otbooks', 'ntbooks', 'vm_nrsv'),
    'NRSVA': ('otbooks_nrsva', 'ntbooks', 'vm_nrsva'),
    'Synodal': ('otbooks_synodal', 'ntbooks_synodal', 'vm_synodal'),
    'SynodalProt': ('otbooks_synodalProt', 'ntbooks_synodal', 'vm_synodalProt'),
    'Vulg': ('otbooks_vulg', 'ntbooks_vulg', 'vm_vulg'),
    'German': ('otbooks_german', 'ntbooks', 'vm_german'),
    'Luther': ('otbooks_luther', 'ntbooks_luther', 'vm_luther'),
    'Catholic': ('otbooks_catholic', 'ntbooks', 'vm_catholic'),
    'Catholic2': ('otbooks_catholic2', 'ntbooks', 'vm_catholic2'),
    'LXX': ('otbooks_lxx', 'ntbooks', 'vm_lxx'),
    'Orthodox': ('otbooks_orthodox', 'ntbooks', 'vm_orthodox'),
    'Calvin': ('otbooks', 'ntbooks', 'vm_calvin'),
    'DarbyFr': ('otbooks', 'ntbooks', 'vm_darbyfr'),
    'Segond': ('otbooks', 'ntbooks', 'vm_segond'),
}
MAPPINGS = {
    'NRSV': 'mappings_nrsv', 'Synodal': 'mappings_synodal', 'Vulg': 'mappings_vulg',
    'Calvin': 'mappings_calvin', 'DarbyFr': 'mappings_darbyfr', 'Segond': 'mappings_segond',
}


def parse_mapping(body, nbooks):
    """unsigned char mappings_x[] = {'E','p',0, …, 0, rules…, 0} → map dict."""
    vals = [ord(t[1]) if t.startswith("'") else int(t) for t in re.findall(r"'[^']'|\d+", body)]
    extra, i = [], 0
    while vals[i] != 0:
        j = vals.index(0, i)
        extra.append(''.join(map(chr, vals[i:j])))
        i = j + 1
    i += 1
    rules = []
    while vals[i] != 0:
        r = vals[i:i + 7]
        i += 7
        if r[0] > nbooks:      # rule for an extra book: 8th byte = target book
            r.append(vals[i])
            i += 1
        rules.append(r)
    return {'extra': extra, 'rules': rules}


def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return re.sub(r'//[^\n]*', '', s)


def main(inc, want_maps=False):
    src = strip_comments(''.join(p.read_text(encoding='utf-8') for p in sorted(Path(inc).glob('canon*.h'))))
    books, vms = {}, {}
    for m in re.finditer(r'struct\s+sbook\s+(\w+)\[\]\s*=\s*\{(.*?)\};', src, re.S):
        rows = re.findall(r'\{\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*\}', m.group(2))
        books[m.group(1)] = [[osis, name, int(ch)] for name, osis, _abbr, ch in rows if int(ch) > 0]
    for m in re.finditer(r'int\s+(vm\w*)\[\]\s*=\s*\{(.*?)\};', src, re.S):
        vms[m.group(1)] = [int(x) for x in re.findall(r'\d+', m.group(2))]
    maps = {m.group(1): m.group(2) for m in re.finditer(r'unsigned\s+char\s+(mappings_\w+)\[\]\s*=\s*\{(.*?)\};', src, re.S)}
    out, mapped = {}, {}
    for name, (ot, nt, vm) in SYSTEMS.items():
        verses = vms[vm]
        need = sum(b[2] for b in books[ot] + books[nt])
        if len(verses) != need:
            sys.exit(f'{name}: {len(verses)} verse counts, {need} chapters')
        pos, sysbooks = 0, []
        for testament, arr in ((1, books[ot]), (2, books[nt])):
            for osis, bname, ch in arr:
                sysbooks.append({'osis': osis, 'name': bname, 't': testament, 'v': verses[pos:pos + ch]})
                pos += ch
        if name in MAPPINGS:
            mapped[name] = parse_mapping(maps[MAPPINGS[name]], len(sysbooks))
        out[name] = sysbooks
    if want_maps:
        out = mapped
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main(sys.argv[1], '--maps' in sys.argv[2:])
