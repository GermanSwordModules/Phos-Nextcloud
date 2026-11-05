# Web ↔ Desktop look-alike/work-alike: Stand und offene Punkte

Vollständiger Plan (Tier 1-4 + Chrome-Track, nach Aufwand/Effekt sortiert):
`/home/jens/.claude/plans/please-make-a-plan-curious-meerkat.md` (lokal beim Benutzer).

## Erledigt (Tier 1-3 + Chrome-Track, uncommitted)

- **Phase 0**: eine Anzeigeoptionen-Menü-Komponente (`src/components/BibleViewOptions.vue`),
  gespeist aus einem gemeinsamen `displayOptions`-Objekt (`src/services/phos.js`) — das
  Web-Gegenstück zu Desktops `DISP_TOGGLES`-Tabelle (`unit_child.pas`).
- **Tier 1**: Strong's-Nummern, Fußnoten/Querverweise, Überschriften, Jesus-Worte-rot je
  per Haken ein-/ausschaltbar; Kapitelnummer-am-Rand; Textzoom (±10%, persistiert);
  Zurück/Vor-Navigation; PDF-Export (`window.print()` + `@media print`-Regeln).
- **Tier 2**: Vers-Auswahl-Dialog (Buch→Kapitel→Vers-Raster, `VersePicker.vue`);
  Popover-Dispatch in `BibleView.vue` auf eine Tabelle umgestellt (Erweiterungspunkt für
  künftige geo:/person:-Marker). **Nicht umgesetzt**: "Nur Notizen des aktiven Projekts" —
  es gibt im Web noch kein "aktives Projekt"-Konzept überhaupt (keine Spur in `src/` gefunden);
  erst sinnvoll, wenn das existiert.
- **Tier 3**: Paralleltext auf N Versionen erweitert (Mehrfachauswahl statt Einzelauswahl,
  `?p=`-Query komma-getrennt, abwärtskompatibel zu alten `?p=<eine>`-Links); Fußnoten am Rand
  (`displayOptions.sideNotes`) als vereinfachte CSS-Float-Spalte — **ohne** Desktops
  JS-Kollisionsvermeidung (`SideNoteScript`); bei dicht stehenden Fußnoten können sich
  Randnotizen mehrerer Verse optisch überlappen. **Nicht umgesetzt**: Orts-/Personenmarker,
  Gliederungs-/Strukturansicht — `bible/render.js` und der PHP-Reader kennen diese Marker-Typen
  gar nicht, das synct heute nicht; das ist eine Backend-Entscheidung, keine reine Web-UI-Aufgabe.
- **Chrome-Track**: Navigationsleiste in 4 Abschnitte gruppiert (`src/App.vue`,
  `NcAppNavigationCaption`). **Bewusst nicht** umgesetzt: eine App-weite Phos-Farbpalette
  anstelle von Nextclouds eigener Theming-Variable (`--color-primary-element`) — würde mit der
  Instanz-eigenen Theme-Wahl der Nutzer kollidieren, kein Fehlen sondern eine Entscheidung.
  Ebenfalls nicht: ein 1:1-Port der 22 Desktop-Bitmap-Icons (`icons/actionbar/*.png`) — dafür
  bräuchte es entweder SVG-Nachzeichnungen oder ein Bild-Icon-System; vorhandene MDI-Icons
  passen inhaltlich schon weitgehend.

Verifiziert: `npm test` (24/24), `npm run build`, PHPUnit (93/93), `tests/web/engine.live.test.js`
(3/3), Playwright-Smoke (29/29 inkl. 8 neue Szenarien für die obigen Punkte) — alles über
`dev/compose.sh up|web` gegen eine echte Nextcloud-Instanz (podman `phos-nc-dev`).

## Tier 4 — für später, bewusst nicht jetzt gemacht

**Interlinear-Ansicht**: existiert im Web überhaupt nicht (Strong's nur im Popover, nie
Wort-für-Wort inline). Desktops Version (`unit_interlinear.pas`, 1681 Zeilen) ist praktisch ein
eigenes Werkzeug: Wortausrichtung Original↔Übersetzung über Strong's-Nummern, zwei Modi,
4-zeiliges Raster pro Wort, eigene Navigation, optionales Satzbau-Unterfenster. Im Web wäre das
eine neue Route/Komponente; `render.js`s vorhandene `data-lemma`/`data-morph`-Extraktion liefert
den Ausrichtungsschlüssel schon, aber Rasterlayout, Zwei-Modi-Umschaltung und Glossar-Zeilen sind
komplett neu. **Empfehlung**: eigenes Folgeprojekt, nicht in einen Parity-Sprint stecken. Billigere
Zwischenlösung, falls gewünscht: nur ein Gloss-Text unter jedem `.phos-w`-Wort (kein 4-Zeilen-Raster,
kein Satzbau-Fenster) — mittlerer statt hoher Aufwand.

## Quellen
Explore-Agenten-Audits (Desktop-Feature-Inventar, Web-Ist-Stand) + direkte Code-Verifikation
2026-11-03; Plandatei siehe oben.
