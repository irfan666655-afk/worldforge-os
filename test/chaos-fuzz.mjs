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
  const expected = new Set(["WFKernel", "WF", "WFKernelP2Ext", "WFUFDM", "WFGateOverride", "WFUFDMVisual", "WFRecovery"]);
  const leaks = added.filter((k) => !expected.has(k));
  if (leaks.length) finding("HIGH", "unexpected globals leaked by built artifact", leaks.join(", "));
  else console.log("[ok] globals confined to:", added.join(", ") || "(none registered pre-DOM)");
}

/* ---- 7. monetization layer: billing bypass + leakage attacks ---- */
{
  const Mon = require(ROOT + "src/wf.monetization.v1.js");
  const { kernel, storage, p } = await freshKernel();

  // 7a. post-install rate mutation (the caller keeps the rates reference)
  const attackerRates = { video_gen: 4 };
  const mon = Mon.install(kernel, { rates: attackerRates });
  attackerRates.video_gen = 0; // re-rate to free after install
  const e = await mon.meter("video_gen", "attacker");
  if (e.cost !== 4)
    finding("CRITICAL", "post-install rate mutation re-rates billing", "metered cost=" + e.cost + " expected 4");
  else console.log("[ok] rates copied+frozen at install — post-install mutation impotent");

  // 7b. amount-field smuggling into the metering ledger
  kernel.getProjectState().metering_ledger.push({ action: "meter:smuggle", actor: "x", amount: 9, cost: 0, ts: 1 });
  let aborted = false;
  try { mon.invoice(); } catch { aborted = true; }
  if (!aborted) finding("CRITICAL", "amount-smuggled row did not abort invoicing", "fail-open billing");
  else console.log("[ok] amount-smuggled ledger row aborts invoicing (fail-closed)");
  kernel.getProjectState().metering_ledger.pop();

  // 7c. invoice tamper: total, id, and line-item manipulation all refused
  const inv = mon.invoice();
  const tampers = [
    { ...inv, total: 0.01 },
    { ...inv, invoice_id: "inv_deadbeef" },
    { ...inv, line_items: [{ action: "meter:video_gen", cost: 0.01 }] },
    null,
  ];
  let passedTamper = 0;
  for (const bad of tampers) {
    try { await mon.charge(bad); passedTamper++; } catch { /* refused — correct */ }
  }
  if (passedTamper) finding("CRITICAL", "tampered invoice accepted by charge()", passedTamper + " of " + tampers.length + " tampers charged");
  else console.log("[ok] all " + tampers.length + " invoice tampers refused before the gateway");

  // 7d. racing meter() vs advance() — FIFO must hold for the billing ledger too
  await Promise.all([
    kernel.advance(p.id, null),
    mon.meter("video_gen", "producer"),
    mon.meter("video_gen", "producer"),
  ]);
  const persisted = JSON.parse(storage._mem["wfproj:" + p.id]);
  const meterCount = (persisted.metering_ledger || []).filter((x) => x.action === "meter:video_gen").length;
  if (meterCount !== 3)
    finding("HIGH", "racing meter/advance lost metering entries", "persisted=" + meterCount + " expected 3");
  else console.log("[ok] race: all metering entries survived advance(); stage=" + persisted.stage);

  // 7e. leakage: billing internals must not bleed into UFDM decision ledgers
  const doc = kernel.exportUFDM();
  const leak = JSON.stringify(doc.decision_log || []).includes("meter:");
  if (leak) finding("MEDIUM", "metering rows leak into decision ledgers", "meter: entries in decision_log");
  else console.log("[ok] metering ledger separate — no bleed into decision ledgers");
}

/* ---- 8. recovery layer: corruption-at-rest + provenance attacks ---- */
{
  const Rec = require(ROOT + "src/wf-recovery.v1.js");
  const mem = {};
  const raw = {
    get: async (k) => (k in mem ? { key: k, value: mem[k] } : null),
    set: async (k, v) => { mem[k] = v; return { key: k, value: v }; },
    delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
    list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || "")) }),
  };
  const silent = { error() {} };
  const realErr = console.error; console.error = silent.error;
  const s = Rec.wrap(raw, { prefixes: ["wfproj:"] });
  await s.set("wfproj:x", JSON.stringify({ id: "x", stage: 3, budget_ledger: [{ action: "a", cost: 5 }] }), true);

  // 8a. every corruption style must roll back to the pristine hash
  const corruptions = ["", "{", "null", "[1,2", "  ", "{\"id\":"];
  let healedAll = true;
  for (const c of corruptions) {
    mem["wfproj:x"] = c;
    const r = await s.get("wfproj:x", true);
    if (!r || !r.recovered || JSON.parse(r.value).stage !== 3) healedAll = false;
  }
  if (!healedAll) finding("CRITICAL", "corruption-at-rest not rolled back", "some corruption styles lost state");
  else console.log("[ok] " + corruptions.length + " corruption styles all rolled back to pristine hash");

  // 8b. forged shadow must be refused (provenance)
  mem["wfproj:x"] = "{corrupt";
  const sh = JSON.parse(mem["wfshadow:wfproj:x"]);
  sh.v = JSON.stringify({ id: "x", stage: 0, budget_ledger: [{ action: "steal", cost: 1e6 }] });
  mem["wfshadow:wfproj:x"] = JSON.stringify(sh);
  const forged = await s.get("wfproj:x", true);
  if (forged !== null) finding("CRITICAL", "forged shadow restored", "hash check bypassed");
  else console.log("[ok] forged shadow refused — recovery never invents state");

  // 8c. corrupt write must never land (fail-closed at the seam)
  let refusedWrite = false;
  try { await s.set("wfproj:y", "not-json", true); } catch { refusedWrite = true; }
  if (!refusedWrite || "wfproj:y" in mem) finding("CRITICAL", "corrupt write landed through recovery seam", "");
  else console.log("[ok] corrupt write refused at the seam — never persisted");
  console.error = realErr;
}

console.log("\n================ CHAOS REPORT ================");
if (!findings.length) console.log("no findings — all probes survived");
for (const f of findings) console.log(`[${f.sev}] ${f.name}\n    ${f.detail}`);
process.exit(0);
