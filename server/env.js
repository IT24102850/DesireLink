// Outside production, the project's .env WINS over variables already set in
// the shell. (Node's --env-file never overrides, so a global DATABASE_URL from
// another project would silently point this app at the wrong database.)
// In production there is no .env file; configuration comes from the container.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (process.env.NODE_ENV !== "production" && fs.existsSync(file)) {
  Object.assign(process.env, parseEnv(fs.readFileSync(file, "utf8")));
}
