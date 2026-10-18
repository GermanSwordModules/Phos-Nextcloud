#!/bin/sh
# Builds the installable app archive build/phos-<version>.tar.gz (top folder phos/, as the
# Nextcloud App Store and a manual install into custom_apps/ expect it):
#   - js/ freshly built (it is not in git), without source maps
#   - only what the server needs at runtime: appinfo lib templates img l10n js protocol/types.json
#   - no vendor/: the app has no runtime composer dependencies
# With a key (PHOS_APP_KEY=path, default ~/.nextcloud/certificates/phos.key) it also writes the
# App Store signature build/phos-<version>.tar.gz.sig (base64, sha512).
set -eu
cd "$(dirname "$0")/.."

mkdir -p build
version=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' appinfo/info.xml)
pkgver=$(node -p 'require("./package.json").version')
[ "$version" = "$pkgver" ] || { echo "info.xml $version != package.json $pkgver" >&2; exit 1; }
if [ -n "${GITHUB_REF_NAME:-}" ] && [ "${GITHUB_REF_NAME#v}" != "$version" ]; then
	echo "tag $GITHUB_REF_NAME != info.xml $version" >&2; exit 1
fi

# The App Store rejects an info.xml whose elements are out of schema order.
if command -v xmllint >/dev/null && curl -sf https://apps.nextcloud.com/schema/apps/info.xsd -o build/info.xsd; then
	xmllint --noout --schema build/info.xsd appinfo/info.xml
fi

[ "${SKIP_NPM:-}" = 1 ] || { npm ci --no-audit --no-fund; npm run build; }
[ -f js/phos-main.mjs ] || { echo "js/phos-main.mjs missing" >&2; exit 1; }

stage=build/stage
rm -rf "$stage"; mkdir -p "$stage/phos/protocol"
cp -r appinfo lib templates img l10n "$stage/phos/"
mkdir "$stage/phos/js"
find js -maxdepth 1 -type f ! -name '*.map' -exec cp {} "$stage/phos/js/" \;
cp protocol/types.json "$stage/phos/protocol/"
cp README.md "$stage/phos/"
[ -f LICENSE ] && cp LICENSE "$stage/phos/"

out=build/phos-$version.tar.gz
tar -C "$stage" --owner=0 --group=0 --sort=name -czf "$out" phos
rm -rf "$stage"
echo "$out ($(du -h "$out" | cut -f1))"

key=${PHOS_APP_KEY:-$HOME/.nextcloud/certificates/phos.key}
if [ -f "$key" ]; then
	openssl dgst -sha512 -sign "$key" "$out" | openssl base64 -A > "$out.sig"
	echo "$out.sig"
fi
