#!/usr/bin/env python3
"""Syntax diagrams (Phase 3, Scope 3) over real HTTP: a pushed 'syntaxDiagram' record round-trips
through /changes exactly like any other generic record type, and the static web/syntax/ bundle
(syntax-bundle/, synced from BVC) is served inline the same way facts-bundle/ is.

    tests/integration/syntax.py http://127.0.0.1:8090 admin phos-dev-pw
"""
import sys, os, uuid, base64, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_vectors as rv  # noqa: E402

BASE = rv.BASE


def raw(method, url, user=None, pw=None):
    req = urllib.request.Request(url, method=method)
    if user is not None:
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


run = uuid.uuid4().hex[:6]
alice = f"fx{run}-alice"
pw = "Fx-pw-" + uuid.uuid4().hex
rv.ensure_user(alice, pw)

fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

# ---- the record itself: a generic 'syntaxDiagram' push/pull, same mechanism as any other type ----
diagram = {"osis": "John.3.16", "els": [
    {"k": "t", "x": 40, "y": 60, "t": "For God", "c": "wd", "r": 0, "w": -1},
    {"k": "l", "x1": 30, "y1": 80, "x2": 200, "y2": 80, "c": "base"},
], "w": 400, "h": 140}
changes = [{"changeId": f"{run}s0", "type": "syntaxDiagram", "key": "syntaxDiagram:John.3.16", "op": "upsert",
            "hlc": "1791200000000-0000-aaaaaaaaaaaaaaaa", "payload": diagram}]
st, data = rv.call("POST", "/apps/phos/api/v1/push", alice, pw, {"device": "aaaaaaaaaaaaaaaa", "changes": changes})
check(st == 200 and data["results"][0]["status"] == "accepted", f"syntaxDiagram push accepted ({st}, {data})")

st, data = rv.call("GET", "/apps/phos/api/v1/changes?types=syntaxDiagram", alice, pw)
rec = next((r for r in data.get("changes", []) if r["key"] == "syntaxDiagram:John.3.16"), None)
check(rec is not None and rec["payload"] == diagram, f"pulled back byte-identical ({rec})")

# ---- the bundle: served inline like facts-bundle/, never 404 on its own files ----
st, body, headers = raw("GET", f"{BASE}/apps/phos/syntax-bundle/syntax.html", alice, pw)
check(st == 200 and b"PhosSyntax" in body and "text/html" in headers.get("Content-Type", ""),
      f"syntax.html served inline ({st}, {headers.get('Content-Type')})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/syntax-bundle/syntax.js", alice, pw)
check(st == 200 and b"PhosSyntax" in body and "javascript" in headers.get("Content-Type", ""),
      f"syntax.js served inline ({st}, {headers.get('Content-Type')})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/syntax-bundle/nope.html", alice, pw)
check(st == 404, f"nonexistent file refused ({st})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/syntax-bundle/..%2f..%2f..%2fcomposer.json", alice, pw)
check(st == 404, f"path traversal refused ({st})")

print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
