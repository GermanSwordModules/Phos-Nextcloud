#!/usr/bin/env python3
"""Replays protocol/vectors/*.json over HTTP against a running Nextcloud with the
phos app (database-backed store, real OCS routing and JSON handling).

    tests/integration/run_vectors.py http://127.0.0.1:8090 admin phos-dev-pw

Each vector runs as a fresh user. Revs are global on a real server, so the
first rev a vector sees defines an offset applied to every expected rev,
cursor and baseRev. Vectors that move the server clock ("now" steps), set the
GC horizon or depend on clamping against the vector's fixed "now" can only run
in the unit suite and are skipped here.
"""
import base64, json, glob, os, sys, urllib.request, urllib.error, uuid

BASE, ADMIN, ADMIN_PW = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = sorted(glob.glob(os.path.join(HERE, "..", "..", "protocol", "vectors", "*.json")))
SKIP_KEYS = {"conflictId", "id", "collection"}


def call(method, path, user, pw, body=None, ocs="v2"):
    url = f"{BASE}/ocs/{ocs}.php{path}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("OCS-APIRequest", "true")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)["ocs"]["data"]
            except (ValueError, KeyError):
                raise AssertionError(f"{method} {path}: not an OCS JSON answer: {raw[:300]!r}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)["ocs"]["data"]
        except Exception:
            return e.code, raw.decode(errors="replace")[:500]
    except (urllib.error.URLError, ConnectionError) as e:
        raise AssertionError(f"{method} {path}: server not reachable ({e})")


def ensure_user(uid, pw):
    st, data = call("POST", "/cloud/users", ADMIN, ADMIN_PW, {"userid": uid, "password": pw})
    # 400 with "User already exists" is fine on reruns; anything else is a setup problem
    # (password policy, provisioning disabled, …) and must not surface as a vector failure.
    if st != 200 and "exists" not in json.dumps(data):
        raise AssertionError(f"creating test user {uid} failed: HTTP {st} {data}")
    return st


def canon(x):
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def match(exp, act, path, off):
    if isinstance(exp, dict):
        assert isinstance(act, dict), f"{path}: expected object, got {act!r}"
        for k, e in exp.items():
            if k in SKIP_KEYS:
                continue
            assert k in act, f"{path}.{k} missing in {canon(act)}"
            if k == "payload":
                assert canon(e) == canon(act[k]), f"{path}.payload: {canon(e)} != {canon(act[k])}"
            elif k in ("rev", "cursor") and isinstance(e, int):
                want = e + off if e > 0 else e
                assert act[k] == want, f"{path}.{k}: expected {want} (vector {e}), got {act[k]}"
            else:
                match(e, act[k], f"{path}.{k}", off)
        return
    if isinstance(exp, list):
        assert isinstance(act, list) and len(act) == len(exp), f"{path}: expected {len(exp)} items, got {canon(act)}"
        for i, e in enumerate(exp):
            match(e, act[i], f"{path}[{i}]", off)
        return
    assert exp == act, f"{path}: expected {exp!r}, got {act!r}"


def needs_unit_suite(v):
    return any("now" in s or "gcHorizon" in s for s in v["steps"]) or v["name"].startswith("19-")


def run(path, run_id):
    v = json.load(open(path))
    if needs_unit_suite(v):
        return "skip"
    users = {}
    off = None
    last_conflict = None
    for i, step in enumerate(v["steps"]):
        name = step.get("uid", "alice")
        uid = f"vt{run_id}-{v['name'][:2]}-{name}"
        if uid not in users:
            users[uid] = "Vector-pw-" + uuid.uuid4().hex
            ensure_user(uid, users[uid])
        pw = users[uid]
        where = f"{v['name']} step {i}"
        if "push" in step:
            changes = []
            for c in step["push"]["changes"]:
                c = dict(c)
                c["changeId"] = run_id + "-" + c["changeId"]
                if off is not None and c.get("baseRev", 0) > 0:
                    c["baseRev"] += off
                changes.append(c)
            st, data = call("POST", "/apps/phos/api/v1/push", uid, pw, {"device": step["push"]["device"], "changes": changes})
            assert st == 200, f"{where}: HTTP {st} {data}"
            res = data["results"]
            for r in res:
                r["changeId"] = r["changeId"][len(run_id) + 1:] if r.get("changeId", "").startswith(run_id) else r.get("changeId")
                if "conflictId" in r:
                    last_conflict = r["conflictId"]
            if off is None:
                for r in res:
                    if "record" in r and r["record"]:
                        off = r["record"]["rev"] - 1
                        break
            actual = res
        elif "pull" in step:
            p = step["pull"]
            cur = p.get("cursor", 0)
            if cur > 0:
                cur += off or 0
            q = f"?cursor={cur}&limit={p.get('limit', 500)}"
            if "types" in p:
                q += "&types=" + ",".join(p["types"])
            st, actual = call("GET", "/apps/phos/api/v1/changes" + q, uid, pw)
            assert st == 200, f"{where}: HTTP {st} {actual}"
        elif "get" in step:
            st, data = call("GET", "/apps/phos/api/v1/changes?cursor=0&limit=1000", uid, pw)
            hits = [r for r in data["changes"] if r["type"] == step["get"]["type"] and r["key"] == step["get"]["key"]]
            actual = hits[0] if hits else None
        elif "conflicts" in step:
            st, data = call("GET", "/apps/phos/api/v1/conflicts", uid, pw)
            actual = data["conflicts"]
        elif "resolve" in step:
            body = {"use": step["resolve"]["use"]}
            if "payload" in step["resolve"]:
                body["payload"] = step["resolve"]["payload"]
            st, data = call("POST", f"/apps/phos/api/v1/conflicts/{last_conflict}/resolve", uid, pw, body)
            assert st == 200, f"{where}: HTTP {st} {data}"
            actual = data["record"]
        else:
            raise AssertionError(f"{where}: unknown step")
        if "expect" in step:
            match(step["expect"], actual, where, off or 0)
    return "ok"


def main():
    run_id = uuid.uuid4().hex[:6]
    ok = skip = 0
    failed = []
    for p in VECTORS:
        try:
            r = run(p, run_id)
            if r == "skip":
                skip += 1
            else:
                ok += 1
        except AssertionError as e:
            failed.append(str(e))
    for f in failed:
        print("FAIL", f)
    print(f"{ok} passed, {len(failed)} failed, {skip} unit-suite only")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
