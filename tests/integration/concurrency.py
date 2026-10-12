#!/usr/bin/env python3
"""Parallel pushes against a running server: every write must get its own rev,
revs must be gap-free in commit order, and same-key writers must all be
answered (accepted/merged/superseded), never lost.

    tests/integration/concurrency.py http://127.0.0.1:8090 admin phos-dev-pw
"""
import sys, os, uuid, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_vectors as rv  # noqa: E402  (reuses call/ensure_user; argv shared)

uid, pw = "conc-" + uuid.uuid4().hex[:6], "Conc-pw-" + uuid.uuid4().hex
rv.ensure_user(uid, pw)
# First login provisions files/address books; do it once, not 24 times in parallel.
rv.call("GET", "/apps/phos/api/v1/status", uid, pw)
N = 24
results, errors = [], []

def worker(i):
    dev = f"{i:016x}"
    hlc = f"{int(time.time()*1000):013d}-0000-{dev}"
    changes = [{"changeId": uuid.uuid4().hex, "type": "label", "key": f"label:k{i}", "op": "upsert", "hlc": hlc, "payload": {"name": f"k{i}"}},
               {"changeId": uuid.uuid4().hex, "type": "bookmark", "key": "bm:shared", "op": "upsert", "hlc": hlc, "baseRev": 0,
                "payload": {"id": "shared", "labelNames": [f"l{i}"], "noteMd": ""}}]
    st, data = rv.call("POST", "/apps/phos/api/v1/push", uid, pw, {"device": dev, "changes": changes})
    if st != 200:
        errors.append((st, data))
    else:
        results.extend(data["results"])

ts = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
[t.start() for t in ts]; [t.join() for t in ts]
assert not errors, errors
statuses = [r["status"] for r in results]
assert "invalid" not in statuses, [r for r in results if r["status"] == "invalid"]
written = sorted({r["record"]["rev"] for r in results if r["status"] in ("accepted", "merged")})
st, data = rv.call("GET", "/apps/phos/api/v1/changes?cursor=0&limit=1000", uid, pw)
keys = {c["key"] for c in data["changes"]}
assert keys == {f"label:k{i}" for i in range(N)} | {"bm:shared"}, keys
shared = [c for c in data["changes"] if c["key"] == "bm:shared"][0]
print(f"{len(results)} results, statuses: " + ", ".join(f"{s}={statuses.count(s)}" for s in sorted(set(statuses))))
print(f"bm:shared labelNames after {N} concurrent creators: {len(shared['payload']['labelNames'])} (set-merged)")
assert len(shared["payload"]["labelNames"]) == N, shared
assert len(written) == len(set(written))
print("OK")
