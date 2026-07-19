/* wf-fuzz.mjs — chaos harness for WorldForge kernel v1.1 + ext v1.2.1
 * Attacks: malformed ledger shapes, cost/amount confusion, racing
 * mutations, subscription-chain integrity, corrupt storage entries,
 * global-scope leaks from the built bundle. Read-only against the repo. */
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).href.replace("file:///", "") + "/";
const WFKernel = require(ROOT + "worldforge-kernel.v1.1.js");
const P2Ext = require(ROOT + "src/wfkernel-p2-ext.v1.2.js");

let findings = [];
const finding = (sev, name, detail) => { findings.push({ sev, name, detail }); };

function memStorage(opts = {}) {
  const mem = {};
  return {
    get: async (k) => {
      if (opts.latency) await new Promise((r) => setTimeout(r, Math.random() * opts.latency));
      return k in mem ? { key: k, value: mem[k] } : null;
    },
    set: async (k, v, shared) => {
      if (opts.latency) await new Promise((r) => setTimeout(r, Math.random() * opts.latency));
      mem[k] = v; return { key: k, value: v };
    },
    delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
    list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || "")) }),
    _mem: mem,
  };
}
const STAGES = ["S0", "S1", "S2", "S3", "S4"];
const pipelineCanon = {
  stages: STAGES.map((s, i) => ({ id: "st" + i, label: s })),
  storage: { projectPrefix: "wfproj:", legacyKey: "worldforge-projects-v1" },
  budget: { currency: "USD" },
};
const rosterCanon = { agents: [{ id: "producer", name: "Producer" }] };

async function freshKernel(opts = {}) {
  const storage = memStorage(opts);
  const kernel = WFKernel.createKernel({
    storage,
    pipeline: { stages: STAGES, gates: opts.gates || {}, storage: pipelineCanon.storage },
    actor: "human",
  });
  P2Ext.install(kernel, { pipeline: pipelineCanon, roster: rosterCanon, storage });
  const p = await kernel.createProject({ name: "Fuzz", type: "film" });
  kernel.bindProject(p.id);
  return { kernel, storage, p };
}

/* ---- 1. malformed ledger shapes ---- */
{
  const { kernel } = await freshKernel();
  const evil = [
    { action: "a", cost: "40" },            // string cost
    { action: "b", cost: NaN },
    { action: "c", cost: -50 },             // negative
    { action: "d" },                        // missing cost
    { action: "e", cost: { $gt: 0 } },      // object injection
    { action: "f", cost: 1e308 },
    { action: "g", amount: 25 },            // legacy amount, no cost
    { cost: 10 },                           // missing action
    null,                                   // null entry — push straight to state
  ];
  for (const e of evil.slice(0, 8)) await kernel.updateBudget(e);
  kernel.getProjectState().budget_ledger.push(null); // simulate corrupted persisted row
  kernel.getProjectState().budget_start = 1000;
  let sum;
  try { sum = kernel.getBudgetSummary(); }
  catch (err) { finding("CRITICAL", "getBudgetSummary crashes on corrupt ledger", String(err)); }
  if (sum) {
    if (Number.isNaN(sum.spent) || Number.isNaN(sum.available))
      finding("CRITICAL", "NaN poisoning in budget summary", JSON.stringify(sum));
    else console.log("[ok] summary survives malformed entries:", JSON.stringify(sum));
    if (sum.spent < 0) console.log("[note] negative costs accepted (refunds?) — spent:", sum.spent);
  }
}

/* ---- 2. reserveBudget cost/amount conformance ---- */
{
  const { kernel } = await freshKernel();
  kernel.getProjectState().budget_start = 100;
  const r = await kernel.reserveBudget(30, "batch1");
  const entry = kernel.getProjectState().budget_ledger.at(-1);
  if (entry && entry.cost == null && entry.amount != null)
    finding("HIGH", "reserveBudget writes `amount`, violating the frozen `cost` shape",
      "entry=" + JSON.stringify(entry) + " — visual tier sums only `cost`; reservations invisible in UI, burnstrip renders NaN");
  else console.log("[ok] reserveBudget writes cost:", JSON.stringify(entry));
  // double-reserve past available must refuse
  const r2 = await kernel.reserveBudget(90, "overdraw");
  if (r2.ok) finding("HIGH", "reserveBudget overdraw accepted", JSON.stringify(r2));
  else console.log("[ok] overdraw refused:", r2.reason);
}

/* ---- 3. racing mutations under async storage latency ---- */
{
  const { kernel, storage, p } = await freshKernel({ latency: 8 });
  kernel.getProjectState().budget_start = 10000;
  await kernel._p2Persist(kernel.getProjectState());
  // fire advance + budget writes concurrently — freshen() may resurrect stale state
  await Promise.all([
    kernel.advance(p.id, null),
    kernel.updateBudget({ stage_id: "st0", actor: "human", action: "race1", cost: 1, ts: Date.now() }),
    kernel.updateBudget({ stage_id: "st0", actor: "human", action: "race2", cost: 1, ts: Date.now() }),
    kernel.advance(p.id, null),
  ]).catch(() => {});
  const persisted = JSON.parse(storage._mem["wfproj:" + p.id]);
  const lost = ["race1", "race2"].filter(
    (a) => !(persisted.budget_ledger || []).some((e) => e.action === a));
  if (lost.length)
    finding("HIGH", "racing advance() vs updateBudget() loses ledger entries",
      "lost=" + lost.join(",") + " persisted_ledger=" + JSON.stringify(persisted.budget_ledger || []) +
      " — kernel freshen() replaces the in-memory object advance mutates while ext pushed to the old reference");
  else console.log("[ok] race: all ledger entries survived; stage=" + persisted.stage);
}

/* ---- 4. subscription chain integrity ---- */
{
  const { kernel, p } = await freshKernel();
  const seen = [];
  const unsub = kernel.subscribe((e) => seen.push(e.type));
  kernel.subscribe(() => { throw new Error("hostile listener"); });
  await kernel.updateBudget({ action: "x", cost: 1 });          // ext-originated
  await kernel.saveNotes(p.id, "n");                            // kernel-originated
  if (!seen.includes("updateBudget") || !seen.includes("notes-saved"))
    finding("HIGH", "chained subscription drops a channel", JSON.stringify(seen));
  else console.log("[ok] one subscribe hears both kernel + ext channels:", JSON.stringify(seen));
  unsub();
  const before = seen.length;
  await kernel.updateBudget({ action: "y", cost: 1 });
  await kernel.saveNotes(p.id, "n2");
  if (seen.length !== before)
    finding("MEDIUM", "unsubscribe leaks: events still delivered after unsub", JSON.stringify(seen.slice(before)));
  else console.log("[ok] unsubscribe severs both channels; hostile listener never broke dispatch");
}

/* ---- 5. corrupt persisted project entries (fail-open probe) ---- */
{
  const storage = memStorage();
  storage._mem["wfproj:good"] = JSON.stringify({ id: "good", name: "G", stage: 0, decisions: [] });
  storage._mem["wfproj:bad"] = "{corrupt json!!";
  const kernel = WFKernel.createKernel({
    storage, pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human",
  });
  const events = [];
  kernel.subscribe((e) => events.push(e));
  const projects = await kernel.loadProjects();
  const loud = events.some((e) => /corrupt|error|skip/i.test(e.type));
  if (projects.length === 1 && !loud)
    finding("MEDIUM", "corrupt project entry skipped SILENTLY on load (fail-open)",
      "wfproj:bad dropped with no event/console signal — a user sees a project vanish with no trace");
  else console.log("[ok] corrupt entry handling is loud:", JSON.stringify(events.map((e) => e.type)));
}

/* ---- 6. global-scope leak audit on the BUILT artifact ---- */
{
  const html = readFileSync(ROOT + "worldforge-os_5.html", "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error() {} },
    document: undefined, window: undefined, // UMD must not need DOM at define time
  };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const baseline = new Set(Object.keys(sandbox));
  for (let i = 0; i < blocks.length; i++) {
    try { vm.runInContext(blocks[i], sandbox, { timeout: 5000 }); }
    catch (e) { console.log(`[note] block ${i + 1} define-time stop (DOM boot expected): ${String(e).slice(0, 90)}`); }
  }
  const added = Object.keys(sandbox).filter((k) => !baseline.has(k));
  const expected = new Set(["WFKernel", "WF", "WFKernelP2Ext", "WFUFDM", "WFGateOverride", "WFUFDMVisual"]);
  const leaks = added.filter((k) => !expected.has(k));
  if (leaks.length) finding("HIGH", "unexpected globals leaked by built artifact", leaks.join(", "));
  else console.log("[ok] globals confined to:", added.join(", ") || "(none registered pre-DOM)");
}

console.log("\n================ CHAOS REPORT ================");
if (!findings.length) console.log("no findings — all probes survived");
for (const f of findings) console.log(`[${f.sev}] ${f.name}\n    ${f.detail}`);
process.exit(0);
