# Phos Sync Protocol v2 (Nextcloud app)

Status: **normative** for the server (`lib/Sync/`), Phos Desktop (`unit_ncsync_*`)
and phos-mobile (`org.phos.mobile.sync.nextcloud`). The executable part of this
spec is `protocol/types.json` plus the conformance vectors in
`protocol/vectors/` — when prose and vectors disagree, the vectors win and the
prose gets fixed.

## 1. Overview

- The server stores **records**: one JSON payload per `(collection, type, key)`.
- Every write gets a **rev** from one global, strictly increasing journal
  sequence. A client remembers the highest rev it has seen (**cursor**) and
  asks for everything newer.
- Clients send local edits together with the rev they were based on
  (**baseRev**). If somebody else wrote in between, the **server merges**
  (§5). Clients never merge themselves; they only detect what changed locally,
  push it and adopt what the server answers.
- Time is a **hybrid logical clock** (§3), never the bare wall clock.
- Big/binary content (SWORD modules, e-books, attachments) is *not* a record
  payload; a manifest record points to files in the user's Nextcloud Files
  under `Phos/` (transferred with plain WebDAV / chunked upload).

The payload of each type is the object the Phos desktop already writes to disk
(e.g. one entry of `bookmarks.json`, schema 1), so Phos-Sync v1 snapshots
(`{key, op, ts, value}`) map 1:1: `value` → `payload`, `op` → `op`, `ts` → the
physical part of `hlc`.

## 2. Transport & auth

- OCS API, base `/ocs/v2.php/apps/phos/api/v1`, header `OCS-APIRequest: true`,
  `Accept: application/json`. Responses are wrapped in the usual
  `{"ocs":{"meta":…,"data":…}}`; below only `data` is shown.
- Auth: Basic auth with a Nextcloud **app password**, obtained via Login
  Flow v2 (`/index.php/login/v2`). Phos desktop already has this in
  `unit_dav.pas` (`NextcloudLoginStart/Poll`).
- Payload limit: 1 MiB per record (`413`-style per-change error `tooLarge`).

## 3. Hybrid logical clock

Format: `<ms:13 digits>-<counter:4 hex>-<deviceId:16 hex>`, e.g.
`1791196986000-0000-7bf7d9b698e112f5`. Plain string comparison orders HLCs
(ms first, then counter, then device id as deterministic tie-break).

Client rules (standard HLC):

- **local event**: `ms' = max(ms, now)`; if `ms' == ms` then `counter+1` else
  `counter = 0`.
- **receive** (every record pulled or returned by a push): `ms' = max(ms,
  remote.ms, now)`, counter bumped accordingly — so a later local edit always
  sorts after everything the device has seen, regardless of its wall clock.
- Persist the clock; never go backwards.

Server rule: an incoming HLC whose `ms` lies more than **5 minutes** in the
server's future is **clamped** to `<serverNow>-0000-<deviceId>` before any
comparison. The returned record carries the hlc actually stored. This stops a
device with a broken clock from winning every last-write-wins comparison
forever.

## 4. Data model

```jsonc
// Record (as returned by the server)
{
  "collection": "c0ffee…uuid",   // personal collection unless shared (phase 2)
  "type": "bookmark",
  "key": "bm:6A168692-F30E62E0",
  "rev": 42,                     // journal sequence of the last write
  "hlc": "1791196986000-0000-7bf7d9b698e112f5",
  "device": "7bf7d9b698e112f5",  // device that produced this version
  "deleted": false,              // tombstone
  "payload": { … }               // null when deleted
}
```

Keys follow Phos-Sync v1: `bm:<id>`, `label:<name>` (labels are matched **by
name**; integer label ids are device-local), `setting:<section>.<key>`,
`plan:<module>`, `ws:<id>` (until 2026-10: `ws:<name>`), `pos:mod:<module>` / `pos:ebook:<ref>` (books), `pos:bible` (phones only: `{moduleName, bookOsis, chapter}`), `project:<uuid>`, … The key is opaque to the
server; `type` decides the merge policy.

Each user owns exactly one `personal` collection, created on first use. A
client may omit `collection` on push to mean "my personal collection".

## 5. Merge policies

`protocol/types.json` assigns each type a policy. Unknown types use `lww`.

Definitions: **mine** = the pushed change, **theirs** = the server's current
record, **base** = the server's stored version at `baseRev` (history keeps the
last 50 versions per record; a missing base counts as `{}` / absent).

Processing a pushed change:

1. `changeId` already processed → status `duplicate`, current record returned.
2. Record absent → stored as sent (`accepted`). A `delete` for an absent
   record is stored as a tombstone.
3. Mine equals theirs (same `deleted`, canonically equal payload) → `accepted`,
   **no new rev** (prevents echo churn).
4. `baseRev == theirs.rev` → stored as sent (`accepted`).
5. Otherwise the record changed concurrently — apply the type's policy:

### `lww` — last writer wins
Higher hlc wins. Mine wins → `accepted`. Theirs wins → `superseded` (server
keeps its record and returns it). Deletes are ordinary versions: an edit with
a higher hlc than a delete resurrects the record, a later delete wins over an
older edit.

### `fields` — three-way merge per top-level field
If either side is deleted → `lww`. Otherwise, for every top-level field `f`
present in base, mine or theirs (absent = `null`):

| situation | result |
|---|---|
| mine[f] == theirs[f] | that value |
| mine[f] == base[f] | theirs[f] |
| theirs[f] == base[f] | mine[f] |
| both changed, `f` listed in `sets` | `(mine ∩ theirs) ∪ (mine − base) ∪ (theirs − base)`, order: theirs first, then new items of mine |
| both changed, `f` listed in `text` | line-based diff3 (§6); overlap → **conflict** |
| both changed, `f` listed in `opaque` | **conflict** (formats like RTF must not be merged line by line) |
| both changed, other | value of the side with the higher hlc |

Equality is canonical JSON equality (object keys sorted recursively). A
missing field is distinct from `null`: a field one side removed and the other
left unchanged is removed from the result.

Status: result == mine → `accepted` (stored as sent); result == theirs →
`superseded`; else `merged` (new rev, merged payload returned). The stored hlc
is `max(mine.hlc, theirs.hlc)`.

If any text field conflicts, the server **keeps theirs unchanged** for the
whole record, stores the complete pushed payload as a conflict
(`/conflicts`) and answers `conflict` with the conflict id. Text is never
silently lost; the user resolves it.

## 6. Text merge (diff3)

- Split on `\n`. Compute base→mine and base→theirs as hunks
  (`[baseStart, baseEnd) → replacement lines`) from a longest common
  subsequence.
- Hunks of the two sides **overlap** when `a.start <= b.end && b.start <=
  a.end`. This includes real intersections, two insertions at the same
  position and hunks that merely touch (conservative, like git).
- Overlapping hunks are grouped transitively (a hunk overlapping either side
  of a group joins it).
- Non-overlapping hunks are applied in order. An overlapping group is fine if
  both sides produce identical lines for the group; otherwise → conflict.

## 7. Endpoints

### `GET /status`
`{ "apiVersion": 1, "serverTime": <ms>, "personalCollection": "<uuid>",
   "types": <types.json>, "gcHorizon": <rev> }`

### `POST /devices`
Body `{ "id": "<16 hex>", "name": "Arbeits-PC", "platform": "linux",
"appVersion": "0.2.0" }` → device. Re-posting renames/updates. `GET /devices`
lists, `DELETE /devices/{id}` forgets one. Push/pull from an unregistered id
auto-registers it.

### `GET /changes?cursor=<rev>&limit=<1..1000, default 500>&types=a,b&device=<id>`
Returns every record (in all collections the user can read) with
`rev > cursor`, ascending by rev, each record once in its latest state:

`{ "changes": [Record…], "cursor": <rev of last item or input cursor>,
   "hasMore": bool, "resetRequired": bool }`

`resetRequired` is true when `0 < cursor < gcHorizon` — tombstones the client
never saw were purged; the client must re-read from cursor 0 and treat any
local record that is neither dirty nor on the server as deleted.

### `POST /push`
```jsonc
{ "device": "7bf7d9b698e112f5",
  "changes": [ { "changeId": "uuid", "collection": null, "type": "bookmark",
                 "key": "bm:…", "op": "upsert" | "delete",
                 "hlc": "…", "baseRev": 41, "payload": { … } } ] }
```
At most 500 changes. Answer, in the same order:
```jsonc
{ "results": [ { "changeId": "uuid",
                 "status": "accepted" | "merged" | "superseded" | "conflict"
                           | "duplicate" | "invalid" | "forbidden",
                 "record": Record,          // always present except invalid
                 "conflictId": 7,           // conflict only
                 "error": "…" } ] }         // invalid/forbidden only
```
Clients set their shadow to `record` for every status except `invalid`, and
overwrite the local item with `record.payload` unless the status is
`accepted`.

### `GET /conflicts`, `POST /conflicts/{id}/resolve`
List open conflicts (`id, collection, type, key, device, hlc, payload,
created`). Resolve with `{ "use": "server" }` (discard the losing version) or
`{ "use": "conflict", "payload": {…optional edited…} }` (written as a new
version). Both close the conflict. Unknown or already closed id → 404.

## 8. Client algorithm (informative)

Local sync state per device: **shadow** `(type,key) → {rev, hash, payload}`,
**cursor**, **hlc**, **outbox**.

One sync run:

1. **Detect**: ask every enabled adapter for its current items; compare with
   the shadow: new/changed hash → upsert, in shadow but gone locally → delete.
   Local-only items (`syncScope = local`, device-specific settings, caches) are
   never offered. Add to the outbox with `baseRev = shadow.rev` (0 if new) and
   a fresh local hlc. Outbox entries survive restarts; an item edited again
   before pushing just updates its entry (same changeId only if unchanged).
2. **Push** the outbox in batches; apply each result (§7) and drop the entry.
   Network error → stop, retry next run (changeIds make it idempotent).
3. **Pull** `GET /changes` from the cursor until `hasMore=false`. For each
   record: skip if `shadow.rev >= record.rev`; skip (leave for the next push)
   if the local item is dirty; otherwise apply it locally **with the record's
   own timestamps** (never "now") and update the shadow. Advance the cursor.
4. Feed every received hlc into the clock.

Because merging happens on the server at push time, a device can stay offline
for any length of time: its edits carry the rev they were based on, and the
server merges them against whatever happened meanwhile.

## 8a. Files

Large content is not a record payload. A *file set* (SWORD module, e-book
folder, a deck's media) travels as a manifest record
`{"files":[{"p":"<path>","s":<size>,"h":"<md5>"}], "total":…, …}`; the files
live in the user's Nextcloud Files below `Phos/<area>/<set>/<p>` and are moved
with plain WebDAV (chunked upload for big files). Receivers fetch what differs
from their copy. A record whose payload would exceed the limit is stored as a
file below `Phos/.records/<type>/` and sent as `{"$file": "<path>", "size":
…, "md5": …}`; receivers fetch and substitute it before applying.

## 11. Sharing (phase 2)

Every record belongs to a collection. Besides the personal one, a user can
create **shared collections** and add members — Nextcloud users, groups or
teams — with `read`, `write` or `admin` permission. The owner is always admin.

- `GET /collections` → `{collections:[{id, name, owner, ownerName, kind, perm, since}]}`
- `POST /collections` `{name}` → `{id}`; `PUT /collections/{collection}` `{name}`
  (admin); `DELETE /collections/{collection}` (owner; removes its records).
- `GET /collections/{collection}/members`; `POST …/members` `{type: user|group|team,
  id, perm}` (admin); `DELETE …/members/{type}/{id}` (admin, or yourself = leave).
- `GET /sharees?search=` — Nextcloud's sharee search (users, groups, teams).

Sync rules:
- `GET /changes` also returns `collections` (what the user can read now) and
  `joined`: collections access to which was granted after the given cursor.
  Their older records have smaller revs, so the client reads each joined
  collection once from 0 with `&collections=<id>`. The returned cursor steps
  past every grant, so a collection is reported as joined only once.
- A collection that disappears from `collections` was revoked: the client
  removes its local copies.
- Pushing into a collection without write permission → `forbidden`; when the
  user can read it, the current `record` is included so the client can undo
  the local edit.
- File sets (`module`, `ebook`, `presAssets`) in a shared collection are
  written by its owner only (others get `forbidden` + the record); `moduleKey`
  never enters a shared collection.
- Members read the files of a shared collection — which stay in the owner's
  storage — with `GET /index.php/apps/phos/files/<collection>/<path below Phos/>`
  (raw bytes, Basic auth). Allowed are only files of a live file-set record of
  that collection (`Module/<set>/…` etc.) and `.records/…` files named in one of
  its payloads.
- `"moveFrom": "<collection>"` on an upsert moves a record: after the write in
  the target collection, a tombstone is written in the source.

Notifications: adding a member who was not one before sends a Nextcloud
notification (app `phos`, object `collection/<id>`, subject `shared`) to that
user, or to every member of the group (teams: when Nextcloud can list a team's
members). Changing a member's permission sends nothing; removing a user member
or deleting the collection marks the notification processed. Clients show
newly joined collections themselves (`joined`/`collections` above).

## 12. Module reader (phase 3)

The server reads synced SWORD modules itself (PHP, `lib/Service/Sword/`, no
libsword): zText/zCom (2- and 4-byte sizes), RawText/RawCom (also 4), zLD,
RawLD, RawLD4, RawGenBook; compression ZIP (BZIP2 when PHP has it); versifications from
libsword's canon tables (`v11n.json`). Entries come back as stored (OSIS, ThML,
TEI …, after libsword's `prepText`), converted to UTF-8; rendering is the
client's job. All OCS, base `/ocs/v2.php/apps/phos/api/v1`:

- `GET /modules` → `{modules:[{name, description, kind: bible|commentary|dictionary|genbook|other,
  lang, direction, versification, sourceType, features[], options[], ciphered, locked,
  readingPlan, category, collection, size}]}` — every `module` record of the readable collections,
  each name once (own collection first).
- `GET /modules/{name}/books` → `{versification, books:[{osis, name, testament, verses:[per chapter]}]}`
  (books of the testaments the module has files for).
- `GET /modules/{name}/text/{osisBook}/{chapter}` → `{book, chapter, bookIntro, intro,
  verses:{n: markup}, links:{n: first}}` — `links`: verses sharing one entry
  with an earlier verse (commentaries); their text repeats the first one.
  `?as=<versification>` (W-3-C): the chapter counted in that system, filled from
  this module with libsword's mapping tables (`v11n-maps.json`, rule for rule like
  `VersificationMgr::System::translateVerse`) → additionally `refs:{n: "Ps.22.1"}`
  where the text comes from another place, `"Ps.22.0-1"` for a range. A verse whose
  mapped place is empty takes the same number when that verse is not shown elsewhere
  (modules declaring a versification their text does not follow).
- `GET /modules/{name}/search?q=&mode=all|any&books=&offset=&limit=` (W-4, Bibles and
  commentaries) → `{total, perBook:{osis: n}, terms:[word or prefix*], strongs:[G26],
  hits:[{book, chapter, verse, text: markup}], ms}`. Query: words (all must occur; `mode=any`:
  one is enough), `"a phrase"`, `prefix*` (≥ 2 letters), `-excluded`, `G26`/`H430` (Strong's).
  Words are folded: lower case, ß = ss, no diacritics (Greek accents, Hebrew points); notes and
  non-canonical titles are not searched. `books`: comma separated OSIS ids, `OT`, `NT`. The index
  is built on the first search per manifest revision (and cipher key) and kept in the app data
  (`search/`); 422 for an unsearchable query (`prefix too short`, `empty query`) or module.
- `GET /sermons/{osisBook}/{chapter}?names=a|b` → `{hits:[{module, description, kind, path |
  verse, ref, lead}]}` — sermon and devotional books (name/description/category/LCSH as the
  desktop's `LooksLikeSermon`; commentaries only for *Predigt/Andacht/Sermon/Devotion*) whose
  entries cite the chapter in their title or first 400 characters (genbooks; `names`: how the
  client writes the book), or the commentaries' entries on it. Reading plans excluded.
- `GET /media/{osisBook}/{chapter}?names=a|b` → `{hits:[{module, description, path, ref, lead,
  picture}]}` — entries of picture and map modules (`LooksLikeMedia`) citing the chapter that
  show a picture (`picture` as the markup names it; served by the file route below).
  Both keep an index of every entry's opening in the app data (`leads/`).
- `GET /modules/{name}/entry/{key}` → `{key, text}`; Strong's keys are padded
  as sword does (`G26` → `G0026`), and a prefixed number falls back to the bare
  one (`00026`). `@LINK` entries are followed.
- `GET /modules/{name}/keys?from=&limit=&before=` → `{keys:[…]}` (sorted, from the first key ≥ `from`;
  `before=1`: the keys right before it). `from` is padded like an entry key.
- `GET /modules/{name}/toc?path=` → `{path, children:[{name, path, children: bool}]}` — one level
  of a general book's contents (`/` = top level).
- `GET /modules/{name}/book?path=` → `{path, name, text, prev, next, trail:[path], children: bool}` —
  one entry of a general book; `prev`/`next` in reading order (depth first), `trail` = its
  ancestors; `/` = the first entry. Names match exactly, else case-insensitively.
- `GET /apps/phos/module/{name}/file?path=` (plain route, not OCS) → a picture of the module
  (jpg/png/gif/webp/bmp/svg), by the path its text names, relative to the module's data folder.
- `GET /modules/{name}/plan` → `{dateBased, days:[{day, date, passages:[osisRef], seq:[osisRef or text]}]}`
  for modules with `readingPlan: true` (AndBible `.properties`, plus Phos'
  `PhosReadingPlanText` companion). Progress is the user's `planProgress`
  record `plan:<name>` `{startDate, doneDays[], checks{day: [bool]}}`.
- `?collection=<id>` picks one copy when a name is readable from several collections.

Files are read in the collection owner's `Phos/Module/<name>/`. A ciphered
module needs the **reader's own** `moduleKey:<name>` record (personal
collection); without it the module is listed with `locked: true` and text
requests answer 422. Errors: 404 unknown module/entry, 422 unreadable
(locked, wrong key, no such chapter, files missing). Results are cached per
manifest revision (and per key for ciphered modules).

## 13. Deck media and phone remote (W-6)

**Media from elsewhere.** A deck's pictures outside its own folder and its
non built-in themes (with their background and logo files) are copied by the
desktop into `Phos/Praesentationen/<uuid>/_ext/` — part of the deck's
`presAssets` set — with `_ext/index.json`:
`{"files": {"<path as the deck names it, / separators>": "<file in _ext/>"}, "themes": {"<name>": <theme>}}`.
The deck keeps its original paths; readers fall back to the copy when the
original is not there. User themes themselves sync as `presTheme:<name>`
(the theme JSON, lww).

**Phone remote.** Per user, nothing shared (OCS, base as above):

- `POST /remote/state` from the presenting page: `{deck, title, idx, total, black, notes, slides[]}`; `{}` clears it.
- `POST /remote/cmd` from the phone: `{action: next|prev|first|last|goto|black, slide?}` → `{seq, action, slide, at}`.
- `GET /remote` → `{cmd, state, now}`; the presenting page applies commands with a `seq` above the last it saw.

## 14. Module lists of the devices

`moduleInventory:inv:<device id>` (personal, lww), written by each desktop:
`{device: "<device name>", modules: [{name, description, modDrv, lang, category, readingPlan}]}`
— every installed module (bundled Phos modules left out), online or not.
The web lists the ones that are not online greyed ("nur auf <device>"),
not readable. Desktops do not apply other devices' lists. The desktop's
library in turn shows modules that are only in the Nextcloud (its catalogue
of all `module` records, `ncsync-modcatalog.json`), greyed, with "Herunterladen".

## 9. Garbage collection

Background job daily: tombstones older than 180 days are purged and
`gcHorizon` is raised to the highest purged rev. Push-journal entries
(`changeId` dedupe) older than 30 days are pruned. History keeps 50 versions
per record.

## 10. Conformance vectors

`protocol/vectors/*.json`:

```jsonc
{ "name": "…", "description": "…", "now": 1791200000000,
  "steps": [
    { "push": { "device": "…", "changes": [ … ] },
      "expect": [ { "status": "accepted", "record": { "rev": 1 } } ] },
    { "pull": { "cursor": 0 }, "expect": { "cursor": 2, "changes": [ … ] } },
    { "get": { "type": "…", "key": "…" }, "expect": { "payload": { … } } }
  ] }
```

`expect` is matched as a **subset** (only listed fields are compared; arrays
compare element-wise and must have equal length). Revs start at 1 per vector.
`collection` may be omitted everywhere (personal collection).
