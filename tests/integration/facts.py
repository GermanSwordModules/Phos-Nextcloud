#!/usr/bin/env python3
"""Fakten/Facts (Phase 3, Scope 1) over real module files, same fixture upload as reader.py.

    tests/integration/facts.py http://127.0.0.1:8090 admin phos-dev-pw

Uses the real data/facts/topic-scores.txt + topic-titles-de.csv (committed, synced from BVC --
not a test fixture): "love" -> John.3.16 is real openbible.info data, and the tiny Bible fixture
(tests/fixtures/sword, see build.sh) happens to cover exactly Gen.1 and John.3.16-17, so that
passage's text comes back for real. "abraham" -> label "Abraham" matches the fixture lexicon's
ABRAHAM headword exactly, exercising the dictionary-entries path.
"""
import sys, os, uuid, base64, urllib.request, urllib.error, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_vectors as rv  # noqa: E402

BASE = rv.BASE
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "sword")


def raw(method, url, user, pw, data=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def upload(user, pw, name, conf):
    """Module files as the desktop stores them: Phos/Module/<Name>/<path below the SWORD root>."""
    text = open(os.path.join(FIX, "mods.d", conf), encoding="utf-8").read()
    dp = [l.split("=", 1)[1].strip() for l in text.splitlines() if l.startswith("DataPath=")][0].removeprefix("./")
    d = dp if dp.endswith("/") else dp.rsplit("/", 1)[0] + "/"
    files = []
    dav = f"{BASE}/remote.php/dav/files/{user}"
    parts = ["Phos", "Phos/Module", f"Phos/Module/{name}"]
    acc = f"Phos/Module/{name}"
    for seg in d.strip("/").split("/"):
        acc += "/" + seg
        parts.append(acc)
    for p in parts:
        raw("MKCOL", f"{dav}/{p}", user, pw)
    for f in sorted(os.listdir(os.path.join(FIX, d))):
        data = open(os.path.join(FIX, d, f), "rb").read()
        st, _ = raw("PUT", f"{dav}/Phos/Module/{name}/{d}{f}", user, pw, data)
        assert st in (201, 204), (st, f)
        files.append({"p": d + f, "s": len(data), "h": "x"})
    return {"name": name, "confFile": conf, "conf": text, "files": files, "total": sum(f["s"] for f in files), "cipher": False}


run = uuid.uuid4().hex[:6]
alice = f"fx{run}-alice"
pw = "Fx-pw-" + uuid.uuid4().hex
rv.ensure_user(alice, pw)
rv.call("GET", "/apps/phos/api/v1/status", alice, pw)

changes = []
for i, (name, conf) in enumerate([("TINYZ", "tinyz.conf"), ("TINYLEX_RAWLD4", "tinylex_rawld4.conf")]):
    changes.append({"changeId": f"{run}m{i}", "type": "module", "key": f"module:{name}", "op": "upsert",
                     "hlc": "1791200000000-0000-aaaaaaaaaaaaaaaa", "payload": upload(alice, pw, name, conf)})
st, data = rv.call("POST", "/apps/phos/api/v1/push", alice, pw, {"device": "aaaaaaaaaaaaaaaa", "changes": changes})
assert all(r["status"] == "accepted" for r in data["results"]), data

fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

API = "/apps/phos/api/v1/facts"
q = urllib.parse.quote

st, data = rv.call("GET", f"{API}?lang=de&q=liebe", alice, pw)
check(st == 200 and any(t["key"] == "love" and t["label"] == "Liebe" for t in data["topics"]), f"topic search finds it by its German label ({st})")

st, data = rv.call("GET", f"{API}/{q('love')}?lang=de&module=TINYZ", alice, pw)
check(st == 200 and data["topic"] == {"key": "love", "label": "Liebe"}, f"topic resolved ({data.get('topic')})")
passages = next((s for s in data["sections"] if s["id"] == "passages"), None)
check(passages is not None, "has a passages section")
jn316 = next((it for it in (passages or {}).get("items", []) if it["osis"] == "John.3.16"), None)
check(jn316 is not None and "world" in jn316["text"], f"John.3.16 text came from the fixture Bible ({jn316})")
check(set(data["empty"]) and "sections" in data and not any(s["id"] == "entries" for s in data["sections"]),
      f"no dictionary installed for this topic's label -> no entries section ({[s['id'] for s in data['sections']]})")

st, data = rv.call("GET", f"{API}/{q('abraham')}?lang=de&module=TINYZ", alice, pw)
check(st == 200, f"abraham resolves ({st})")
entries = next((s for s in data["sections"] if s["id"] == "entries"), None)
# the key comes back as typed ("Abraham"), not the module's own stored case ("ABRAHAM") --
# dictEntry() resolves case-insensitively but doesn't hand the canonical key back.
check(entries is not None and any(it["key"] == "Abraham" and it["module"] == "TINYLEX_RAWLD4" for it in entries["items"]),
      f"exact dictionary hit on the translated label ({entries})")

st, data = rv.call("GET", f"{API}/{q('not-a-real-topic-xyz')}", alice, pw)
check(st == 404, f"unknown topic -> 404 ({st})")

print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
