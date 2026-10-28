#!/usr/bin/env python3
"""Query builder (Phase 3, Scope 4) over real HTTP: the static web/querybuilder/ bundle
(qb-bundle/, synced from BVC) is served inline the same way facts-bundle/ and syntax-bundle/ are
-- it emits no new record type, just a PQL-subset query string run through the existing
reader#search route, so this only needs to prove the bundle itself is reachable and safe.

    tests/integration/qb.py http://127.0.0.1:8090 admin phos-dev-pw
"""
import sys, os, base64, urllib.request, urllib.error
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


fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

# ---- the bundle: served inline like facts-bundle/ and syntax-bundle/, never 404 on its own files ----
st, body, headers = raw("GET", f"{BASE}/apps/phos/qb-bundle/querybuilder.html", "admin", "phos-dev-pw")
check(st == 200 and b"PhosQB" in body and "text/html" in headers.get("Content-Type", ""),
      f"querybuilder.html served inline ({st}, {headers.get('Content-Type')})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/qb-bundle/qb.js", "admin", "phos-dev-pw")
check(st == 200 and b"PhosQB" in body and "javascript" in headers.get("Content-Type", ""),
      f"qb.js served inline ({st}, {headers.get('Content-Type')})")
check(b"caps" in body, "qb.js carries the caps-restriction support")

st, body, headers = raw("GET", f"{BASE}/apps/phos/qb-bundle/qb.css", "admin", "phos-dev-pw")
check(st == 200 and "text/css" in headers.get("Content-Type", ""), f"qb.css served inline ({st})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/qb-bundle/nope.html", "admin", "phos-dev-pw")
check(st == 404, f"nonexistent file refused ({st})")

st, body, headers = raw("GET", f"{BASE}/apps/phos/qb-bundle/..%2f..%2f..%2fcomposer.json", "admin", "phos-dev-pw")
check(st == 404, f"path traversal refused ({st})")

print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
