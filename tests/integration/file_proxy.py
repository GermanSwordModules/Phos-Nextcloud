#!/usr/bin/env python3
"""Members read files of a shared collection through /apps/phos/files/…,
and nothing else of the owner's Phos/ folder.

    tests/integration/file_proxy.py http://127.0.0.1:8090 admin phos-dev-pw
"""
import sys, os, uuid, json, base64, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_vectors as rv  # noqa: E402

BASE = rv.BASE


def raw(method, url, user, pw, data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


run = uuid.uuid4().hex[:6]
alice, bob = f"fp{run}-alice", f"fp{run}-bob"
pw = {alice: "Fp-pw-" + uuid.uuid4().hex, bob: "Fp-pw-" + uuid.uuid4().hex}
for u in (alice, bob):
    rv.ensure_user(u, pw[u])
    rv.call("GET", "/apps/phos/api/v1/status", u, pw[u])
payload = os.urandom(200000)
dav = f"{BASE}/remote.php/webdav"
for d in ("Phos", "Phos/E-Books", "Phos/E-Books/geteilt", "Phos/E-Books/privat"):
    raw("MKCOL", f"{dav}/{d}", alice, pw[alice])
raw("PUT", f"{dav}/Phos/E-Books/geteilt/book.epub", alice, pw[alice], payload)
raw("PUT", f"{dav}/Phos/E-Books/privat/book.epub", alice, pw[alice], b"privat")
st, data = rv.call("POST", "/apps/phos/api/v1/collections", alice, pw[alice], {"name": "Bücher"})
coll = data["id"]
rv.call("POST", f"/apps/phos/api/v1/collections/{coll}/members", alice, pw[alice], {"type": "user", "id": bob, "perm": "read"})
hlc = "1791200000000-0000-aaaaaaaaaaaaaaaa"
st, data = rv.call("POST", "/apps/phos/api/v1/push", alice, pw[alice], {"device": "aaaaaaaaaaaaaaaa", "changes": [
    {"changeId": run + "1", "type": "ebook", "key": "ebook:geteilt", "op": "upsert", "hlc": hlc, "collection": coll,
     "payload": {"files": [{"p": "book.epub", "s": len(payload), "h": "x"}]}}]})
assert data["results"][0]["status"] == "accepted", data

url = f"{BASE}/index.php/apps/phos/files/{coll}/"
fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

st, body = raw("GET", url + "E-Books/geteilt/book.epub", bob, pw[bob])
check(st == 200 and body == payload, f"member gets the shared file ({st}, {len(body)} bytes)")
st, _ = raw("GET", url + "E-Books/privat/book.epub", bob, pw[bob])
check(st == 403, f"not the owner's other files ({st})")
st, _ = raw("GET", url + "E-Books/geteilt/../privat/book.epub", bob, pw[bob])
check(st in (400, 403, 404), f"no path tricks ({st})")
outsider = f"fp{run}-carol"
pw[outsider] = "Fp-pw-" + uuid.uuid4().hex
rv.ensure_user(outsider, pw[outsider])
st, _ = raw("GET", url + "E-Books/geteilt/book.epub", outsider, pw[outsider])
check(st == 403, f"not for non-members ({st})")
rv.call("DELETE", f"/apps/phos/api/v1/collections/{coll}/members/user/{bob}", alice, pw[alice])
st, _ = raw("GET", url + "E-Books/geteilt/book.epub", bob, pw[bob])
check(st == 403, f"not after removal ({st})")
print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
