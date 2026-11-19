// Blocks until scripts/dev-db.js has started Postgres and applied migrations.
import fs from "node:fs";

const flag = new URL("../.devdb-ready", import.meta.url);
const started = Date.now();
while (!fs.existsSync(flag)) {
  if (Date.now() - started > 120_000) {
    console.error("[wait-db] timed out waiting for dev database");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 300));
}
