# Entwicklung

Gesamtplan und Arbeitspakete: `docs/PLAN.md`. Protokoll (normativ): `docs/protocol.md`.
Was im Web gegenüber dem Desktop noch fehlt: `docs/PLAN.md` §12.

## Arbeitsumgebung

- Dev-Server: `dev/compose.sh up` → `http://127.0.0.1:8090`, admin / `phos-dev-pw`
  (podman-Container `phos-nc-dev`). `dev/compose.sh test` = PHPUnit + HTTP-Vektoren +
  concurrency + file_proxy + notifications. `dev/compose.sh web` = JS-Unit-Tests, Sync-Engine
  gegen den Server, Playwright-Smoke. `dev/compose.sh occ …` für occ im Container.
- Nach Versionssprung in `appinfo/info.xml` antwortet die API mit 503, bis die App aktualisiert
  ist. Nur die App aktualisieren: `occ app:disable phos && occ app:enable phos` (führt nur die
  Migrationen von phos aus). Kein `occ upgrade` nötig.
- Neue OCS-Routen werden erst nach Versionssprung + `app:disable/enable` erkannt (sonst 998 oder
  leere 400). `package.json`-Version muss zu `info.xml` passen, `dev/release.sh` bricht sonst ab.
- Desktop-Harness (im Phos-Desktop-Repo): `lazbuild test_ncsync.lpi`, dann
  `XDG_CONFIG_HOME=<scratch> ./test_ncsync http://127.0.0.1:8090 <user> <pw> <user2> <pw2>` mit
  frischen Konten (alte haben Konflikt-Reste). Immer auf Kopien des Profils arbeiten, nie live.

## Moduldateien und Reader

- Moduldateien liegen im Nextcloud-Ordner des Besitzers: `Phos/Module/<Name>/` mit dem Pfad aus
  dem Manifest (`modules/texts/ztext/<name>/…`). Gelesen wird über
  `IRootFolder->getUserFolder($owner)`.
- Welche Module ein Nutzer sehen darf: alle `module`-Records in seinen lesbaren Sammlungen.
  Manifest-Payload `{name, confFile, conf (ohne CipherKey), files:[{p,s,h}], total}`.
- CipherKey: Typ `moduleKey`, nur in der persönlichen Sammlung, nie geteilt →
  Sapphire-Entschlüsselung nur für eigene Schlüssel.
- `mod2imp` ist das Referenzorakel für die PHP-Reader (`dev/sword_dump.php` vergleicht Eintrag
  für Eintrag). libsword wendet in jedem Treiber `prepText` an. Strong's-Lexika haben teils
  `G0026`, teils `00026` als Schlüssel.
- `osis2mod -c` auf RawText erzeugt Daten, die libsword selbst nicht zurücklesen kann; dafür gibt
  es keine Fixture. Fixtures werden mit `tests/fixtures/sword/build.sh` erzeugt.
- Versifikations-Mapping: nur 6 Systeme haben in libsword Tabellen (NRSV, Synodal, Vulg, Calvin,
  DarbyFr, Segond); German/Luther/Catholic werden nicht umgezählt (Desktop genauso).
  libsword-Eigenheiten sind bewusst übernommen (Bereich über Kapitelende → +1, Zeigervergleich im
  „contraction fix“). Gegenprobe: `g++ -I<sword>/include dev/v11n_oracle.cpp libsword.so` gegen
  `php dev/v11n_map_dump.php` im Container.
- Indexdateien in AppData (`search/`, `leads/`) heißen `<hash(Modul)>-<hash(Rev)>.idx`; ein
  Neubau löscht die alten desselben Moduls. Von Hand gelöschte Dateien bleiben im Filecache,
  das Lesen fängt das ab und baut neu.

## Web-Frontend

- Web ist ein eigenes Gerät: Geräte-ID (16 hex) im LocalStorage, eigene HLC
  `<ms13>-<cccc>-<device>` (Zähler kleingeschrieben), schreibt nur über `POST /push` mit
  `baseRev`, liest über `GET /changes`. Keine Sonderpfade, der Server mergt.
- Payload-Formate kommen vom Desktop, nicht neu erfinden: Typen und Merge-Politik in
  `protocol/types.json`.
- `@nextcloud/vite-config` 2.5 verlangt vite 7 und TypeScript 5.
- `NcAppSidebar` muss neben `NcAppContent` stehen → aus einer Route per `<Teleport to="#content-vue">`.
- Nextcloud stylt jedes `<button>` als 44-px-Fläche; kleine Chips brauchen explizite
  `min-height/height/padding`. NcSelect hat `min-width: 260px` eingebaut → auf dem Handy
  `min-width: 0 !important`.
- Formular mit mehreren Eingaben: Enter löst kein Submit aus → Suchfeld in ein eigenes `<form>`.
- reveal.js im Nextcloud-Seitenkontext: `keyboardCondition: 'focused'` reagiert nie, ohne
  Bedingung laufen lassen (reveal ignoriert Tasten in Eingabefeldern). Zwei reveal-Instanzen auf
  einer Seite gehen (Vorschau mit `fragments: false`). `phos.css` des Desktops hat `:root`- und
  `html, body`-Regeln → nur als begrenzte Kopie (`src/docs/phos-deck.css`) laden; Logo im Web
  `absolute` statt `fixed`.
- Fernbedienung speichert in Nutzer-Einstellungen (`remote_cmd`, `remote_state`), kein
  Cache-Backend nötig.
- Dateien über `/apps/phos/files/<coll>/<pfad>` funktionieren auch für die persönliche Sammlung;
  nur die Typen in `FilesController::SAFE_TYPES` kommen inline.
- Bücher-Leseposition ist geteilt (`pos:mod:<Modul>`): Tests, die ein Buch „von vorn“ erwarten,
  müssen den Eintrag ansteuern.
- Übersetzungen: `dev/l10n_de.py` ist die Quelle für `l10n/de*.json/.js`, nie die JSON-Dateien
  von Hand ändern.

## Server

- Nextcloud: JSON-Body-Felder überschreiben gleichnamige Routen-Parameter → `{collection}`
  statt `{id}`. Parameter `limit` ist ohne `@param int<1, 1000>` auf 500 gedeckelt.
- SQLite „database is locked“ unter Last → als wiederholbarer Konflikt behandelt. Erst-Login
  frischer Nutzer parallel → NC-interne 500er (Testnutzer vorher anwärmen).
- Login Flow v2 liefert auf manchen Hostern 405 → der Desktop tauscht das Passwort gegen ein
  App-Passwort (`/ocs/v2.php/core/getapppassword`). Fürs Web irrelevant (Sitzung).

## Playwright

- First-Run-Wizard öffnet spät und fängt Klicks ab → `page.route(/\/apps\/firstrunwizard\//, abort)`;
  Hash-Navigation erst, wenn die App steht. Neuer Popup/Tab im selben Kontext braucht die Sperre
  erneut.
- vue-select-Optionen über `.vs__dropdown-option`, nicht `role=option`.
- `\u`-Folgen in Teststrings können beim Schreiben der Datei schon zu Zeichen geworden sein;
  RTF-Fixtures prüfen.
