# Phos-Nextcloud

Nextcloud app **phos**: sync server for the [Phos](https://github.com/GermanSwordModules) Bible
study app — bookmarks, notes, reading plans, study projects and SWORD modules across Phos
desktop, phos-mobile and (later) a web UI, with offline-safe merging.

- Plan: [docs/PLAN.md](docs/PLAN.md)
- Protocol (normative): [docs/protocol.md](docs/protocol.md), [protocol/types.json](protocol/types.json),
  conformance vectors in [protocol/vectors/](protocol/vectors/)

Requires Nextcloud 30–34, PHP ≥ 8.1. Pure PHP, no external services.

## Development

```sh
dev/compose.sh up      # podman: Nextcloud on http://127.0.0.1:8090 (admin / phos-dev-pw), app mounted
dev/compose.sh test    # PHPUnit + vectors over HTTP + concurrency check
dev/compose.sh occ …   # occ inside the container
```

Layout: `lib/Sync/` is the framework-free protocol core (HLC, merge, SyncService) that the
vectors drive directly; `lib/Db/` stores it in the Nextcloud database; `lib/Controller/` is the
OCS API (`/ocs/v2.php/apps/phos/api/v1/…`).
