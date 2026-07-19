/* p2-ext-smoke.mjs — ext v1.2 against REAL worldforge-kernel.v1.1.js */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WFKernel = require("../worldforge-kernel.v1.1.js");
const P2Ext = require("../src/wfkernel-p2-ext.v1.2.js");

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.error("FAIL: " + n)); };

function memStorage() {
  const mem = {};
  return {
    get: async (k) => (k in mem ? { key: k, value: mem[k] } : null),
    set: async (k, v, shared) => { mem[k] = v; mem["__scope:" + k] = !!shared; return { key: k, value: v }; },
    delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
    list: async (p) => ({ keys: Object.keys(mem).filter((k) => !k.startsWith("__scope:") && k.startsWith(p || "")) }),
    _mem: mem
  };
}
const STAGES = ["S0", "S1", "S2", "S3"];
const pipelineCanon = {
  stages: STAGES.map((s, i) => ({ id: "st" + i, label: s })),
  storage: { projectPrefix: "wfproj:", legacyKey: "worldforge-projects-v1" },
  budget: { currency: "USD" }
};
const rosterCanon = { agents: [{ id: "creative-director", name: "Creative Director" }, { id: "producer", name: "Producer" }] };

const run = async () => {
  const storage = memStorage();
  const kernel = WFKernel.createKernel({
    storage, pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human"
  });

  /* install guards */
  t("install throws without pipeline", (() => { try { P2Ext.install(kernel, { roster: rosterCanon }); return false; } catch (e) { return true; } })());
  t("install throws without roster", (() => { try { P2Ext.install(kernel, { pipeline: pipelineCanon }); return false; } catch (e) { return true; } })());

  P2Ext.install(kernel, { pipeline: pipelineCanon, roster: rosterCanon, storage });
  t("version 1.x accepted (kernel 1.1.0)", true);
  t("getPipeline injected", kernel.getPipeline().stages.length === 4);
  t("getRoster injected", kernel.getRoster().agents.length === 2);

  /* binding */
  const p = await kernel.createProject({ name: "P2 Film", type: "film" });
  let threw = false;
  try { kernel.getProjectState(); } catch (e) { threw = true; }
  t("getProjectState throws unbound", threw);
  kernel.bindProject(p.id);
  t("getProjectState after bind", kernel.getProjectState().id === p.id);

  /* R5 fallbacks */
  const rec = kernel.recordDecision({ id: "dec_x", timestamp: new Date().toISOString(), actor: "human", action: "p2:test", impact: "low", rationale: "smoke", rule_overrides: [] });
  t("recordDecision fallback appends to decision_log", kernel.getProjectState().decision_log.length === 1 && rec.id === "dec_x");
  t("pipeline ledger untouched (R6 separation)", (kernel.getProjectState().decisions || []).length === 0);

  await kernel.updateBudget({ stage_id: "st1", actor: "human", action: "video_gen", cost: 40, ts: Date.now() });
  await kernel.updateBudget({ stage_id: "st1", actor: "human", action: "reserve:batch2", cost: 10, ts: Date.now() });
  const persisted = JSON.parse(storage._mem["wfproj:" + p.id]);
  t("updateBudget persists (single write)", persisted.budget_ledger && persisted.budget_ledger.length === 2);
  t("R3 fix: ext persist writes shared scope", storage._mem["__scope:wfproj:" + p.id] === true);

  /* budget summary — frozen `cost` field */
  kernel.getProjectState().budget_start = 100;
  const b = kernel.getBudgetSummary();
  t("summary reads frozen cost field", b.spent === 40 && b.reserved === 10 && b.available === 50);
  t("currency from canonical pipeline", b.currency === "USD");

  /* asset lock/unlock — Rule 7 */
  const s = kernel.getProjectState();
  s.assets = [{ id: "a1", name: "Hero Doll", locked: false }];
  const l = await kernel.lockAsset("a1");
  t("lockAsset", l.ok && kernel.getProjectState().assets[0].locked === true);
  const badUnlock = await kernel.unlockAsset("a1");
  t("unlock without reason refused (Rule 7)", badUnlock.ok === false);
  const u = await kernel.unlockAsset("a1", "re-shoot approved");
  t("unlock with reason ok + decision_log record", u.ok && kernel.getProjectState().decision_log.some((d) => d.kind === "asset-unlock"));

  /* UFDM export/validate */
  const doc = kernel.exportUFDM();
  t("exportUFDM carries real kernel version", doc.kernel_version === "1.1.1");
  t("exportUFDM stages canonical", doc.stages.length === 4 && doc.stages[0].id === "st0");
  const v = kernel.validateUFDM(doc);
  t("validateUFDM roundtrip clean", v.ok !== false || (v.problems || []).length === 0);
  const bad = JSON.parse(JSON.stringify(doc)); bad.stages = bad.stages.slice(0, 1);
  const v2 = kernel.validateUFDM(bad);
  t("validateUFDM catches broken stages", (v2.problems || []).length > 0);

  /* eventing wrap */
  let evts = [];
  kernel.subscribe((e) => evts.push(e.type));
  await kernel.updateBudget({ stage_id: "st2", actor: "human", action: "image_gen", cost: 5, ts: Date.now() });
  t("mutator wrapper notifies", evts.includes("updateBudget"));

  /* ---- v1.2.1: burned read seams (handoff Step 4.4) ---- */
  t("getLedger seam reads budget_ledger", kernel.getLedger().length === 3 && kernel.getLedger()[0].cost === 40);
  t("getBudget seam reads budget_start", kernel.getBudget().budget_start === 100);
  const chain = kernel.getDecisions();
  t("getDecisions merges decision_log into the chain", chain.some((d) => d.kind === "asset-unlock") && chain.some((d) => d.id === "dec_x"));

  /* ---- v1.2.1: UI1-K1 gate-override seam over atomic advance ---- */
  const storage2 = memStorage();
  const gated = WFKernel.createKernel({
    storage: storage2,
    pipeline: { stages: STAGES, gates: { 0: { title: "G0", text: "gate zero" } }, storage: pipelineCanon.storage },
    actor: "human"
  });
  P2Ext.install(gated, { pipeline: pipelineCanon, roster: rosterCanon, storage: storage2 });
  const gp = await gated.createProject({ name: "Gated", type: "film" });
  gated.bindProject(gp.id);
  let rej = false;
  await gated.recordGateOverride(gp.id, {}).catch(() => { rej = true; });
  t("override without reason rejected (Rule 7)", rej);
  const ores = await gated.recordGateOverride(gp.id, { kind: "gate-override", reason: "smoke override", ts: new Date().toISOString() });
  t("override records AND advances atomically", ores.ok && ores.project.stage === 1 &&
    gated.getProject(gp.id).decisions.some((d) => d.kind === "gate-override" && d.note === "smoke override"));
  rej = false;
  await gated.recordGateOverride(gp.id, { reason: "no gate here" }).catch(() => { rej = true; });
  t("override on ungated stage rejected (no silent advance)", rej);

  /* ---- chaos-immunity regressions (fuzz findings 2026-07-19) ---- */
  // 1. corrupt ledger row must not crash the summary — counted, not fatal
  kernel.getProjectState().budget_ledger.push(null);
  let csum = null;
  try { csum = kernel.getBudgetSummary(); } catch (e) { /* fails the test below */ }
  t("summary survives corrupt ledger row (counted)", !!csum && csum.corrupt === 1 && !Number.isNaN(csum.spent));
  kernel.getProjectState().budget_ledger.pop();

  // 2. reserveBudget writes the frozen `cost` field, never `amount`
  const rr = await kernel.reserveBudget(5, "regress");
  const rentry = kernel.getProjectState().budget_ledger.at(-1);
  t("reserveBudget writes cost (frozen shape)", rr.ok && rentry.cost === 5 && rentry.amount === undefined);

  // 3. racing advance vs updateBudget loses no writes (per-project FIFO)
  {
    const slowStore = (() => {
      const mem = {}; const nap = () => new Promise((r) => setTimeout(r, Math.random() * 6));
      return {
        get: async (k) => { await nap(); return k in mem ? { key: k, value: mem[k] } : null; },
        set: async (k, v) => { await nap(); mem[k] = v; return { key: k, value: v }; },
        delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
        list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || "")) }),
        _mem: mem
      };
    })();
    const rk = WFKernel.createKernel({
      storage: slowStore, pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human"
    });
    P2Ext.install(rk, { pipeline: pipelineCanon, roster: rosterCanon, storage: slowStore });
    const rp = await rk.createProject({ name: "Race", type: "film" });
    rk.bindProject(rp.id);
    await Promise.all([
      rk.advance(rp.id, null),
      rk.updateBudget({ stage_id: "st0", actor: "human", action: "race1", cost: 1, ts: Date.now() }),
      rk.updateBudget({ stage_id: "st0", actor: "human", action: "race2", cost: 1, ts: Date.now() }),
      rk.advance(rp.id, null)
    ]);
    const rstate = JSON.parse(slowStore._mem["wfproj:" + rp.id]);
    const survived = ["race1", "race2"].every((a) => (rstate.budget_ledger || []).some((e) => e.action === a));
    t("racing advance/updateBudget loses no ledger writes", survived && rstate.stage === 2);

    // 4. browser-proven first-use race: in-flight loadProjects() must not
    // wipe a concurrent createProject() from memory (global FIFO)
    const [, created] = await Promise.all([
      rk.loadProjects(),
      rk.createProject({ name: "Race2", type: "film" })
    ]);
    t("racing loadProjects/createProject keeps the new project in memory",
      !!rk.getProject(created.id));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
