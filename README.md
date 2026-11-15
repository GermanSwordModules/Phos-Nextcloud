# Phos for Nextcloud

Nextcloud app `phos`: the server side of the [Phos](https://github.com/GermanSwordModules)
Bible study app, plus a web UI that runs inside Nextcloud.

Phos keeps its data on the desktop (Free Pascal/Lazarus) and on the phone (Kotlin
Multiplatform). This app makes a Nextcloud instance the hub between them:

- **Sync** of bookmarks, notes, labels and study pads, reading plans and positions,
  workspaces, settings, study projects, exegeses, sermons, presentations and bibliography.
  Changes go through a journal with revisions and a hybrid logical clock; the server merges
  (field-wise or diff3 for text), keeps conflicts instead of dropping anything, and honours
  per-device "local only" data. Offline for weeks is the normal case, not an error.
- **Files**: SWORD modules, e-books and presentation media live as ordinary files under
  `Phos/` in the user's Nextcloud files, so quota, backup, versioning and the regular
  Nextcloud clients apply.
- **Sharing** of collections with Nextcloud users, groups and teams (read/write/admin),
  with notifications, plus anonymous read-only links.
- **Web UI** (Nextcloud → Phos): read the Bible with parallel texts, Strong's numbers,
  footnotes and cross-references, versification mapping between translations; commentaries,
  dictionaries, general books with images; server-side Bible search with a graphical query
  builder; facts pages per topic; gospel synopsis; word study; bookmarks, notes and study pads;
  reading plan for today; write sermons; read projects and exegeses; play presentations
  (reveal.js) with presenter view and phone remote; read ePub and PDF; manage devices and
  resolve conflicts. Light/dark/sepia theme shared with desktop and mobile. German and English.

The Bible text is read **in PHP** directly from the synced SWORD module files
(zText/zCom, RawText/RawCom, zLD/RawLD/RawLD4, GenBook, Sapphire-encrypted modules). No
libsword, no binaries, no external services on the server.

## Requirements

Nextcloud 30–34, PHP 8.1 or newer. Any database Nextcloud supports.

## Installation

Download `phos-<version>.tar.gz` from the
[releases](https://github.com/GermanSwordModules/Phos-Nextcloud/releases), unpack it into
`custom_apps/` and run `occ app:enable phos`. The archive contains the built frontend; the
server needs neither Node nor Composer. Nextcloud App Store listing is planned, see
[docs/release.md](docs/release.md).

Then, in Phos desktop: *Einstellungen → Nextcloud* and log in. The first sync shows a preview of
what would be uploaded and downloaded before anything is written.

## Documentation

- [docs/protocol.md](docs/protocol.md): the sync protocol (normative), with
  [protocol/types.json](protocol/types.json) (merge policy per record type) and the conformance
  vectors in [protocol/vectors/](protocol/vectors/) that every implementation has to pass.
- [docs/PLAN.md](docs/PLAN.md): design and the work packages that got the app where it is.
- [docs/entwicklung.md](docs/entwicklung.md): development environment, test setup, pitfalls.
- [docs/release.md](docs/release.md): building the release archive, App Store publishing.
- [CHANGELOG.md](CHANGELOG.md), [docs/credits.md](docs/credits.md).

## Development

```sh
npm ci && npm run build   # web frontend src/ → js/ (needed before the app shows up)
dev/compose.sh up         # podman: Nextcloud on http://127.0.0.1:8090 (admin / phos-dev-pw), app mounted
dev/compose.sh test       # PHPUnit + protocol vectors over HTTP + concurrency check
dev/compose.sh web        # JS unit tests + web sync engine against the server + Playwright smoke test
dev/compose.sh occ …      # occ inside the container
```

Layout:

- `lib/Sync/`: framework-free protocol core (HLC, merge, SyncService) that the vectors drive
  directly. `lib/Db/` stores it in the Nextcloud database. `lib/Controller/` is the OCS API
  (`/ocs/v2.php/apps/phos/api/v1/…`).
- `lib/Service/Sword/`: SWORD module readers in PHP. `lib/Service/` also holds search index,
  collections/sharing, facts and synopsis data.
- `src/`: Vue 3 frontend with `@nextcloud/vue`. `src/sync/` makes the browser one more sync
  device (own HLC, outbox in localStorage, `/push` + `/changes`); `src/bible/` parses references
  and renders OSIS/ThML/TEI through a whitelist.
- `facts-bundle/`, `syntax-bundle/`, `qb-bundle/`: self-contained HTML/JS tools shared with
  the desktop app, copied in by `dev/sync-*-assets.js`.
- `tests/`: PHPUnit, integration scripts against a running instance, JS unit tests, Playwright.

CI runs PHPUnit on PHP 8.2–8.4 and the HTTP integration tests against `nextcloud:stable`.

## What comes from other repositories

The desktop app lives in a separate repository (working name `BVC`, which is why that name
shows up in scripts and docs here). These parts of this repo are not written here but copied or
generated from it, and are only ever changed there:

| Here | From | How |
|---|---|---|
| `facts-bundle/`, `data/facts/` | desktop `web/facts/`, `data/topic-*` | `dev/sync-facts-assets.js` |
| `syntax-bundle/` | desktop `web/syntax/` | `dev/sync-syntax-assets.js` |
| `qb-bundle/` | desktop `web/querybuilder/` | `dev/sync-qb-assets.js` |
| `src/docs/themes.js`, `src/docs/phos-deck.css` | desktop presentation themes and `phos.css` | `dev/sync-desktop-assets.js` |
| `src/synopsis/pericopes.json` | desktop `data/compositeGospel.1.2.xml` + German titles | `dev/gen_synopsis.py` |
| `lib/Service/Sword/v11n.json`, `v11n-maps.json` | libsword `canon_*.h` | `dev/gen_v11n.py` |

The sync protocol, the PHP SWORD readers and the Vue frontend are written in this repo. The
desktop and mobile clients implement the same protocol (`docs/protocol.md`).

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). Third-party data and the sources of the bundled
fixtures are listed in [docs/credits.md](docs/credits.md).
