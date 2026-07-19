#!/usr/bin/env node
/*!
 * scripts/jarvis-core.mjs — WorldForge OS local orchestration matrix.
 *
 * HONESTY CONTRACT: the three "agents" below are ROLE PERSONAS routing REAL
 * local jobs (linter, smoke suites, build gates, chaos harness) — no model
 * is called, nothing leaves this machine. The dashboard is a truthful view
 * of actual subprocess results; every ✓ is a real exit code 0.
 *
 *   node scripts/jarvis-core.mjs          full matrix
 *   node scripts/jarvis-core.mjs --fast   skip the chaos tier
 *
 * Output: colored terminal dashboard + work/jarvis-run.json (ingested by
 * scripts/gen-branding-assets.js).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAST = process.argv.includes("--fast");

/* ---------------- palette ---------------- */
const ESC = "\x1b[";
const C = {
  reset: ESC + "0m", dim: ESC + "2m", bold: ESC + "1m",
  fable: ESC + "38;5;213m",   // magenta — Core-Fable-5
  sonnet: ESC + "38;5;75m",   // blue    — Worker-Sonnet
  haiku: ESC + "38;5;114m",   // green   — Linter-Haiku
  ok: ESC + "38;5;114m", bad: ESC + "38;5;203m", ts: ESC + "38;5;245m",
};
const AGENTS = {
  "Core-Fable-5": { color: C.fable, brief: "meta-strategy · audit · anomaly detection" },
  "Worker-Sonnet": { color: C.sonnet, brief: "heavy state suites · logic compilation" },
  "Linter-Haiku": { color: C.haiku, brief: "hygiene · rules matrix · fast smoke" },
};
const tag = (a) => AGENTS[a].color + C.bold + "[" + a + "]" + C.reset;
const now = () => C.ts + new Date().toISOString().slice(11, 19) + C.reset;

/* ---------------- ticket queue (real jobs, explicit routing) ---------------- */
const TICKETS = [
  { id: "T-01", agent: "Linter-Haiku",  desc: "rules matrix freshness (gen_rules --check)",
    cmd: "python", args: ["gen_rules.py", "--check"] },
  { id: "T-02", agent: "Linter-Haiku",  desc: "full lint: roster + schema + artifact drift",
    cmd: "python", args: ["lint_worldforge.py", "--roster", "agent-roster.v5.2.json",
      "--schema", "asset-library-schema.v3.1.json", "--html", "worldforge-os_5.html"] },
  { id: "T-03", agent: "Worker-Sonnet", desc: "deterministic re-bundle",
    cmd: "node", args: ["build.mjs", "--bundle"] },
  { id: "T-04", agent: "Worker-Sonnet", desc: "bundle hash verification",
    cmd: "node", args: ["build.mjs", "--verify"] },
  { id: "T-05", agent: "Core-Fable-5",  desc: "global-scope confinement gate",
    cmd: "node", args: ["build.mjs", "--gate"] },
  { id: "T-06", agent: "Worker-Sonnet", desc: "kernel contract suite (30 cases)",
    cmd: "node", args: ["test/kernel-smoke.mjs"] },
  { id: "T-07", agent: "Worker-Sonnet", desc: "ext v1.2.1 suite (31 cases)",
    cmd: "node", args: ["test/p2-ext-smoke.mjs"] },
  { id: "T-08", agent: "Worker-Sonnet", desc: "billing contract suite (20 cases)",
    cmd: "node", args: ["test/monetization-smoke.mjs"] },
  { id: "T-09", agent: "Worker-Sonnet", desc: "recovery/rollback suite",
    cmd: "node", args: ["test/recovery-smoke.mjs"] },
  { id: "T-10", agent: "Core-Fable-5",  desc: "hostile chaos harness (8 probe families)",
    cmd: "node", args: ["test/chaos-fuzz.mjs"], skip: FAST },
];

/* ---------------- run loop ---------------- */
console.log("\n" + C.bold + "  WORLDFORGE OS · JARVIS ORCHESTRATION MATRIX" + C.reset);
console.log(C.dim + "  local role-routing over real jobs — no model calls, every ✓ is a real exit 0" + C.reset + "\n");
for (const [name, a] of Object.entries(AGENTS))
  console.log("  " + tag(name) + " " + C.dim + "online — " + a.brief + C.reset);
console.log();

const results = [];
let failures = 0;
for (const tk of TICKETS) {
  if (tk.skip) { console.log(`  ${now()} ${tag(tk.agent)} ${C.dim}${tk.id} SKIPPED (--fast): ${tk.desc}${C.reset}`); continue; }
  process.stdout.write(`  ${now()} ${tag(tk.agent)} ${tk.id} ${tk.desc} … `);
  const t0 = Date.now();
  const r = spawnSync(tk.cmd, tk.args, { cwd: ROOT, encoding: "utf8", timeout: 180000 });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (!ok) failures++;
  const lastLine = ((r.stdout || "").trim().split("\n").pop() || "").slice(0, 60);
  console.log((ok ? C.ok + "✓" : C.bad + "✗") + C.reset + C.ts + ` ${ms}ms` + C.reset + C.dim + (lastLine ? "  » " + lastLine : "") + C.reset);
  if (!ok) console.log(C.bad + (r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n") + C.reset);
  results.push({ id: tk.id, agent: tk.agent, desc: tk.desc, ok, ms, tail: lastLine });
}

/* Core-Fable anomaly synthesis: cross-reads every worker log (real routing). */
const anomalies = results.filter((r) => !r.ok).map((r) => r.id + " " + r.desc);
const artifactBytes = statSync(path.join(ROOT, "worldforge-os_5.html")).size;
console.log("\n  " + tag("Core-Fable-5") + " anomaly synthesis: " +
  (anomalies.length ? C.bad + anomalies.length + " anomalies → " + anomalies.join("; ") + C.reset
                    : C.ok + "zero anomalies across " + results.length + " tickets" + C.reset));

/* dashboard footer */
const byAgent = {};
for (const r of results) { (byAgent[r.agent] = byAgent[r.agent] || []).push(r); }
console.log("\n  ┌──────────────────── MATRIX ────────────────────┐");
for (const [name, rs] of Object.entries(byAgent)) {
  const okN = rs.filter((r) => r.ok).length;
  const ms = rs.reduce((s, r) => s + r.ms, 0);
  console.log(`  │ ${tag(name).padEnd(name.length + 20)} ${okN}/${rs.length} tickets · ${String(ms).padStart(6)}ms │`);
}
console.log("  └────────────────────────────────────────────────┘");
console.log(`  artifact: ${C.bold}${artifactBytes.toLocaleString()} B${C.reset} · status: ` +
  (failures ? C.bad + C.bold + "RED" : C.ok + C.bold + "GREEN") + C.reset + "\n");

/* persist run log for the branding pipeline */
mkdirSync(path.join(ROOT, "work"), { recursive: true });
writeFileSync(path.join(ROOT, "work", "jarvis-run.json"), JSON.stringify({
  ts: new Date().toISOString(), fast: FAST, artifactBytes,
  tickets: results, anomalies, status: failures ? "RED" : "GREEN"
}, null, 2));
console.log(C.dim + "  log → work/jarvis-run.json" + C.reset);
process.exit(failures ? 1 : 0);
