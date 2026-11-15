# Changelog

## 0.4.4

- Light/dark/sepia theme, shared with desktop and mobile (`setting:Display.ThemeMode`).
- Gospel synopsis, word study per Strong's number, bookmark/notes export (Markdown, HTML, text).
- Reading view closer to the desktop app: display options (Strong's, footnotes, headings,
  words of Jesus, chapter number in the margin, text zoom), verse picker, any number of parallel
  texts, side notes, print/PDF, grouped navigation.
- Anonymous read-only share links for collections.
- Graphical query builder for the server search; saved syntax diagrams shown read-only.
- Facts pages per topic.

## 0.4.3

- Facts tool on the web (topic pages with key passages, lexicon entries, sermons, media).

## 0.4.2

- Modules visible on both sides: the web lists modules that are only installed on a desktop
  (greyed, with the device name), the desktop lists modules that are only in Nextcloud and
  offers to download them.
- Light-bulb app icon and favicon.

## 0.4.1

- Presenter view in its own window, phone remote for presentations, custom deck themes,
  deck images from outside the deck folder.
- Sharing from the web: projects, presentations, sermons, exegeses, e-books, own modules.
- Phone layout for the web UI.

## 0.4.0

- Sermons editable in the web, projects and exegeses readable (RTF rendered to HTML).
- Presentations played with reveal.js; e-books (ePub, PDF) with shared reading position.

## 0.3.7

- Parallel texts mapped into the versification of the main Bible (libsword mapping tables).
- "Continue reading" from desktop workspaces; server-side Bible and commentary search;
  sermon books, pictures and maps for the chapter on the start page.

## 0.3.4

- Library as a tree, commentary view, dictionary browsing, general books with images.

## 0.3.3, 0.3.2

- Release archive and GitHub release workflow; App Store instructions.

## 0.3.1

- Web frontend (Vue 3): Bible reading with parallel text, footnotes, cross-references,
  Strong's tooltips; bookmarks, labels, notes; study pads; reading plan "today"; conflicts;
  devices; shared collections.

## 0.3.0

- SWORD module reader in PHP (zText/zCom, RawText/RawCom, zLD/RawLD/RawLD4, Sapphire),
  18 versifications, reader API.

## 0.2.3

- Nextcloud notifications when a collection is shared with you.

## 0.2.2

- File endpoint for members of shared collections; file sets only from the owner; module
  cipher keys never shared.

## 0.2.1

- Shared collections with members (users, groups, teams), permissions read/write/admin.

## 0.2.0

- Sync server: records with journal and revisions, hybrid logical clock, server-side merge
  (LWW, field-wise, diff3 for text, sets, opaque), conflicts, tombstone GC, devices,
  conformance vectors, OCS API.
