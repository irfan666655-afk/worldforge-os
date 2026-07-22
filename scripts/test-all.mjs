#!/usr/bin/env node
/*!
 * scripts/test-all.mjs — portable, node-only aggregate test runner.
 *
 * Runs every unit + chaos suite in test/ sequentially and prints a single
 * rollup. Node-only (no Python) so it works in a minimal CI image; the full
 * 48-lane matrix (scripts/agent-matrix-48.mjs) additionally exercises the
 * Python linters and branding regeneration.
 *
 * Requires `npm ci` first: payment-bridge-smoke and chaos-fuzz do a live
 * HTTP round-trip through the real Express app (src/server.js), which needs
 * express/cors/dotenv. Suites that hard-depend on those deps fail loudly with
 * a clear hint rather than a raw MODULE_NOT_FOUND.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIR = path.join(ROOT, "test");

const SUITES = [
  ["kernel-smoke.mjs", "kernel contract"],
  ["p2-ext-smoke.mjs", "ext v1.2.1 + FIFO"],
  ["monetization-smoke.mjs", "billing contract"],
  ["recovery-smoke.mjs", "recovery / rollback"],
  ["event-chain-smoke.mjs", "SHA-256 event chain (G2)"],
  ["payment-bridge-smoke.mjs", "payment webhook bridge (MON-1)"],
  ["server-storage-smoke.mjs", "server recovery parity + atomic flush"],
  ["chaos-fuzz.mjs", "hostile chaos harness"],
];

// Preflight: warn early if the HTTP-dependent suites can't resolve express.
const needsExpress = fs.existsSync(path.join(ROOT, "node_modules", "express"));
if (!needsExpress) {
  console.error(
    "\x1b[33m[test-all] node_modules/express not found — run `npm ci` first.\n" +
    "           payment-bridge-smoke and chaos-fuzz drive a live HTTP round-trip.\x1b[0m"
  );
}

let failed = 0;
const rows = [];
const t0 = Date.now();

for (const [file, label] of SUITES) {
  const full = path.join(TEST_DIR, file);
  const started = Date.now();
  const r = spawnSync(process.execPath, [full], { encoding: "utf8" });
  const ms = Date.now() - started;
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const noFindings = /no findings/.test(out);
  const ok = r.status === 0;
  if (!ok) failed++;
  let detail;
  if (m) detail = `${m[1]} passed, ${m[2]} failed`;
  else if (noFindings) detail = "no findings — all probes survived";
  else detail = ok ? "ok" : "FAILED";
  rows.push({ file, label, ok, ms, detail, passed: m ? +m[1] : 0 });
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${label.padEnd(30)} ${String(ms).padStart(5)}ms  ${detail}`);
  if (!ok) {
    console.log("\x1b[31m" + out.trim().split("\n").slice(-8).join("\n") + "\x1b[0m");
  }
}

const totalAssertions = rows.reduce((n, r) => n + r.passed, 0);
const wall = Date.now() - t0;
console.log("  " + "─".repeat(58));
console.log(
  `  ${failed === 0 ? "\x1b[32mGREEN\x1b[0m" : "\x1b[31mRED\x1b[0m"} · ` +
  `${SUITES.length - failed}/${SUITES.length} suites · ${totalAssertions} unit assertions · ${wall}ms`
);
process.exit(failed === 0 ? 0 : 1);
