#!/bin/sh
# Starts the emulators with their state and logs in the /data volume.
#
# - Auth and the (default) database: firebase's --import/--export-on-exit, to
#   /data/export (not /data: firebase replaces the export directory as a whole,
#   and a volume's mount point cannot be replaced - EACCES, 2026-11-26).
# - The site's named database "koryta-pl", which those flags skip: exported on
#   SIGTERM to /data/named/<timestamp> and imported from the newest one on start
#   (named-db.js).
# - Debug logs are written to the working directory, so it is in the volume
#   too, and each start moves the previous run's logs to /data/logs.
set -eu
mkdir -p /data/export /data/named /data/logs /data/run
cp /emulators/firebase.json /emulators/firestore.rules /emulators/firestore.indexes.json /data/run/
cd /data/run
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for f in *.log; do
  [ -e "$f" ] && mv "$f" "/data/logs/$stamp-$f"
done

firebase emulators:start --project demo-koryta-pl --only auth,firestore \
  --import /data/export --export-on-exit /data/export &
pid=$!

shutdown() {
  echo "emulators-start: exporting koryta-pl before shutdown"
  node /usr/local/lib/named-db.js export /data/named || echo "emulators-start: named export failed"
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" || true
  exit 0
}
trap shutdown TERM INT

until node -e "fetch('http://127.0.0.1:8080/').then(()=>process.exit(0),()=>process.exit(1))"; do
  kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit 1; }
  sleep 1
done
node /usr/local/lib/named-db.js import /data/named || echo "emulators-start: named import failed"
echo "emulators-start: ready"

wait "$pid"
