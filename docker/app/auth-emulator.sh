#!/bin/sh
# The Firebase Auth emulator for a demo without a Firebase project of its own
# (compose.coolify.yaml, profile `emulator-auth`), with the two test accounts
# of scripts/seed-emulator.ts: user@koryta.pl and admin@koryta.pl, both
# password123. The emulator keeps nothing, so they are created on every start.
set -eu
project=${AUTH_EMULATOR_PROJECT:-demo-koryta-pl}
cd /emulators
firebase emulators:start --project "$project" --only auth &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null || true; wait "$pid" || true; exit 0' TERM INT

until node -e "fetch('http://127.0.0.1:9099/').then(()=>process.exit(0),()=>process.exit(1))"; do
  kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit 1; }
  sleep 1
done

PROJECT="$project" node -e '
const base = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${process.env.PROJECT}/accounts`;
const users = [
  { localId: "test-admin", email: "admin@koryta.pl", displayName: "Admin User",
    customAttributes: JSON.stringify({ admin: true, datascience: true, owner: true }) },
  { localId: "test-user", email: "user@koryta.pl", displayName: "Normal User" },
];
(async () => {
  for (const user of users) {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({ ...user, password: "password123", emailVerified: true }),
    });
    console.log(`auth-emulator: ${user.email} ${res.status}`);
    if (!res.ok && res.status !== 400) process.exit(1);
    // Claims are not taken on create; an update sets them.
    if (user.customAttributes) {
      const claims = await fetch(`${base}:update`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer owner" },
        body: JSON.stringify({ localId: user.localId, customAttributes: user.customAttributes }),
      });
      console.log(`auth-emulator: ${user.email} claims ${claims.status}`);
      if (!claims.ok) process.exit(1);
    }
  }
})();
'
echo "auth-emulator: ready"
wait "$pid"
