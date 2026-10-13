#!/usr/bin/env python3
"""New members get one Nextcloud notification; it goes away with their access.

    tests/integration/notifications.py http://127.0.0.1:8090 admin phos-dev-pw
"""
import sys, os, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_vectors as rv  # noqa: E402

run = uuid.uuid4().hex[:6]
alice, bob = f"nt{run}-alice", f"nt{run}-bob"
pw = {alice: "Nt-pw-" + uuid.uuid4().hex, bob: "Nt-pw-" + uuid.uuid4().hex}
for u in (alice, bob):
    rv.ensure_user(u, pw[u])
    rv.call("GET", "/apps/phos/api/v1/status", u, pw[u])

fails = 0
def check(ok, what):
    global fails
    print(("  ok   " if ok else "  FAIL ") + what)
    fails += 0 if ok else 1

def notes(u):
    st, data = rv.call("GET", "/apps/notifications/api/v2/notifications", u, pw[u])
    return [n for n in (data if isinstance(data, list) else []) if n.get("app") == "phos"]

st, data = rv.call("POST", "/apps/phos/api/v1/collections", alice, pw[alice], {"name": "Hauskreis"})
coll = data["id"]
rv.call("POST", f"/apps/phos/api/v1/collections/{coll}/members", alice, pw[alice], {"type": "user", "id": bob, "perm": "read"})
n = notes(bob)
check(len(n) == 1 and "Hauskreis" in n[0]["subject"] and n[0]["object_id"] == coll, f"bob is told ({len(n)})")
check(notes(alice) == [], "the sharer is not")
rv.call("POST", f"/apps/phos/api/v1/collections/{coll}/members", alice, pw[alice], {"type": "user", "id": bob, "perm": "write"})
check(len(notes(bob)) == 1, "a changed permission is no news")
rv.call("DELETE", f"/apps/phos/api/v1/collections/{coll}/members/user/{bob}", alice, pw[alice])
check(notes(bob) == [], "gone with the access")
print("OK" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
