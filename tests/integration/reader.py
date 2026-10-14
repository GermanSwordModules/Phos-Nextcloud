#!/usr/bin/env python3
"""SWORD reader API (W-1) over real module files in Phos/Module/.

    tests/integration/reader.py http://127.0.0.1:8090 admin phos-dev-pw

Uploads the fixture modules (tests/fixtures/sword) for alice, shares two of
them with bob: plain text readable for both, the ciphered one only with the
reader's own moduleKey.
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
    return {"name": name, "confFile": conf, "conf": text, "files": files,
            "total": sum(f["s"] for f in files), "cipher": name == "TINYZC"}


run = uuid.uuid4().hex[:6]
alice, bob, carol = f"rd{run}-alice", f"rd{run}-bob", f"rd{run}-carol"
pw = {u: "Rd-pw-" + uuid.uuid4().hex for u in (alice, bob, carol)}
for u in pw:
    rv.ensure_user(u, pw[u])
    rv.call("GET", "/apps/phos/api/v1/status", u, pw[u])

st, data = rv.call("POST", "/apps/phos/api/v1/collections", alice, pw[alice], {"name": "Module"})
shared = data["id"]
rv.call("POST", f"/apps/phos/api/v1/collections/{shared}/members", alice, pw[alice], {"type": "user", "id": bob, "perm": "read"})
changes = []
for i, (name, conf, coll) in enumerate([("TINYZ", "tinyz.conf", shared), ("TINYZC", "tinyzc.conf", shared),
                                        ("TINYLEX_ZLD", "tinylex_zld.conf", None)]):
    c = {"changeId": f"{run}m{i}", "type": "module", "key": f"module:{name}", "op": "upsert",
         "hlc": "1791200000000-0000-aaaaaaaaaaaaaaaa", "payload": upload(alice, pw[alice], name, conf)}
    if coll:
        c["collection"] = coll
    changes.append(c)
changes.append({"changeId": f"{run}k", "type": "moduleKey", "key": "moduleKey:TINYZC", "op": "upsert",
                "hlc": "1791200000000-0000-aaaaaaaaaaaaaaaa", "payload": {"key": "Fixture-Key-1"}})
st, data = rv.call("POST", "/apps/phos/api/v1/push", alice, pw[alice], {"device": "aaaaaaaaaaaaaaaa", "changes": changes})
assert all(r["status"] == "accepted" for r in data["results"]), data

fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

API = "/apps/phos/api/v1/modules"
q = urllib.parse.quote

st, data = rv.call("GET", API, alice, pw[alice])
mods = {m["name"]: m for m in data["modules"]}
check(sorted(mods) == ["TINYLEX_ZLD", "TINYZ", "TINYZC"], f"alice sees her modules ({sorted(mods)})")
check(mods["TINYZC"]["ciphered"] and not mods["TINYZC"]["locked"], "own ciphered module is unlocked by her key")
check(mods["TINYZ"]["kind"] == "bible" and mods["TINYLEX_ZLD"]["kind"] == "dictionary", "kinds")

st, data = rv.call("GET", f"{API}/TINYZ/books", alice, pw[alice])
check(st == 200 and len(data["books"]) == 66 and data["books"][0]["osis"] == "Gen" and len(data["books"][0]["verses"]) == 50,
      f"books ({st})")
st, data = rv.call("GET", f"{API}/TINYZ/text/Gen/1", alice, pw[alice])
check(st == 200 and "In the beginning" in data["verses"]["1"] and "The Creation" in data["intro"], f"chapter text ({st})")
st, data = rv.call("GET", f"{API}/TINYZC/text/John/3", alice, pw[alice])
check(st == 200 and "so loved the world" in data["verses"]["16"] and data["links"] == {"18": 17}, f"ciphered chapter, linked verse ({st})")
st, data = rv.call("GET", f"{API}/TINYZ/text/Gen/51", alice, pw[alice])
check(st == 422, f"no such chapter ({st})")
st, data = rv.call("GET", f"{API}/TINYLEX_ZLD/entry/{q('G25')}", alice, pw[alice])
check(st == 200 and "agapao" in data["text"], f"dictionary entry ({st})")
st, data = rv.call("GET", f"{API}/TINYLEX_ZLD/entry/{q('Abram')}", alice, pw[alice])
check(st == 200 and data["text"] == "Father of Isaac.", f"@LINK followed ({st})")
st, data = rv.call("GET", f"{API}/TINYLEX_ZLD/keys?from=ab&limit=2", alice, pw[alice])
check(st == 200 and data["keys"] == ["ABRAHAM", "ABRAM"], f"key list ({data})")

st, data = rv.call("GET", API, bob, pw[bob])
mods = {m["name"]: m for m in data["modules"]}
check(sorted(mods) == ["TINYZ", "TINYZC"], f"bob sees only the shared modules ({sorted(mods)})")
check(mods.get("TINYZC", {}).get("locked") is True, "shared ciphered module is locked for bob (keys are never shared)")
st, data = rv.call("GET", f"{API}/TINYZ/text/Gen/1", bob, pw[bob])
check(st == 200 and "In the beginning" in data["verses"]["1"], f"bob reads the shared text from alice's files ({st})")
st, data = rv.call("GET", f"{API}/TINYZC/text/Gen/1", bob, pw[bob])
check(st == 422 and "locked" in data.get("error", ""), f"bob cannot read the ciphered one ({st})")
st, _ = rv.call("GET", f"{API}/TINYLEX_ZLD/entry/G25", bob, pw[bob])
check(st == 404, f"bob cannot read alice's private module ({st})")
st, _ = rv.call("GET", f"{API}/TINYZ/text/Gen/1", carol, pw[carol])
check(st == 404, f"outsider gets nothing ({st})")
rv.call("DELETE", f"/apps/phos/api/v1/collections/{shared}/members/user/{bob}", alice, pw[alice])
st, _ = rv.call("GET", f"{API}/TINYZ/text/Gen/1", bob, pw[bob])
check(st == 404, f"nothing after removal, cache included ({st})")
print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
