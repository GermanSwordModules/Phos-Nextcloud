# Phos ↔ Nextcloud: Sync, Teilen, Webfrontend

## Context

Phos synchronisiert heute über zwei **dateibasierte** Kanäle, beide ohne Server-Logik:

- **AndBible-Bridge** (`unit_andbible_sync.pas`): SQLite-Patch-Protokoll, nur Lesezeichen + Workspaces, fremdes Schema, viele Fallstricke (Patch-Zähler, createdTime-Ordnung, Baseline-Reset).
- **Phos-Sync v1** (`unit_phossync.pas` ↔ `phos-mobile/.../sync/phos/PhosSync*.kt`, WP-12/23/46/47): pro Gerät eine Snapshot-JSON pro Kategorie unter `<base>/phos-sync/<cat>/<deviceId>.json`, Einträge `{key, op, ts, value}`, Last-Write-Wins pro Key. Kategorien: settings, readingPosition, planProgress, workspaces, bookmarks.

Grenzen: kein Cursor (jeder Pull liest alle Snapshots), reine Wanduhr-Timestamps (Uhrdrift bei langem Offline-Arbeiten), LWW zerstört gleichzeitige Textänderungen an Notizen, keine Unterscheidung „lokal bleiben“ vs. „syncen“, keine Module/Dokumente/Projekte, kein Teilen mit anderen Nutzern, kein Web-Zugriff.

Ziel: Eine **Nextcloud-App „phos“** (Repo `../Phos-Nextcloud`, GermanSwordModules/Phos-Nextcloud, reine PHP-App, NC ≥ 30) als Sync-Server mit Änderungs-Journal, danach Teilen über Nextcloud-Nutzer/Gruppen/Teams, zuletzt ein basales Webfrontend. Clients: Phos Desktop (Free Pascal) und phos-mobile (Kotlin MP). **Die klassische AndBible-Synchronisierung bleibt als gleichberechtigte Option bestehen** (Abschnitt 5a), ebenso v1 (WebDAV-Ordner) für Nutzer ohne die App.

Entscheidungen (mit Nutzer geklärt): reine PHP-App ohne Docker/ExApp; **SWORD-Module werden vollständig als Dateien** synchronisiert; Mindestversion NC 30 (Vue 3, @nextcloud/vue 9, Teams/Circles).

---

## 1. Grundarchitektur

```
Phos Desktop ─┐                       ┌─ OCS-REST  /ocs/v2.php/apps/phos/api/v1/…
phos-mobile ──┼── HTTPS + App-Passwort ┤   (Records, Journal, Geräte, Shares)
Web (Vue)  ───┘   (Login Flow v2)      └─ WebDAV  /remote.php/dav/files/<u>/Phos/…
                                           (Moduldateien, Dokument-Blobs, Chunked Upload)
```

- **Strukturierte Daten** (Lesezeichen, Notizen, Labels, Positionen, Pläne, Workspaces, Settings-Teilmenge, Projekt-Metadaten …) → **Records** in App-eigenen DB-Tabellen mit Server-Revisionen und Änderungs-Journal.
- **Große/binäre Daten** (Module, E-Books, PDFs, Projekt-Anhänge, Präsentations-Medien) → **Dateien im Nextcloud-Files-Bereich des Nutzers** unter `Phos/` (Quota, Backup, Versionierung, Nextcloud-Dateifreigabe gratis). Ein Record (Manifest) verweist mit `path + sha256 + size` auf sie.
- Auth: vorhandenes `NextcloudLoginStart/Poll` in `unit_dav.pas:666/705` (Login Flow v2 → App-Passwort). Mobile: dasselbe Flow-Muster.
- Das Protokoll ist eine **Obermenge von Phos-Sync v1**: `{key, op, ts, value}` bleibt, neu kommen `type, collection, hlc, device, baseRev, changeId` dazu. Die v1-Codecs (`PhosSyncCodec.kt`, `BookmarkSyncCodec.kt`, Desktop-JSON-Shape aus `unit_bookmark_store_json.pas`) werden als Payload-Format wiederverwendet — kein drittes Schema.

### Repo-Layout `Phos-Nextcloud`

```
appinfo/info.xml, routes.php            # App-ID "phos", NC 30–32
lib/AppInfo/Application.php
lib/Controller/  SyncController, DeviceController, ModuleController,
                 BlobController, ShareController(P2), ReaderController(P3), PageController(P3)
lib/Db/          Record, RecordMapper, Change, ChangeMapper, Device, Collection, Member(P2), Conflict
lib/Service/     SyncService, MergeService (LWW/Feld/Text-3-Wege), HlcService,
                 TombstoneGc (BackgroundJob), ModuleIndexService, ShareService(P2),
                 Sword/ (P3: ZTextReader, ZComReader, RawLdReader, Versification, Sapphire)
lib/Migration/   Version000100Date…  (Tabellen)
src/             Vue-3-Webfrontend (P3)
docs/protocol.md + docs/schema/*.json  # normative Protokollspezifikation
tests/php/       PHPUnit (Unit + Integration gegen DB)
protocol/        types.json (Merge-Politik je Typ) + vectors/ (sprachneutrale Konformitäts-Testfälle)
dev/             podman-compose für Test-Nextcloud, seed-Skripte
```

Die `protocol/vectors/` werden von PHPUnit (direkt gegen `SyncService`) und per HTTP (`tests/integration/run_vectors.py`) abgespielt. **Gemergt wird ausschließlich auf dem Server** (Umsetzungsentscheidung NC-0): Clients erkennen Änderungen, pushen mit `baseRev` und übernehmen die Antwort — Pascal und Kotlin brauchen daher keine eigene Merge-Logik, nur HLC und Protokoll.

---

## 2. Datenmodell (Server)

| Tabelle | Inhalt |
|---|---|
| `phos_collections` | `id (uuid)`, `owner_uid`, `kind` (`personal` \| `shared`), `name`, `created` — jeder Nutzer hat ab P1 genau eine `personal`-Collection; P2 fügt geteilte hinzu. **Collection-Feld existiert ab Tag 1**, damit Teilen kein Schema-Bruch wird. |
| `phos_records` | `collection_id, type, key` (unique), `rev` (= Journal-seq der letzten Änderung), `hlc`, `device_id`, `deleted`, `payload` (JSON, LONGTEXT), `payload_hash`, `updated_by`, `updated_at` |
| `phos_record_history` | letzte N (Default 20) Payloads pro Record → **Merge-Basis** für 3-Wege-Merges und „Version wiederherstellen“ im Web |
| `phos_changes` | Journal: `seq` (autoincrement), `collection_id, type, key, rev`, `change_id` (Client-UUID, unique → idempotente Retries) |
| `phos_devices` | `id` (Client-DeviceId, 16 hex wie heute `[Sync] DeviceId`), `uid`, `name`, `platform`, `app_version`, `last_seen`, `last_cursor` |
| `phos_conflicts` | `collection_id, type, key, losing_payload, losing_device, hlc, resolved` |
| `phos_members` (P2) | `collection_id, principal_type (user/group/team), principal_id, perm (read/write/admin)` |

Record-`type`s (Keys in Klammern, an v1 angelehnt): `bookmark` (`bm:<id>`), `label` (`label:<name>`, Name-Matching wie v1), `note` (StudyPad/MyNotes-Dokumente), `readingPosition`, `planProgress`, `readingPlan`, `workspace`, `setting` (ein Record pro Key), `project`, `projectDoc` (notes/synthesis-Text), `pericope`/`exegesis`, `biblioEntry`, `presentation`, `printlibItem`, `ebook` (Manifest → Blob), `module` (Manifest → Dateibaum), `userData` (z. B. `topic-titles-de.user.csv`, eigene KI-Prompt-Overrides).

---

## 3. Sync-Protokoll v2

### 3.1 Zeit & Identität
- **Hybrid Logical Clock** statt reiner Wanduhr: `hlc = "<ms13>-<counter4>-<deviceId>"`, lexikographisch vergleichbar. Client übernimmt beim Pull `max(lokal, remote)` → ein Gerät mit falsch gehender Uhr oder nach Wochen offline kann keine neueren Änderungen „überholen“, Gleichstände sind deterministisch aufgelöst. `ts` (ms) bleibt für v1-Kompatibilität erhalten.
- Jede lokale Änderung bekommt eine `changeId` (UUID) → Push ist idempotent (Abbruch mitten im Upload ⇒ einfach wiederholen).

### 3.2 Endpunkte (OCS, JSON)
- `POST /devices` — Gerät registrieren/umbenennen; `GET /devices`, `DELETE /devices/{id}` (vergessene Geräte → Tombstone-GC freigeben).
- `GET /changes?cursor=<seq>&limit=500[&types=…]` → `{changes:[{type,key,collection,rev,hlc,deleted,payload}], cursor, hasMore, resetRequired}`. `resetRequired`, wenn der Cursor älter als die Tombstone-Aufbewahrung ist → Client macht Voll-Abgleich.
- `POST /push` — `{device, changes:[{changeId,type,key,collection,op,hlc,baseRev,payload}]}` → pro Eintrag `accepted(rev) | merged(rev,payload) | superseded(rev,payload) | conflict(rev,payload,conflictId) | forbidden`. Batch, transaktional pro Eintrag.
- `GET /snapshot?types=…` — Vollstand (Erst-Einrichtung, Reset).
- `GET/POST /conflicts`, `POST /conflicts/{id}/resolve`.
- Optional Live-Signal: Nextcloud **notify_push**, falls installiert (Event „phos_changed“); sonst Polling (Fokus-Wechsel + alle 5 min + Start/Ende).

### 3.3 Merge-Politik pro Typ (serverseitig in `MergeService`, identisch in den Vektoren)
1. **`baseRev == aktuelle rev`** → einfach übernehmen (Normalfall, auch nach langem Offline, wenn niemand sonst den Record angefasst hat).
2. Sonst je nach Typ:
   - **LWW-Record** (`readingPosition`, `planProgress`, `setting`, `workspace`, `label`): höhere `hlc` gewinnt; Verlierer → `superseded`.
   - **Feldweise 3-Wege** (`bookmark`, `project`, `biblioEntry`, `printlibItem`, `pericope`-Metadaten): Basis = `history[baseRev]`; Felder, die nur eine Seite änderte, werden zusammengeführt (z. B. Gerät A ändert Label-Zuordnung, Gerät B die Notiz → beides bleibt). Gleiches Feld beidseitig geändert → bei Skalaren hlc gewinnt, bei Textfeldern (`noteMd`) → Regel 3.
   - **Text-3-Wege** (`note`, `projectDoc`, `exegesis`, `noteMd`): zeilenbasiertes diff3 gegen die Basis; nicht überlappende Änderungen werden automatisch gemischt (`merged`). Überlappung → Server behält seine Version, die Client-Version wird als **Konflikt** gespeichert und an alle Geräte ausgeliefert; Desktop zeigt „Konflikt: Version von <Gerät>, <Datum>“ mit Übernehmen/Verwerfen/beides behalten. Nie stiller Datenverlust bei Text.
   - **Löschen vs. Bearbeiten**: Bearbeitung mit höherer hlc als der Löschvorgang stellt den Record wieder her (v1-Regel beibehalten). Löschungen sind Tombstones; GC nach 180 Tagen **und** erst wenn alle aktiven Geräte darüber hinaus sind (BackgroundJob `TombstoneGc`).
   - **Manifest-Typen** (`module`, `ebook`): höhere SWORD-`Version` bzw. neuere hlc gewinnt; alte Dateien bleiben in der Nextcloud-Versionierung.

### 3.4 Offline & verschiedene Stände (Client-Seite)
- Lokale Sync-DB `ConfigDir/ncsync.sqlite3` (Desktop) bzw. SQLDelight-Tabelle (Mobile) mit:
  - **Shadow**: pro `(type,key)` der zuletzt synchronisierte Payload + `rev` + Hash → liefert `baseRev` und die lokale Merge-Basis.
  - **Outbox**: ausstehende Änderungen (überlebt Neustarts beliebig lange).
  - Cursor, HLC-Zustand, Gerätename.
- **Änderungserkennung per Diff gegen Shadow** (wie die Workspace-Signaturen in `unit_andbible_sync`): Adapter liefert den aktuellen lokalen Stand, Sync vergleicht mit Shadow → Upserts/Deletes. Dadurch müssen nicht alle Stores instrumentiert werden; Stores mit echtem Lösch-Log (Lesezeichen) melden Deletes zusätzlich direkt.
- Ablauf eines Laufs: **Push Outbox → Antworten anwenden → Pull → nicht-dirty Records anwenden → Shadow/Cursor fortschreiben.** Lokal geänderte Records werden beim Pull übersprungen; der Server mergt sie beim nächsten Push gegen die History (kein Client-Merge). Beim Anwenden wird der Sender-Zeitstempel übernommen, nie „jetzt“ (WP-47-Bug).
- Bei Netzfehler einfach abbrechen; nächster Lauf setzt am Cursor/Outbox fort.

### 3.5 Was lokal bleibt
Drei Ebenen, alle in den Einstellungen sichtbar:
1. **Geräteeigene Einstellungen** werden nie synchronisiert: Fenstergeometrie, Pfade (SwordDir, DocumentsDir, Library-Folders), CEF/Ollama-URLs, DeviceId, Sync-Zugangsdaten, Caches. Umgesetzt als **Allowlist** der syncbaren Settings-Keys in einer Tabelle (Muster wie `DISP_TOGGLES` — eine Stelle, keine verstreuten Ausnahmen).
2. **Kategorie-Schalter pro Gerät** (Lesezeichen, Notizen, Projekte, Module, E-Books, …) — z. B. Module auf dem Laptop an, auf dem Arbeitsplatz-Rechner aus; bei Modulen zusätzlich Auswahl „alle / nur ausgewählte / nur Liste anzeigen“.
3. **Pro Datensatz „Nur auf diesem Gerät“**: Feld `syncScope` (`local` | `sync`) an Lesezeichen/Labels/Notizen/Projekten/Modulen. Ein Label „lokal“ macht alle damit verknüpften Lesezeichen lokal. Wird ein bisher synchronisierter Datensatz lokal gestellt, wird er auf dem Server gelöscht (Tombstone), lokal bleibt er.
- **Caches nie** (cef-cache, `*index.sqlite*`, `wordstudy-*`, `litcache`, `imgprev`, `textindex`, `syntax.sqlite`, `anatomy.sqlite`, `mapindex.sqlite3`, `lemmastats-*`, AndBible-State-Dateien).

---

## 4. Module & Dateien

- Ablage: `Phos/Module/<ModulName>/{mods.d/<x>.conf, modules/…}` — SWORD-Layout pro Modul, für Menschen lesbar, auch mit dem normalen Nextcloud-Desktop-Client nutzbar. E-Books: `Phos/E-Books/…`, Projekt-Anhänge: `Phos/Projekte/<uuid>/…`, Präsentations-Medien: `Phos/Präsentationen/…`.
- Record `module:<Name>` = Manifest `{name, version, source (Repo/URL oder „eigen“), conf(ohne CipherKey), files:[{path,sha256,size}], totalSize, distributionLicense, locked}`.
- Upload: Nextcloud **Chunked Upload v2** (`/remote.php/dav/uploads/…`), resumable, nur Dateien mit geändertem Hash. Erste Synchronisation von ~8 GB: Hintergrund-Job mit Fortschritt, Bandbreitenlimit, pausierbar; Reihenfolge: kleine/eigene Module zuerst.
- Download/Installation am Zielgerät: in Staging-Ordner laden → Hash prüfen → atomar nach `SwordDir` verschieben → **SWMgr-Reload auf dem Hauptthread** (libsword ist nicht threadsafe; Datei-I/O im Worker, SWORD-Zugriffe nie).
- Ausgenommen: mitgelieferte Phos*-Module (PhosGeo/PhosPerson/PhosWiki/PhosAtlas, `unit_bundledmodules`) und systemweite Module unter `/usr/share/sword`.
- `CipherKey` (heute direkt in die Modul-.conf geschrieben, `sword_api.pas:88`) ist ein **Geheimnis**: wird als privater `setting`-Record des Nutzers synchronisiert, nie im Manifest, nie beim Teilen.
- Deinstallation auf Gerät A → Tombstone; Gerät B entfernt das Modul **nicht automatisch**, sondern zeigt „auf anderem Gerät entfernt“ (Modulverlust ist teurer als ein überzähliges Modul).
- Vorhandene Installationsmechanik wiederverwenden: `sword_installmgr.pas` und die Package-Zip-Entpack-Logik (GermanSwordModules-Fallback).

---

## 5. Desktop-Integration (BVC)

### 5.0 Vorarbeiten Datenhygiene (Ergebnis der Store-Inventur)
- **Zeitstempel vereinheitlichen**: heute Unix-Sekunden (Lesezeichen), epoch-ms (Workspaces), locale-abhängiges `DateTimeToStr` (Projekte `unit_project.pas:873/1101/1189`, Perikopen `unit_pericope.pas:252`), lokale ISO-Zeit (Predigten `unit_sermon.pas:218`), TDateTime-Double (Präsentationen). → Neuer Helper `unit_synctime.pas` (`NowUtcMs`, `ParseLegacyStamp` liest alle Altformate), Stores schreiben künftig zusätzlich `modifiedMs` (UTC). `DateTimeToUnix(Now)` lokal-vs-UTC dabei prüfen.
- **Gemeinsamer UUID-Helper** `unit_uuid.pas` (heute `CreateGUID`+`GUIDToString` 6× kopiert, `NewUuidHex` in `unit_andbible_sync`).
- **Nicht portable Keys**: `reading-positions.txt` nutzt absolute ePub-Pfade → beim Export auf E-Book-`<ref>` abbilden; `icons.conf`, `[Rag]`-Pfade, Perikopen mit externem `DocPath` → gerätelokal.
- **Löschungen**: Stores führen kein Lösch-Log (nur Planer). Muss nicht nachgerüstet werden — die Shadow-Diff-Erkennung (3.4) erkennt „im Shadow, lokal weg“ als Delete.
- **Planer-App-Passwort** ist nur base64-verschleiert (`unit_config.pas:873`) → gemeinsam mit dem NcSync-Passwort in den Keyring.

Neue Units (prüfen, dass Namen frei sind — `ls`/`git ls-files` vorher):
- `unit_ncsync_proto.pas` — HLC, Records, JSON-(De)Serialisierung, Merge-Funktionen (dieselben Regeln wie `MergeService`, getestet mit `tests/vectors`).
- `unit_ncsync_client.pas` — OCS-Client auf `fphttpclient`/`opensslsockets` (gleicher Stil wie `TDavClient` in `unit_dav.pas`; dessen `Put/Get/Request` für WebDAV-Dateien direkt wiederverwenden).
- `unit_ncsync_store.pas` — `ncsync.sqlite3` (Shadow/Outbox/Cursor). SQLite-Gotchas beachten: `sqlite3dyn.SQLiteDefaultLibrary := 'libsqlite3.so.0'`, INTEGER-ms-Spalten über `CAST(... AS TEXT)` lesen (FPC kürzt auf 32 bit).
- `unit_ncsync_adapters.pas` — `TSyncAdapter`-Basisklasse (`TypeName`, `EnumerateLocal`, `ApplyRemote`, `ApplyDelete`, `MergePolicy`) + ein Adapter je Store (Liste unten).
- `unit_ncsync_engine.pas` — Ablauf aus 3.4 in einem `TBgJob` (`unit_bgjob.pas`); Anwenden auf Stores via `Synchronize`-freiem Muster wie `unit_planner_sync` (Ergebnis in `OnDone` anwenden — Job gibt sich selbst frei).
- Formulare (**.lfm, im Designer**): `unit_ncsync_settings` (Server, Anmelden via Login Flow, Gerätename, Kategorie-Schalter, Modulauswahl, Status/Log), `unit_ncsync_conflict` (Konfliktansicht mit Diff), `unit_ncsync_devices`.
- Einbindung in `unit1.pas`: bestehende Hooks `MaybeSyncPull` (Start) / `MaybeSyncPush` (`FormClose`, **nicht** `FormDestroy`) + Debounce-Push 30 s nach Änderungen + Statusanzeige in der Statusleiste (Wolke: synchron / läuft / offline / Konflikte).
- Konfiguration: `[NcSync] Enabled, Server, User, AppPassword, DeviceName, Categories, ModuleMode` in `bvc.conf` (unit_config); `DeviceId` aus `[Sync]` wiederverwenden. App-Passwort möglichst im Keyring (libsecret) — Fallback bvc.conf mit 0600.
- Nebeneinander der Kanäle: Ist NcSync aktiv, ersetzt es Phos-Sync v1 für dieselben Kategorien (keine Doppel-Pfade); AndBible-Bridge bleibt unabhängig und speist wie heute die lokalen Stores.

Adapter (Payload = jeweils das vorhandene lokale JSON-Objekt, damit nichts doppelt modelliert wird):

| Typ | Quelle | Granularität / Merge |
|---|---|---|
| `bookmark`, `label` | `unit_bookmark_store_json` → `ConfigDir/bookmarks.json` (enthält auch Vers-Notizen, Markierungen, StudyPad-Einträge) | pro Lesezeichen feldweise; `noteMd` Text-3-Wege; Labels per Name (lokale int-IDs) |
| `workspace` | `unit_workspace` → `workspaces.json` (Name als Key, `updatedAt`) | LWW; Fenster-/Sitzungszustand bleibt lokal |
| `readingPosition` | `unit_readingpos` → `reading-positions.txt` | LWW, Keys portabel gemacht (5.0) |
| `planProgress` | `unit_readingplan` → `readingplans.json` (pro Plan-Modul) | `doneDays`/`checks` als Mengen-Union, `startDate` LWW |
| `setting` | `unit_config` (Allowlist), `library_folders.conf` | LWW pro Key |
| `project`, `projectDoc`, `projectData` | `unit_project` → `projects/index.json`, `<uuid>/project.json` (Felder), `notes.rtf`/`synthesis.rtf` (Text, Konfliktkopie), `findings.json`, `occurrences.json` (bis MB-groß → als Datei), `project.bib` (wird generiert → nicht syncen) | gemischt |
| `pericope`, `exegesis` | `unit_pericope` → `DocumentsDir/exegesis/index.json`, `<uuid>.json`, `<uuid>.rtf` | Metadaten feldweise, RTF Konfliktkopie |
| `sermon` | `unit_sermon` → `DocumentsDir/sermons/<uuid>.json` | feldweise/Text |
| `presentation` | `unit_presentation` → `presentations/<uuid>.json` + Asset-Ordner (Dateien), Themes/Layouts/Templates per Name | Deck LWW pro Folie, Assets als Dateien |
| `biblioEntry` | `unit_biblio` → `ConfigDir/biblio/<modul>.bib` | pro BibTeX-Eintrag (Citekey) |
| `printlibItem` | `unit_printlib` → `DocumentsDir/printlib.json` | pro Buch (GUID) |
| `ebook` | `unit_ebooks` → `ConfigDir/ebooks/<ref>/` (Binärdatei + `book.conf`) | Manifest + Datei |
| `workflow`, `syntaxDiagram`, `userData` | `unit_workflows`, `DocumentsDir/syntax/`, `topic-titles-*.user.csv`, `base_modules.json` | LWW pro Datei |
| `module` | `SwordDir` (`~/.sword`) | Manifest + Dateien (Abschnitt 4) |

Bewusst **nicht** synchronisiert: Planer (läuft schon nativ über CalDAV/CardDAV derselben Nextcloud, inkl. `sync-base/`), Navigationsverlauf, `facts-recent.txt`, Piper-Stimmen, mitgelieferte Phos*-Module (`unit_bundledmodules` installiert sie pro Rechner), AndBible-State-Dateien, alle Caches.

Muster zum Wiederverwenden: Feldweiser 3-Wege-Merge + Konfliktobjekt `TPlanConflict` + Konfliktformular aus `unit_planner_sync.pas:456/485` / `unit_planner_conflict.pas`; HTTP-Arbeit im Thread, Anwenden in `ApplySyncResult` auf dem Hauptthread (heute laufen AndBible-/v1-Sync synchron im UI-Thread — der neue Sync nicht).

RTF-Dokumente (Projektnotizen, Synthese): Text-3-Wege-Merge auf RTF-Quelltext ist fragil → Merge auf Absatz-Ebene des extrahierten Klartexts nur zur Konflikterkennung; bei Überschneidung immer Konfliktkopie statt Auto-Merge.

## 5a. Verhältnis zur klassischen AndBible-Synchronisierung

**Die AndBible-Bridge bleibt vollwertig erhalten** — als eigenständige Option, unabhängig davon, ob NcSync aktiv ist. Drei gleichberechtigte Kanäle in *Einstellungen → Synchronisierung*:

| Kanal | Für wen | Daten |
|---|---|---|
| **AndBible-Sync** (`unit_andbible_sync`, unverändert im Protokoll) | Austausch mit der AndBible-App (Android/iOS) über deren Sync-Ordner in Nextcloud/Google Drive | Lesezeichen, Labels, Notizen, Workspaces |
| **Phos-Sync v1** (Ordner, `unit_phossync`) | Phos ↔ Phos ohne Nextcloud-App (beliebiger WebDAV/Sync-Ordner) | wie bisher |
| **Phos-Nextcloud** (neu) | Phos ↔ Phos/Web mit der App, inkl. Teilen | alles aus Abschnitt 2 |

Jede Kombination ist erlaubt; v1 und Phos-Nextcloud schließen sich nur *pro Kategorie* aus (gleicher Zweck). AndBible ist keine Phos-Instanz im Nextcloud-Verbund, sondern ein **externes System, das über die Bridge an die lokalen Stores andockt**; NcSync transportiert dann, was in den Stores steht. Die Bridge braucht deshalb **keine** Kenntnis vom Nextcloud-Server.

**Ablauf** (Reihenfolge fest, in `unit1` `MaybeSyncPull`/`MaybeSyncPush`):
Start: **NcSync-Pull → AndBible-Pull → NcSync-Push**. Ende (`FormClose`): NcSync-Push → AndBible-Push. Der NcSync-Pull muss *vor* dem AndBible-Pull laufen (Erkenntnis aus D-0): Nur wenn ein Lesezeichen mit Alt-ID schon per Nextcloud angekommen ist, erkennt der AndBible-Pull es über die abgeleitete UUID wieder; andersherum entstünde lokal eine Kopie unter der UUID. Als Sicherheitsnetz führt der NcSync-Lesezeichen-Adapter (D-1) ein eingehendes Lesezeichen mit Alt-ID und ein lokales mit `id == DerivedUuidHex('phos-bookmark', altId)` zusammen.

**Damit mehrere Phos-Geräte gleichzeitig „brücken“ dürfen, ohne Duplikate oder Ping-Pong** (heute ein reales Risiko):
1. **ID-Kollision beheben (Pflicht, vor NcSync):** `unit_andbible_sync.pas:1251` ersetzt beim AndBible-Push jede Nicht-UUID-Lesezeichen-ID durch eine *zufällige* UUID (`bm.Id := NewUuidHex`). Brücken zwei Phos-Geräte dasselbe Lesezeichen, entstehen zwei UUIDs → Duplikate in AndBible *und* (über die ID-Umbenennung) im NcSync. Lösung: neue Lesezeichen-IDs werden ab D-0 direkt als UUID-hex erzeugt (`unit_uuid`); für Alt-IDs wird die AndBible-UUID **deterministisch abgeleitet** (`md5(id)` als v4-geformtes hex) statt zufällig, und `bm.Id` wird nicht mehr umgeschrieben. Pull findet Alt-Lesezeichen über diese Ableitung wieder.
2. Von AndBible gezogene Lesezeichen behalten schon heute die AndBible-UUID als Phos-ID (`MergeBibleBookmarks`, `store.FindBookmark(uuid)`) → auf allen Phos-Geräten derselbe NcSync-Key, idempotent.
3. Labels laufen in allen drei Kanälen über den **Namen** → keine Kollision trotz lokaler int-IDs. Die AndBible-`labelMap` bleibt gerätelokal (Bridge-Zustand).
4. **Zeitstempel durchreichen, nie neu stempeln**: Was NcSync anwendet, behält `modified` des Senders; die AndBible-Push-Bedingung `Modified*1000 > LastSyncMs` schickt daher nur echte Neuigkeiten an AndBible, keine Echos. Umgekehrt gilt dasselbe für AndBible-Pulls (bestehende Regel).
5. **Workspaces**: AndBible-Workspace-UUIDs + Fenster-UUIDs liegen heute in `andbible-ws-sync-state.json` (pro Gerät). Sie wandern als Feld `andbible: {wsUuid, windowUuids[]}` in den `workspace`-Payload, damit ein zweites brückendes Phos-Gerät dieselben UUIDs wiederverwendet statt Duplikat-Workspaces zu erzeugen.
6. Lösch-Semantik: AndBible-Bridge emittiert für Lesezeichen weiterhin keine DELETEs (bestehende Einschränkung); ein in Phos gelöschtes Lesezeichen kann daher über AndBible zurückkommen. Optional in D-1 nachrüsten (LogEntry-DELETE), sonst dokumentieren.
7. Empfehlung in der UI (kein Zwang): „AndBible-Brücke auf einem Gerät aktivieren genügt“ — Mehrfach-Brücken sind nach 1–5 aber unschädlich.

**Optionale Ausbaustufe (nach Phase 1, AB-S):** serverseitige Bridge in der Nextcloud-App — PHP liest/schreibt die AndBible-Patches (`SQLite3`, `gzdecode`) im Nutzerordner per BackgroundJob, sodass Handy-Änderungen auch ohne laufenden Phos-Desktop im Verbund/Web ankommen. Portiert die bewährten Regeln aus `unit_andbible_sync` (Patch-Reihenfolge nach Server-createdTime, `device-known-*`-Marker, `user_version`, vollständiges v12/v22-Schema, `entityId2=''`, monotone Patch-Nummern, Baseline-Erkennung) und nutzt den vorhandenen Emulator-Prüfstand (AVD `phos-test`). Bis dahin bleibt die Bridge rein clientseitig.

**Tests**: `test_sync.lpr` (bestehend) + neue Szenarien im `test_ncsync`-Harness: zwei Phos-Geräte mit aktiver Bridge + simuliertem AndBible-Patch → genau ein Lesezeichen in AndBible-Ordner, NcSync und beiden lokalen Stores; Echo-Freiheit (zweiter Lauf erzeugt weder Patch noch Push).

## 6. Mobile-Integration (phos-mobile)
- Neues Paket `org.phos.mobile.sync.nextcloud` neben `sync/phos` und `sync/andbible`: Ktor-Client, Login Flow v2, SQLDelight-Tabellen für Shadow/Outbox/Cursor, Wiederverwendung von `PhosSyncCodec`/`BookmarkSyncCodec` als Payload-Codec.
- Kategorien zunächst die fünf aus v1, dann Notizen/StudyPads; Module optional (Speicherplatz) mit Einzelauswahl.

## 7. Migration
- Server-Endpunkt `POST /import/v1` bzw. Client-seitig: beim ersten Verbinden liest der Client die vorhandenen v1-Snapshots (`<base>/phos-sync/*/*.json`) und pusht sie mit ihren Original-`ts` als hlc → keine Neuzeitstempel, keine Überschreib-Kaskade.
- Erstverbindung eines zweiten Geräts mit vorhandenem lokalen Bestand: Pull-Snapshot zuerst, dann lokaler Bestand als Merge (nicht „lokal ersetzt Server“ oder umgekehrt); Dialog mit Zählung („124 neu, 3 Konflikte“) vor dem ersten Push.

---

## 8. Phase 2 — Teilen mit anderen Nutzern

- **Collections** werden teilbar: `ShareController` legt `shared`-Collections an, Mitglieder über Nextcloud-Sharee-Suche (Nutzer, Gruppen, Teams) mit Rechten `read`/`write`/`admin`. Rechte werden beim Push serverseitig geprüft (`forbidden` pro Eintrag); `GET /changes` liefert alle Collections, in denen der Nutzer Mitglied ist (Cursor bleibt global pro Nutzer, Journal-Query über Mitgliedschaften).
- **Was teilbar ist**: ein Label samt Lesezeichen/Notizen („Hauskreis Römerbrief“), Studienpads, Forschungsprojekte (inkl. Literatur, Exegesen), Präsentationen, Lesepläne (gemeinsam lesen; Fortschritt pro Mitglied optional sichtbar), Bibliographie-Sammlungen, Module.
- **Datensatz-Zugehörigkeit**: jeder Record gehört zu genau einer Collection; „In geteilte Sammlung verschieben“ = Delete in alter + Upsert in neuer Collection (serverseitig atomar per `move`-Op). Geteilte Labels heißen lokal `Name (Besitzer)`, um Name-Kollisionen beim Name-Matching zu vermeiden; Key für geteilte Labels wird `label:<collectionId>:<name>`.
- **Module teilen**: Ordner `Phos/Module/<Name>` wird per `OCP\Share\IManager` als Nextcloud-Dateifreigabe an die Mitglieder geteilt; Manifest-Record liegt in der geteilten Collection. **Lizenzprüfung**: `DistributionLicense` aus der .conf — Module mit nicht-freier Lizenz (Copyrighted ohne Weitergabeerlaubnis) und alle `locked`-Module können nicht geteilt werden (Server lehnt ab, UI erklärt warum). CipherKeys werden nie geteilt.
- Benachrichtigungen (`OCP\Notification`) bei neuer Freigabe; Activity-Einträge („X hat eine Notiz in ‚Hauskreis‘ geändert“).
- Desktop-UI: Teilen-Dialog (.lfm) aus Label-/Projekt-/Studienpad-Kontextmenü, Besitzer-Badge an fremden Einträgen, Read-only-Sperre im Editor bei `read`-Recht, Liste „Mit mir geteilt“ in der Seitenleiste.
- Konflikte zwischen Nutzern: identische Merge-Regeln; Konfliktkopie trägt Nutzername.
- Später: öffentliche Nur-Lese-Links (Web-Ansicht einer Sammlung/Präsentation).

## 9. Phase 3 — Basales Webfrontend

> Einstieg/Übergabe: `docs/phase3-kontext.md`.

- Vue 3 + `@nextcloud/vue` unter `/apps/phos/`, Navigation links (Bibel, Lesezeichen, Notizen, Studienpads, Leseplan, Geteilt), Nextcloud-Design/Darkmode.
- **Bibeltext ohne Server-Binärdateien**: PHP-SWORD-Leser in `lib/Service/Sword/` direkt auf den synchronisierten Moduldateien in `Phos/Module/` (über `IRootFolder`):
  - zText/zCom (`.bzs/.bzv/.bzz`, zlib via `gzuncompress`), RawText/RawCom, zLD/RawLD (Wörterbücher); GenBook später.
  - Versifikationen: Kanon-Tabellen aus libsword (`canon_*.h`) einmalig per Skript nach JSON/PHP generieren (KJV, Luther, German, Catholic, Synodal, …).
  - Sapphire-Entschlüsselung für eigene verschlüsselte Module mit dem privaten CipherKey.
  - Caching gerenderter Kapitel in `IAppData`/Memcache.
- OSIS/ThML → HTML im Browser (TypeScript-Port einer Teilmenge des Phos-Renderers: Überschriften, Fußnoten als Popover, Querverweise, Worte Jesu, Strong's-Attribute als Tooltip aus Strong's-Wörterbuchmodul), Phos-CSS-Variablen übernehmen.
- Funktionsumfang v1: Modulwahl, Buch/Kapitel-Navigation (Verseingabe wie `unit_verseref`), 2 Paralleltexte, Lesezeichen setzen/Label/Notiz bearbeiten (Markdown-Editor), Lesezeichen-/Notizliste mit Filter, Studienpads lesen/bearbeiten, „Heute lesen“ aus Leseplan, Konflikte auflösen, Geräteverwaltung. Alles schreibt über dieselbe `/push`-API (Web = eigenes „Gerät“ mit eigener HLC) — keine Sonderpfade.
- Später: Suche (zuerst in Notizen, Bibelsuche via vorab erzeugtem Index), Kommentar-Spalte, Präsentationen abspielen (reveal.js liegt bereits in Phos), Mobile-Webansicht.

---

## 10. Arbeitspakete & Reihenfolge

| # | Paket | Ergebnis |
|---|---|---|
| NC-0 ✅ | Spezifikation `docs/protocol.md`, JSON-Schemas, 30+ Testvektoren (offline-Divergenz, Uhrdrift, Delete-vs-Edit, Text-Überlappung, Feldmerge, Idempotenz, Tombstone-Reset) | normative Basis für alle drei Implementierungen |
| NC-1 ✅ | App-Gerüst, Migrationen, Dev-Container (`dev/compose.yml`, neuer Container `phos-nc-dev`, `phos-nc-test` unangetastet), CI (PHPUnit + psalm + eslint) | App installierbar, `occ app:enable phos` |
| NC-2 ✅ | Records/Journal/Devices, `/changes`, `/push`, `/snapshot`, HLC, MergeService, Konflikte, TombstoneGc | Server erfüllt alle Vektoren |
| D-0 ✅ | `unit_uuid`, `unit_synctime` (ISO-Zeitstempel in Projekten/Perikopen), AndBible-ID-Fix (5a.1: abgeleitete UUIDs für Lesezeichen und Labels, ID wird nicht mehr umgeschrieben), UUID-IDs für neue Lesezeichen; verifiziert mit `test_bridge` | AndBible-Bridge mehrgerätefest |
| D-1 ✅ | `unit_ncsync` (Engine, HLC, Schatten/Outbox/Zurückstellen, Massenlösch-Schutz, Hintergrund-Thread), `unit_ncsync_client`, `unit_ncsync_adapters` (Lesezeichen, Labels, Lesepositionen, Leseplan, Arbeitsbereiche, Einstellungen), `.lfm`-Einstellungsdialog, Hooks in `unit1`; verifiziert mit `test_ncsync` (29 Prüfungen) + GUI-Lauf mit Profilkopie | Desktop synchronisiert über Nextcloud |
| D-2 ✅ | Konfliktdialog, alle Dokument-Speicher, „Nur auf diesem Gerät“, Projekt-Ordner (BVC `7b5b228b`, `44a33ef8`, `765f3d99`; Server `77d59cf` Merge-Politik `opaque`) | alle Nutzerdaten |
| D-3 ✅ | Module, E-Books, Präsentations-Medien als Dateien über WebDAV (Chunked Upload), Manifeste mit md5, Hintergrund-Hasher/Transfer, Modulinstallation beim Start, CipherKey separat; Datensätze > 1 MB als Datei (BVC `9a0725f7`). Verifiziert: Harness 68 Prüfungen; 477 MB echte E-Books hoch (Abbruch + Fortsetzung) und auf zweitem Profil byte-identisch herunter. Nicht mit echten Modulen (8 GB) getestet | Module auf allen Geräten |
| M-1 | phos-mobile Nextcloud-Client (Kategorien aus v1, dann Notizen; Module optional) | Mobile im selben Verbund |
| MIG | v1-Import, Erstabgleich-Dialog | Bestandsdaten übernommen |
| S-1 ✅ | Server: phos_members, /collections, /members, /sharees, joined/collections im Pull, forbidden+record, moveFrom (`ea467c9`, App 0.2.1). Desktop: Label teilen (Dialog aus Studienpad → Labels), Übersetzung Label-Namen „Name (Besitzer)“, private Labels bleiben privat, Entzug/Beenden/Nur-Lesen (BVC `be1cd7f9`). Verifiziert: 34 HTTP-Vektoren, Harness 86 Prüfungen mit zwei Konten, GUI-Lauf. Offen: Benachrichtigungen/Activity, Übersicht „Mit mir geteilt“ | Phase 2 |
| S-2 ✅ | Server: Datei-Endpunkt für Mitglieder (nur Dateien der Sammlung), Datei-Sätze nur vom Besitzer, moduleKey nie geteilt (`2db1a37`, App 0.2.2). Desktop: Projekte (mit Exegesen/Belegstellen), Exegesen, Präsentationen (mit Medien), Predigten, Module (Lesepläne), E-Books teilbar; Übersicht „Teilen …“; Lizenz-Hinweis statt Prüfung (Entscheidung: Verantwortung beim Nutzer). Verifiziert: Harness 98 Prüfungen, file_proxy-Test, GUI | Phase 2 komplett |
| S-3 ✅ | Server: Nextcloud-Benachrichtigung an neue Mitglieder (Nutzer, Gruppenmitglieder; Teams sobald NC die Mitgliederliste anbietet), keine Doppelmeldung bei Rechteänderung, Entzug/Löschen räumt sie ab (App 0.2.3, `tests/integration/notifications.py`). Desktop: „Teilen …“ im Kontextmenü von Bibliothek (Module, E-Books), Projektübersicht und Studienpad-Thema; fremd Geteiltes in Blau + Personensymbol + Hover „geteilt von …“ (auch Labels-Dialog, Übersicht); Meldung „Neu mit dir geteilt“ nach dem Abgleich. Verifiziert: Harness 103 Prüfungen, GUI | Phase 2 inkl. Benachrichtigungen |
| AB-S | (optional) serverseitige AndBible-Bridge als BackgroundJob | Handy-Änderungen ohne laufenden Desktop |
| W-1 ✅ | PHP-SWORD-Leser (`lib/Service/Sword/`: zText/zCom ±4, RawText/RawCom ±4, zLD/RawLD/RawLD4, Sapphire, prepText, Strong's-Padding), 18 Versifikationen aus libsword (`dev/gen_v11n.py` → `v11n.json`), Reader-API `/modules…` (protocol.md §12), Cache je Manifest-Rev. Verifiziert: Eintrag-für-Eintrag-Vergleich mit `mod2imp` auf 14 echten Modulen (zText, zCom, zCom4, RawText, RawCom, RawLD4, zLD; Latin-1; 0 Abweichungen), PHPUnit gegen osis2mod/imp2ld-Fixtures (zusätzlich zText4, RawText4, RawLD, verschlüsseltes zText; RawCom4 ungetestet, gleicher Pfad wie RawText4), `tests/integration/reader.py` (17 Prüfungen, Teilen/Schlüssel/Entzug). App 0.3.0 | Bibeltext im Web |
| W-2 | Vue-Frontend: Lesen, Lesezeichen/Notizen, Studienpads, Leseplan, Konflikte, Geräte | Phase 3 basal |

### Stand 2026-10-11
NC-0–NC-2 umgesetzt: `docs/protocol.md`, `protocol/types.json`, 32 Vektoren; `lib/Sync/` (Hlc, Canonical, TextMerge/diff3, Merger, SyncService, MemoryRecordStore), `lib/Db/` (DbRecordStore mit globaler Schreibsperre für lückenlose Revs, DeviceStore), Migration (7 Tabellen), OCS-`ApiController`, `TombstoneGc`. Verifiziert: PHPUnit 46 Tests grün; 28 Vektoren per HTTP gegen NC 34/SQLite grün (4 brauchen simulierte Uhr → nur Unit); 24 parallele Pusher → keine Verluste, Set-Merge vollständig. Gotchas: NC deckelt Parameter `limit` auf 500 ohne `@param int<1, 1000>`; SQLite „database is locked“ unter Last → als wiederholbarer Konflikt behandelt; Erst-Login frischer Nutzer parallel → NC-interne 500er (Testnutzer vorher anwärmen). D-1 am 2026-10-12 erledigt (BVC `d81ac23a`): Erstlauf mit Kopie des echten Profils = 251 Datensätze in 1,6 s. Gefunden und behoben: HLC-Zähler in Großbuchstaben (`Format('%x')`) → vom Server als ungültig abgelehnt; doppelte Label-Namen im echten Bestand → Engine überspringt doppelte Schlüssel. Noch offen aus D-1: Workspace-UUIDs der AndBible-Brücke im Payload (5a.5), Keyring statt base64 für das App-Passwort, Konflikt-Dialog (D-2). D-0 am 2026-10-12 erledigt (BVC `6bf49ef9`). Bewusst nicht gemacht: die 6 `CreateGUID`-Kopien zusammenlegen (Format der IDs würde sich ändern, für den Sync unnötig) und `modifiedMs` in allen Stores (die Shadow-Diff-Erkennung vergibt die HLC beim Erkennen, Store-Zeitstempel sind dafür nicht nötig). Nächstes Paket: D-1.

## 11. Verifikation

- **Server**: PHPUnit im Dev-Container (`podman exec phos-nc-dev php vendor/bin/phpunit`), alle `tests/vectors` grün; Integrationstest mit zwei Nutzern (Sharing-Rechte).
- **Desktop**: Konsolen-Harness `test_ncsync.lpr` (Muster wie `test_phossync`/`test_plannerdav`): zwei simulierte Geräte mit getrennten Config-Kopien gegen `phos-nc-dev` — Szenarien: A offline 2 Wochen + B ändert dieselbe Notiz (Auto-Merge/Konflikt), Uhr von A 1 h vor, Löschen auf A/Bearbeiten auf B, „Nur lokal“-Label erscheint nie auf B, Abbruch mitten im Push → Retry ohne Duplikate, Modul-Upload abbrechen/fortsetzen, Tombstone-Reset. **Immer auf Kopien von `~/.config/BVC` arbeiten, nie live.** Danach GUI-Prüfung per Xvfb-Rezept (Settings-Dialog, Konfliktdialog, Statusanzeige).
- **Mobile**: Unit-Tests mit den Vektoren + Emulator (`phos-test`-AVD) gegen `phos-nc-dev` (aus Emulator `10.0.2.2`).
- **Web**: Playwright-Smoke gegen Dev-Container (Login, Kapitel lesen, Lesezeichen setzen → erscheint nach Pull im Desktop-Harness).
- **Ende-zu-Ende**: Desktop → Server → Mobile → Web → Desktop mit Lesezeichen, Notiz, Leseplanfortschritt, einem kleinen Modul; Prüfung über `GET /changes` und lokale Dateien.
