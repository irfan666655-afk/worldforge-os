#!/usr/bin/env node
/*!
 * scripts/validate-env.mjs — production infrastructure preflight.
 *
 *   node scripts/validate-env.mjs            report mode (always exits 0)
 *   node scripts/validate-env.mjs --strict   production gate (exit 2 on any gap)
 *
 * Report mode tells you which seams the server would boot DISABLED
 * (fail-closed, 503 + ENV code). Strict mode is what a production deploy
 * must pass — a deploy with unpopulated credentials is refused, not shipped
 * degraded.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try { require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true }); } catch { /* dotenv optional here */ }
const { validateEnv } = require(path.join(ROOT, "src", "env-validation.js"));

const strict = process.argv.includes("--strict");
const r = validateEnv(process.env);

console.log("wf env preflight — " + (r.ok ? "ALL SEAMS CREDENTIALED" : "DEGRADED (fail-closed seams below)"));
for (const [seam, live] of Object.entries(r.seams))
  console.log("  " + (live ? "LIVE     " : "DISABLED ") + seam);
for (const m of r.missing)
  console.log("  [" + m.code + "] " + m.key + " unset → " + m.seam + " refuses to operate. Fix: " + m.fix);

if (!r.ok && strict) {
  console.error("\nSTRICT: refusing — populate the keys above before a production deploy.");
  process.exit(2);
}
process.exit(0);
