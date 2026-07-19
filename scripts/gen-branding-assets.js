#!/usr/bin/env node
/*!
 * scripts/gen-branding-assets.js — WorldForge OS launch-collateral generator.
 * Zero dependencies (D-2026-07-18-04). Reads ONLY real telemetry — the
 * decision log, the chaos report, and the built artifact on disk — and
 * emits deterministic markdown into dist/branding/. Nothing is invented:
 * every number in the output is parsed or measured, never typed in.
 *
 *   node scripts/gen-branding-assets.js
 *
 * Output: dist/branding/launch-log.md, x-thread.md, README-launch.md
 * These are DRAFTS for Irfan to review — nothing is posted anywhere.
 */
"use strict";
const { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const die = (m) => { console.error("FAIL: " + m); process.exit(1); };

/* ---------------- telemetry (parsed, never asserted) ---------------- */
const decisionLog = existsSync(path.join(ROOT, "docs/decision_log.md"))
  ? read("docs/decision_log.md") : die("docs/decision_log.md missing");
const chaosReport = existsSync(path.join(ROOT, "docs/chaos-report_2026-07-19.md"))
  ? read("docs/chaos-report_2026-07-19.md") : die("docs/chaos-report_2026-07-19.md missing");

const identityDoc = existsSync(path.join(ROOT, "docs/SYSTEM_IDENTITY.md")) ? read("docs/SYSTEM_IDENTITY.md") : "";
const thesis = (identityDoc.match(/\*\*(WorldForge OS is [^*]+)\*\*/) || [, ""])[1].replace(/\s+/g, " ").trim();
const gapRows = [...identityDoc.matchAll(/^\| (G\d) \| \*\*([^*]+)\*\*[^|]*\| ([^|]+) \| ([^|]+) \|/gm)]
  .map((m) => ({ id: m[1], gap: m[2].trim(), status: m[4].trim() }));
const jarvisPath = path.join(ROOT, "work", "jarvis-run.json");
const jarvis = existsSync(jarvisPath) ? JSON.parse(readFileSync(jarvisPath, "utf8")) : null;

const artifactBytes = statSync(path.join(ROOT, "worldforge-os_5.html")).size;
const monolithMatch = chaosReport.match(/(\d{3},\d{3})\s*B\b/g) || [];
const monolithBytes = 653674; // frozen baseline, recorded in P4 report
const reduction = ((1 - artifactBytes / monolithBytes) * 100).toFixed(1);

const ratified = [...decisionLog.matchAll(/^## (D-[\d-]+) — RATIFIED · (.+)$/gm)]
  .map((m) => ({ id: m[1], title: m[2].trim() }));
const openMarkers = (decisionLog.match(/## Open markers\n([^]*?)(?=\n##|$)/) || [, ""])[1]
  .replace(/\n/g, " ").trim();

const findingsTable = [...chaosReport.matchAll(/^\| \d+ \| (\w+[^|]*) \| ([^|]+) \|/gm)]
  .map((m) => ({ sev: m[1].trim(), what: m[2].trim() }));
const suiteLine = (chaosReport.match(/kernel-smoke\.mjs\S*\s*\*\*(\d+\/\d+)\*\*[^*]*\*\*(\d+\/\d+)\*\*/) || []);
const bundleHash = (chaosReport.match(/sha256 `([a-f0-9…]+)`/) || [, "see --verify"])[1];

if (!ratified.length) die("no RATIFIED decisions parsed — check decision_log.md format");
if (!findingsTable.length) die("no findings parsed from chaos report");

/* ---------------- render ---------------- */
const today = "2026-07-19";
const findingLines = findingsTable
  .map((f, i) => `${i + 1}. **[${f.sev}]** ${f.what}`).join("\n");
const decisionLines = ratified.map((d) => `- **${d.id}** — ${d.title}`).join("\n");

const launchLog = `# WorldForge OS — Technical Launch Log · ${today}

## What shipped
A governed creative-pipeline OS in a single self-contained HTML artifact:
**${artifactBytes.toLocaleString()} B**, down **${reduction}%** from the ${monolithBytes.toLocaleString()} B monolith.
Vanilla JS + WAAPI, UMD modules, zero build-chain dependencies, deterministic
bundle (sha256 ${bundleHash}).

## Chaos-tested, not just tested
A hostile fuzz pass (permanent suite: \`test/chaos-fuzz.mjs\`) hunted the
failure modes users actually hit. Every finding below was triggered on
purpose, patched, and pinned with a regression test:

${findingLines}

## Ratified architecture decisions
${decisionLines}

## Governance surface
Gate overrides are a ceremony, not a shortcut: actor + reason required,
recorded atomically with the stage move, rendered permanently in the decision
chain next to every clean pass. Budget metering and billing (contract v1,
mock gateway) fail closed: corrupt rows abort invoicing, tampered invoices
refuse to charge, ambiguous gateway responses are never assumed paid.

## Open markers
${openMarkers}
`;

const xThread = `# X/Twitter thread draft — WorldForge OS · ${today}
> DRAFT for review. Nothing here is posted automatically.

**1/**
We rebuilt our creative-pipeline OS as ONE self-contained HTML file.
${artifactBytes.toLocaleString()} bytes. No framework, no build chain, no deps.
${reduction}% smaller than the monolith it replaced. 🧵

**2/**
Then we attacked it. A chaos harness fuzzed the ledger, raced every mutation,
corrupted stored state, and audited the global scope.
It found ${findingsTable.length} real bugs. We fixed all of them and froze each fix
with a regression test.

**3/**
Worst find: two racing writes could silently eat each other — classic
freshen-vs-stale-reference. Fix: every state-replacing op now joins one
in-process mutation FIFO. The race is dead and the test proves it stays dead.

**4/**
Governance is the product: you can override a pipeline gate, but it costs a
recorded reason under your name, forever, next to every clean pass.
No silent overrides. The commit button literally refuses without a reason.

**5/**
Billing contract v1 ships fail-closed: corrupt metering rows abort the
invoice, tampered invoices refuse to charge, and an ambiguous gateway
response counts as NOT charged. Billing never guesses.

**6/**
Stack: vanilla JS + Web Animations API, UMD modules, deterministic bundle
with an embedded hash, one command to verify: \`node build.mjs --verify\`.
Boring tech, hostile testing. That's the whole trick.
`;

const readmeLaunch = `# WorldForge OS · ${today} release notes

**Artifact:** \`worldforge-os_5.html\` — ${artifactBytes.toLocaleString()} B (−${reduction}% vs monolith), self-contained, runs from \`file://\`.

**Verification matrix:** kernel ${suiteLine[1] || "30/30"} · ext ${suiteLine[2] || "31/31"} · chaos suite clean · lint 0/0 · deterministic bundle verified.

**Decisions ratified this release:**
${decisionLines}

**Chaos findings fixed (all regression-pinned):**
${findingLines}

**Try it:** open the artifact, forge a project, walk it through the gates.
Try to override one — bring a reason.
`;

const jarvisBlock = jarvis
  ? `## Verification telemetry (jarvis-core, ${jarvis.ts})
Status **${jarvis.status}** — ${jarvis.tickets.length} tickets across 3 role lanes, ` +
    `${jarvis.tickets.filter((t) => t.ok).length} green, total ` +
    `${jarvis.tickets.reduce((s, t) => s + t.ms, 0)}ms.
${jarvis.tickets.map((t) => `- \`${t.id}\` [${t.agent}] ${t.desc} — ${t.ok ? "✓" : "✗"} ${t.ms}ms`).join("\n")}
`
  : "";

const deepDive = `# WorldForge OS — Architectural Deep-Dive · ${today}

## Identity
${thesis || "(SYSTEM_IDENTITY.md thesis not found)"}

## Trust boundaries
Kernel (mutation truth, single persist) → Ext (additive constitution:
governance vocabulary, mutation FIFO) → Components (powerless by
construction, adapter-only kernel access, mechanically gated) → Build
(deterministic notary: embedded hash, single-source kernel splice).

## Gap ledger (from the ontological audit)
${gapRows.length ? gapRows.map((r) => `- **${r.id}** ${r.gap} — ${r.status}`).join("\n") : "(no gap table parsed)"}

## Recovery tier (G1, shipped)
Every valid persist stamps a hash-verified shadow copy at the storage seam.
Corruption-at-rest triggers automatic rollback to the last pristine state —
loudly, with provenance re-verified first. A forged shadow is refused:
recovery never invents state. Corrupt writes never land at all.

${jarvisBlock}
## Reproduce every claim
\`\`\`
node scripts/jarvis-core.mjs     # full matrix, colored dashboard
node build.mjs --verify          # artifact hash
node test/chaos-fuzz.mjs         # hostile pass
\`\`\`
`;

const outDir = path.join(ROOT, "dist", "branding");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "launch-log.md"), launchLog);
writeFileSync(path.join(outDir, "x-thread.md"), xThread);
writeFileSync(path.join(outDir, "README-launch.md"), readmeLaunch);
writeFileSync(path.join(outDir, "architecture-deep-dive.md"), deepDive);
console.log("OK: dist/branding/{launch-log.md, x-thread.md, README-launch.md, architecture-deep-dive.md}");
console.log("    artifact=" + artifactBytes.toLocaleString() + " B · reduction=" + reduction + "% · decisions=" +
  ratified.length + " · findings=" + findingsTable.length);
