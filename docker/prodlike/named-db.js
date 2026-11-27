// Export and import of the named Firestore database the site uses.
//
// firebase's --import / --export-on-exit only cover the (default) database, so
// "koryta-pl" came back empty after every restart (2026-11-26). The emulator's
// own endpoints do take a database: export wants an existing directory, import
// wants the path of the .overall_export_metadata file in `export_directory`.
//
//   node named-db.js export <dir>    writes <dir>/<timestamp>/…, prints the path
//   node named-db.js import <dir>    imports the newest export under <dir>
const fs = require("fs");
const path = require("path");

const BASE = `http://127.0.0.1:${process.env.FIRESTORE_PORT ?? 8080}`;
const PROJECT = process.env.PROJECT ?? "demo-koryta-pl";
const DATABASE = `projects/${PROJECT}/databases/${process.env.DATABASE ?? "koryta-pl"}`;
const HEADERS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function call(verb, body) {
  const res = await fetch(`${BASE}/emulator/v1/projects/${PROJECT}:${verb}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ database: DATABASE, ...body }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`${verb} ${res.status}: ${await res.text()}`);
}

function newestMetadata(root) {
  if (!fs.existsSync(root)) return null;
  for (const run of fs.readdirSync(root).sort().reverse()) {
    const runDir = path.join(root, run);
    const sub = fs.readdirSync(runDir).find((d) => d.startsWith("firestore_export_"));
    const meta = sub && path.join(runDir, sub, `${sub}.overall_export_metadata`);
    if (meta && fs.existsSync(meta)) return meta;
  }
  return null;
}

async function main() {
  const [verb, root] = process.argv.slice(2);
  const started = Date.now();
  if (verb === "export") {
    const dir = path.join(root, new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    await call("export", { export_directory: dir });
    console.log(`named-db: exported ${DATABASE} to ${dir} in ${Date.now() - started} ms`);
  } else if (verb === "import") {
    const meta = newestMetadata(root);
    if (!meta) return console.log(`named-db: nothing to import under ${root}`);
    await call("import", { export_directory: meta });
    console.log(`named-db: imported ${meta} in ${Date.now() - started} ms`);
  } else {
    throw new Error("usage: named-db.js export|import <dir>");
  }
}

main().catch((err) => {
  console.error(`named-db: ${err.message}`);
  process.exit(1);
});
