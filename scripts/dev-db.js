// Local development PostgreSQL without Docker or a system install.
// Data lives in ./.devdb. Port 54329 so it never collides with a system Postgres.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".devdb");
const readyFlag = path.join(root, ".devdb-ready");
const port = Number(process.env.DEV_DB_PORT || 54329);
const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));

const pg = new EmbeddedPostgres({ databaseDir: dir, user: "desirelink", password: "desirelink", port, persistent: true, onLog: () => {} });

fs.rmSync(readyFlag, { force: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("desirelink").catch(() => {});
console.log(`[dev-db] postgres ready on :${port}`);

try {
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `postgresql://desirelink:desirelink@localhost:${port}/desirelink` },
  });
  fs.writeFileSync(readyFlag, String(Date.now()));
} catch (e) {
  console.error("[dev-db] migration failed", e.message);
}

const stop = async () => {
  fs.rmSync(readyFlag, { force: true });
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
