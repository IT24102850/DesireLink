// Runs the Prisma CLI with the project's .env taking precedence (see server/env.js).
//   npm run prisma -- migrate dev --name add_something
import "../server/env.js";
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["prisma", ...process.argv.slice(2)], { stdio: "inherit", shell: true, env: process.env });
process.exit(r.status ?? 1);
