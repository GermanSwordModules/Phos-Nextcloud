#!/usr/bin/env python3
"""Seeds a fresh user for the web smoke test (or for looking around).

    tests/e2e/seed.py http://127.0.0.1:8090 admin phos-dev-pw [--sword ~/.sword --modules KJV,StrongsRealGreek]

Uploads the fixture modules (tests/fixtures/sword) — and optionally real
modules from a SWORD directory — into the user's Phos/Module/, pushes their
manifests, a label, two bookmarks (one with a note) and plan progress.
Prints {"user":…, "password":…} as the last line.
"""
import sys, os, uuid, json, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "integration"))
argv = sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("url"); ap.add_argument("admin"); ap.add_argument("pw")
ap.add_argument("--sword"); ap.add_argument("--modules", default="")
ap.add_argument("--user"); ap.add_argument("--password")
args = ap.parse_args(argv)
sys.argv = [sys.argv[0], args.url, args.admin, args.pw]
import run_vectors as rv  # noqa: E402
import base64, urllib.request, urllib.error  # noqa: E402


def raw(method, url, user, pw, data=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "sword")


def upload_from(root, user, pw, conf_name):
    """Module files as the desktop stores them: Phos/Module/<Name>/<path below the SWORD root>."""
    text = open(os.path.join(root, "mods.d", conf_name), encoding="utf-8", errors="replace").read()
    name = [l.strip()[1:-1] for l in text.splitlines() if l.strip().startswith("[")][0]
    dp = [l.split("=", 1)[1].strip() for l in text.splitlines() if l.startswith("DataPath=")][0].removeprefix("./")
    # a directory (texts, commentaries — slash or not), else a file prefix (lexicons)
    d = dp.rstrip("/") + "/" if os.path.isdir(os.path.join(root, dp)) else dp.rsplit("/", 1)[0] + "/"
    dav = f"{rv.BASE}/remote.php/dav/files/{user}"
    acc = f"Phos/Module/{name}"
    for p in ["Phos", "Phos/Module", acc] + [acc + "/" + "/".join(d.strip("/").split("/")[:i + 1]) for i in range(len(d.strip("/").split("/")))]:
        raw("MKCOL", f"{dav}/{p}", user, pw)
    files = []
    for f in sorted(os.listdir(os.path.join(root, d))):
        full = os.path.join(root, d, f)
        if not os.path.isfile(full):
            continue
        data = open(full, "rb").read()
        st, _ = raw("PUT", f"{dav}/{acc}/{d}{f}", user, pw, data)
        assert st in (201, 204), (st, f)
        files.append({"p": d + f, "s": len(data), "h": "x"})
    return name, {"name": name, "confFile": conf_name, "conf": text, "files": files,
                  "total": sum(f["s"] for f in files), "cipher": False}


user = args.user or f"web{uuid.uuid4().hex[:6]}"
pw = args.password or "Web-pw-" + uuid.uuid4().hex
if not args.password:   # an existing user keeps their password
    rv.ensure_user(user, pw)
rv.call("GET", "/apps/phos/api/v1/status", user, pw)
hlc = "1791200000000-0000-bbbbbbbbbbbbbbbb"
changes = []
confs = [] if args.password else [(FIX, c) for c in ("tinyz.conf", "tinyplan.conf", "tinylex_zld.conf")]
if args.sword:
    want = {m.strip().lower() for m in args.modules.split(",") if m.strip()}
    for c in sorted(os.listdir(os.path.join(args.sword, "mods.d"))):
        lines = open(os.path.join(args.sword, "mods.d", c), encoding="utf-8", errors="replace").read().splitlines()
        head = next((l.strip() for l in lines if l.strip().startswith("[")), "[]")
        if head[1:-1].lower() in want:
            confs.append((args.sword, c))
for i, (root, c) in enumerate(confs):
    name, payload = upload_from(root, user, pw, c)
    changes.append({"changeId": uuid.uuid4().hex, "type": "module", "key": f"module:{name}", "op": "upsert", "hlc": hlc, "payload": payload})
changes += [
    {"changeId": uuid.uuid4().hex, "type": "label", "key": "label:Gebet", "op": "upsert", "hlc": hlc,
     "payload": {"name": "Gebet", "color": "#e5a50a", "style": "fill", "iconId": "bookmark", "favorite": False, "actionBar": False, "autoAssign": False}},
    {"changeId": uuid.uuid4().hex, "type": "bookmark", "key": "bm:seed1", "op": "upsert", "hlc": hlc,
     "payload": {"id": "seed1", "kind": "verse", "bookOsis": "Gen", "bookIdx": 0, "chap": 1, "vStart": 1, "vEnd": 1,
                 "labelNames": ["Gebet"], "noteMd": "Am **Anfang** steht Gott.", "sortOrder": 0, "created": 1791200000, "modified": 1791200000}},
    {"changeId": uuid.uuid4().hex, "type": "bookmark", "key": "bm:seed2", "op": "upsert", "hlc": hlc,
     "payload": {"id": "seed2", "kind": "verse", "bookOsis": "John", "bookIdx": 42, "chap": 3, "vStart": 16, "vEnd": 16,
                 "labelNames": ["Gebet"], "sortOrder": 1, "created": 1791200001, "modified": 1791200001}},
    {"changeId": uuid.uuid4().hex, "type": "setting", "key": "setting:General.DefaultBible", "op": "upsert", "hlc": hlc,
     "payload": {"value": "TINYZ"}},
]
st, data = rv.call("POST", "/apps/phos/api/v1/push", user, pw, {"device": "bbbbbbbbbbbbbbbb", "changes": changes})
assert all(r["status"] == "accepted" for r in data["results"]), data
print(json.dumps({"user": user, "password": pw}))
