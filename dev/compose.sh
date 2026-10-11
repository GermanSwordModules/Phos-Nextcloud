#!/bin/sh
# Dev Nextcloud for the phos app. Leaves the AndBible test rig (phos-nc-test) alone.
#   dev/compose.sh up      create/start phos-nc-dev on http://127.0.0.1:8090 (admin / phos-dev-pw)
#   dev/compose.sh down    stop it
#   dev/compose.sh reset   delete container + volume
#   dev/compose.sh occ …   run occ inside
#   dev/compose.sh test    unit suite + vectors over HTTP + concurrency check
set -e
NAME=phos-nc-dev
PORT=${PHOS_NC_PORT:-8090}
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
case "$1" in
  up)
    if podman container exists $NAME; then podman start $NAME >/dev/null; else
      podman run -d --name $NAME -p 127.0.0.1:$PORT:80 \
        -v $NAME-data:/var/www/html \
        -v "$APP_DIR":/var/www/html/custom_apps/phos:z \
        -e SQLITE_DATABASE=nc \
        -e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD=phos-dev-pw \
        -e "NEXTCLOUD_TRUSTED_DOMAINS=localhost 127.0.0.1 10.0.2.2" \
        docker.io/library/nextcloud:stable >/dev/null
    fi
    printf 'waiting for install'
    until podman exec -u www-data $NAME php occ status 2>/dev/null | grep -q 'installed: true'; do printf .; sleep 3; done
    echo
    # Pick up PHP edits immediately (default opcache revalidates every 60 s).
    podman exec -u 0 $NAME sh -c 'echo "opcache.revalidate_freq=0" > /usr/local/etc/php/conf.d/zz-phos-dev.ini && apachectl -k graceful' 2>/dev/null || true
    podman exec -u 0 -w /var/www/html/custom_apps/phos -e COMPOSER_ALLOW_SUPERUSER=1 -e COMPOSER_HOME=/tmp/composer $NAME \
      sh -c '[ -f composer.phar ] || curl -sSLo composer.phar https://getcomposer.org/download/latest-stable/composer.phar; php composer.phar install -q --no-interaction'
    podman exec -u www-data $NAME php occ app:enable phos
    ;;
  down)  podman stop $NAME ;;
  reset) podman rm -f $NAME; podman volume rm -f $NAME-data ;;
  occ)   shift; podman exec -u www-data $NAME php occ "$@" ;;
  test)  podman exec -u 0 -w /var/www/html/custom_apps/phos $NAME php vendor/bin/phpunit -c tests/phpunit.xml
         python3 -I "$APP_DIR/tests/integration/run_vectors.py" http://127.0.0.1:$PORT admin phos-dev-pw
         python3 -I "$APP_DIR/tests/integration/concurrency.py" http://127.0.0.1:$PORT admin phos-dev-pw ;;
  *) echo "usage: $0 up|down|reset|occ …|test"; exit 1 ;;
esac
