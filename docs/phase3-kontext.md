# Übergabe: Phase 3 (Webfrontend) — Stand 2026-10-18

**W-1 und W-2 sind umgesetzt** (App 0.3.1, Details in `docs/PLAN.md` §10). Was folgt,
ist der ursprüngliche Auftrag; darunter die Fallstricke, ergänzt um die aus Phase 3.

Einstieg nach `/clear`. Gesamtplan: `docs/PLAN.md` (§9 Phase 3, §10 Arbeitspakete W-1/W-2).
Protokoll (normativ): `docs/protocol.md`. Phasen 1 und 2 sind fertig und verifiziert.

## Was steht

| Bereich | Stand |
|---|---|
| Server-App `phos` 0.2.3 (dieses Repo) | Records/Journal/HLC/Merge (lww, fields, text, sets, opaque), Konflikte, Tombstone-GC, Geräte, Sammlungen + Mitglieder (user/group/team, read/write/admin), Sharee-Suche, Datei-Proxy für Mitglieder, Nextcloud-Benachrichtigung „X hat „Y“ in Phos mit dir geteilt“ (verschwindet bei Entzug) |
| Desktop (BVC, `unit_ncsync*`) | Sync aller Nutzerdaten + Module/E-Books/Präsentations-Medien als Dateien; Teilen von Labels, Projekten, Exegesen, Predigten, Präsentationen, Modulen, E-Books; Kontextmenü „Teilen …“ in Bibliothek, Projektübersicht, Studienpad-Thema; fremd Geteiltes in Blau + Personensymbol + Hover „geteilt von …“; Hinweis „Neu mit dir geteilt“ nach dem Abgleich |
| Noch nicht | Webfrontend (W-1/W-2), Mobile (M-1), v1-Import (MIG), serverseitige AndBible-Bridge (AB-S), Activity-Einträge, echte 8-GB-Modul-Synchronisierung, Teams-Mitgliedschaft real getestet |

## Phase 3: was zu bauen ist

**W-1 — Bibeltext auf dem Server (PHP, keine Binärdateien)**
- Neue Klassen unter `lib/Service/Sword/`: zText/zCom (`.bzs/.bzv/.bzz`, `gzuncompress`), RawText/RawCom, zLD/RawLD; GenBook später.
- Moduldateien liegen im Nextcloud-Ordner des **Besitzers**: `Phos/Module/<Name>/` mit dem Pfad aus dem Manifest (`modules/texts/ztext/<name>/…`). Lesen über `IRootFolder->getUserFolder($owner)->get('Phos/…')`.
- Welche Module ein Nutzer sehen darf: alle `module`-Records in seinen lesbaren Sammlungen (`RecordStore::readableCollections` + `find`/`changesSince`). Manifest-Payload: `{name, confFile, conf (ohne CipherKey), files:[{p,s,h}], total}`; die `.conf` steht als Text im Payload.
- CipherKey: Typ `moduleKey`, nur in der persönlichen Sammlung des Nutzers, nie geteilt → Sapphire-Entschlüsselung nur für eigene Schlüssel.
- Versifikationen: Kanon-Tabellen aus libsword `canon_*.h` einmalig per Skript nach PHP/JSON erzeugen (KJV, Luther, German, Catholic, Synodal, …).
- Reader-API als neue OCS-Routen, z. B. `GET /api/v1/modules`, `GET /api/v1/text/{module}/{book}/{chapter}`; Cache in `IAppData`.
- Tests: kleines echtes zText-Modul als Fixture (z. B. aus `~/.sword`, Lizenz prüfen) + PHPUnit gegen bekannte Verse.

**W-2 — Vue-Frontend**
- Vue 3 + `@nextcloud/vue` 9 (NC ≥ 30), Vite-Build nach `js/`, `PageController` + `templates/main.php`, Navigation-Eintrag in `appinfo/info.xml` (`<navigations>`, Icon `img/app.svg` ist schon da).
- Web ist ein eigenes **Gerät**: Geräte-ID (16 hex) im LocalStorage, eigene HLC `<ms13>-<cccc>-<device>` (Zähler kleingeschrieben!), schreibt nur über `POST /push` mit `baseRev`, liest über `GET /changes` (Cursor). Keine Sonderpfade, der Server mergt.
- Umfang v1: Modulwahl, Buch/Kapitel, 2 Paralleltexte; Lesezeichen setzen, Label, Notiz (`noteMd`, Markdown); Lesezeichen-/Notizliste mit Filter; Studienpads (= Labels) lesen/bearbeiten; „Heute lesen“ (Leseplan); Konflikte auflösen (`/conflicts`); Geräteverwaltung; Sammlungen/Mitglieder (Endpunkte gibt es).
- Payload-Formate vom Desktop übernehmen, nicht neu erfinden: Lesezeichen `{id, kind:"verse", module, bookOsis, bookIdx, chap, vStart, vEnd, labelNames[], noteMd, sortOrder, created, modified}`, Label `{name, color, style, iconId, favorite, actionBar, autoAssign}` (Key `label:<Name>`, Lesezeichen-Key `bm:<id>`). Typen und Merge-Politik: `protocol/types.json`.
- OSIS → HTML im Browser: Teilmenge des Phos-Renderers (Überschriften, Fußnoten-Popover, Querverweise, Worte Jesu, Strong's-Tooltip).
- Smoke-Test mit Playwright gegen den Dev-Container.

## Arbeitsumgebung

- Dev-Server: `dev/compose.sh up` → `http://127.0.0.1:8090`, admin / `phos-dev-pw` (Container `phos-nc-dev`; **`phos-nc-test` nicht anfassen**). `dev/compose.sh test` = PHPUnit + HTTP-Vektoren + concurrency + file_proxy + notifications. `dev/compose.sh occ …`.
- Nach Versionssprung in `appinfo/info.xml` antwortet die API mit 503, bis die App aktualisiert ist. **Nur die App** aktualisieren: `occ app:disable phos && occ app:enable phos` (verifiziert; führt nur die Migrationen von phos aus). `occ upgrade` nicht empfehlen.
- Routenänderungen brauchen einen Versionssprung oder Cache-Reset (sonst leere 400).
- Desktop-Harness: `lazbuild test_ncsync.lpi`, dann `XDG_CONFIG_HOME=<scratch> DISPLAY=:<eigenes Xvfb> ./test_ncsync http://127.0.0.1:8090 <user> <pw> <user2> <pw2>` — **frische Konten** verwenden (alte haben Konflikt-Reste; 2 Prüfungen schlagen sonst fehl). Stand: 103/103.
- GUI-Prüfung: Xvfb mit `-ac`, `HOME` und `XDG_CONFIG_HOME` auf Scratch-Kopien (sonst `~/phos/documents`, `~/.config/BVC` live!), `--open-tool projects`, Screenshots mit `import -window`, Fenster mit `xdotool windowmove/windowraise` holen. Nie `DISPLAY=:1`, nie `pkill project1` (nur eigene PID).
- Commits/Pushes als Jens, ohne Co-Author-Zeile.

## Fallstricke (gesammelt)

- Nextcloud: JSON-Body-Felder überschreiben gleichnamige Routen-Parameter → `{collection}` statt `{id}`. Parameter `limit` ist ohne `@param int<1, 1000>` auf 500 gedeckelt.
- Login Flow v2 liefert auf dem Uberspace-NC 405 → Desktop tauscht Passwort gegen App-Passwort (`/ocs/v2.php/core/getapppassword`). Fürs Web irrelevant (Sitzung).
- FPC: Nicht-ASCII-Literal + fpjson-`UnicodeString` in einem Ausdruck → wird als Latin-1 konvertiert („â€ž“). Alles als `AnsiString` verketten.
- Qt-Canvas zeichnet keine Emoji (keine Font-Ersetzung) → Symbole selbst zeichnen (`NcDrawSharedMark`).
- Themed `TTreeView` ignoriert `Canvas.Font.Color` → Text im Post-Paint nachzeichnen oder `tvoThemedDraw` aus.
- Event-Handler, die in der `.lfm` stehen, müssen `published` sein.
- Web-Build: `@nextcloud/vite-config` 2.5 verlangt vite 7 und TypeScript 5 (mit TS 7 bricht `vite-plugin-dts` beim Laden der Config).
- `NcAppSidebar` muss neben `NcAppContent` stehen → aus einer Route per `<Teleport to="#content-vue">`.
- Nextcloud stylt jedes `<button>` als 44-px-Fläche; kleine Chips brauchen explizite `min-height/height/padding`.
- Playwright: First-Run-Wizard öffnet spät und fängt Klicks ab → `page.route(/\/apps\/firstrunwizard\//, abort)`; Hash-Navigation erst, wenn die App steht.
- Reader: `mod2imp` ist das Referenzorakel (`dev/sword_dump.php` vergleicht Eintrag für Eintrag); libsword wendet in jedem Treiber `prepText` an; Strong's-Lexika haben teils `G0026`, teils `00026` als Schlüssel.
- `osis2mod -c` auf RawText erzeugt Daten, die libsword selbst nicht zurücklesen kann — keine Fixture dafür.
- Versifikations-Mapping (W-3-C): nur 6 Systeme haben in libsword Tabellen (NRSV, Synodal, Vulg, Calvin, DarbyFr, Segond); German/Luther/Catholic… werden **nicht** umgezählt (Desktop genauso). libsword-Eigenheiten bewusst übernommen: Bereich über Kapitelende → +1 (`setFromOther`), die „contraction fix“-Abfrage vergleicht Zeiger. Gegen libsword prüfen: `g++ -I<sword>/include dev/v11n_oracle.cpp /usr/lib/x86_64-linux-gnu/libsword.so.1.9.0` vs. `php dev/v11n_map_dump.php` (im Container).
- Neue OCS-Routen werden erst nach **Versionssprung** + `app:disable/enable` erkannt (sonst 998/leer). `package.json`-Version muss zu `info.xml` passen (`dev/release.sh` bricht sonst ab).
- Indexdateien in AppData (`search/`, `leads/`) heißen `<hash(Modul)>-<hash(Rev)>.idx`; ein Neubau löscht die alten desselben Moduls. Von Hand gelöschte Dateien bleiben im Filecache → Lesen fängt das ab und baut neu.
- Bücher-Leseposition ist jetzt geteilt (`pos:mod:<Modul>`): Tests, die ein Buch „von vorn“ erwarten, müssen den Eintrag ansteuern.
- Formular mit mehreren Eingaben: Enter löst kein Submit aus → Suchfeld in ein eigenes `<form>`.
