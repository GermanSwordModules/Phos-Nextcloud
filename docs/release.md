# Auslieferung der Nextcloud-App

Ausgeliefert wird **ein Archiv**: `phos-<version>.tar.gz` mit dem Ordner `phos/`, das bereits
gebaute `js/` enthält. Es enthält kein `src/`, `node_modules/`, `vendor/` und keine Tests. Auf
dem Server braucht man deshalb weder Node noch Composer. Gebaut wird es mit `dev/release.sh`
(Ergebnis in `build/`).

Das Archiv kommt auf drei Wegen zu den Nutzern:

1. **Nextcloud App Store** (Ziel): Admins installieren über *Apps → Office → Phos* und bekommen
   Updates in Nextcloud angezeigt. Nextcloud prüft dabei die Signatur des Archivs.
2. **GitHub-Release**: dasselbe Archiv als Download, für Admins ohne App Store.
3. **Entwicklung**: `git pull` im App-Ordner plus `npm ci && npm run build`.

## Einmalig: App Store einrichten

Die App-ID `phos` ist im App Store noch frei (Stand 2026-10-18).

1. Schlüssel und Zertifikatsanfrage erzeugen. Den Schlüssel nie committen; er gehört in die
   Sicherung.
   ```sh
   mkdir -p ~/.nextcloud/certificates && cd ~/.nextcloud/certificates
   openssl req -nodes -newkey rsa:4096 -keyout phos.key -out phos.csr -subj "/CN=phos"
   ```
2. Pull Request auf https://github.com/nextcloud/app-certificate-requests mit der Datei
   `phos/phos.csr`. Den Inhalt von `phos.csr` einfügen und den Link auf dieses Repository
   nennen. Nach dem Merge liegt dort `phos/phos.crt`.
3. Auf https://apps.nextcloud.com mit GitHub anmelden, dann *Register app* wählen. Dort das
   Zertifikat (`phos.crt`) und die Signatur der App-ID eintragen:
   ```sh
   echo -n phos | openssl dgst -sha512 -sign ~/.nextcloud/certificates/phos.key | openssl base64
   ```
4. Im App-Store-Konto unter *API-Token* ein Token erzeugen. In GitHub unter *Settings → Secrets →
   Actions* zwei Secrets anlegen: `APPSTORE_TOKEN` mit dem Token und `APP_PRIVATE_KEY` mit dem
   Inhalt von `phos.key`.

Solange die Secrets fehlen, erzeugt der Release-Workflow nur das GitHub-Release.

## Jede Version

1. Die Version in `appinfo/info.xml` und `package.json` gleich hochzählen.
   `dev/release.sh` bricht ab, wenn die beiden nicht übereinstimmen.
2. Committen, taggen und pushen:
   ```sh
   git tag v0.3.2 && git push && git push --tags
   ```
3. `.github/workflows/release.yml` erledigt den Rest: JS-Tests, Build, Archiv, GitHub-Release
   und, wenn die Secrets vorhanden sind, App Store.

Lokal ohne CI: `dev/release.sh` baut das Archiv. Liegt `~/.nextcloud/certificates/phos.key`
vor, schreibt es zusätzlich `build/phos-<version>.tar.gz.sig`; diese Signatur kann man im App
Store beim Hochladen von Hand eintragen.

## Installation und Update auf einem Server ohne App Store

```sh
tar -C <nextcloud>/custom_apps -xzf phos-<version>.tar.gz     # ersetzt custom_apps/phos
php <nextcloud>/occ app:disable phos && php <nextcloud>/occ app:enable phos
```

Bei einem Update ist der Schritt `app:disable`/`app:enable` nötig, sonst antwortet die API mit
503 (Datenbank-Migrationen der App stehen aus). Es wird ausschließlich diese App
aktualisiert; `occ upgrade` ist dafür nicht nötig.

Über den App Store installierte Updates führt Nextcloud selbst aus.

## Geprüft

Am 2026-10-18 wurde `dev/release.sh` in einem frischen `nextcloud:stable`-Container geprüft:
Archiv nach `custom_apps/` entpacken und `occ app:enable phos` ausführen. Danach liefern
`/api/v1/status` und die Seite *Phos* das Erwartete, und das Bundle wird geladen.

Nicht geprüft: Codesignatur (`appinfo/signature.json`, `occ integrity:sign-app`). Der App
Store verlangt sie nicht; Nextcloud prüft die Integrität nur bei Apps, die eine Signatur
mitbringen.
