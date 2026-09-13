import process from "node:process";
import { spawnSync } from "node:child_process";

// Local publishing must select the same production build as GitHub Actions.
const env = { ...process.env, CLOUDFLARE_ENV: "production", WRANGLER_SEND_METRICS: "false" };
delete env.MOVILOQ_WRANGLER_CONFIG;
for (const args of [
  ["node_modules/vite/bin/vite.js", "build"],
  ["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc", "--env", "production"],
  ["node_modules/wrangler/bin/wrangler.js", "deploy"]
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
