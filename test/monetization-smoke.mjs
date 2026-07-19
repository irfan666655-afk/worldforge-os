/* monetization-smoke.mjs — frozen billing contract v1 against real kernel + ext */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WFKernel = require("../worldforge-kernel.v1.1.js");
const P2Ext = require("../src/wfkernel-p2-ext.v1.2.js");
const Mon = require("../src/wf.monetization.v1.js");

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.error("FAIL: " + n)); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };

function memStorage() {
  const mem = {};
  return {
    get: async (k) => (k in mem ? { key: k, value: mem[k] } : null),
    set: async (k, v) => { mem[k] = v; return { key: k, value: v }; },
    delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
    list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || "")) }),
    _mem: mem
  };
}
const STAGES = ["S0", "S1", "S2"];
const pipelineCanon = {
  stages: STAGES.map((s, i) => ({ id: "st" + i, label: s })),
  storage: { projectPrefix: "wfproj:" }, budget: { currency: "USD" }
};
const rosterCanon = { agents: [{ id: "producer", name: "Producer" }] };

const run = async () => {
  const storage = memStorage();
  const kernel = WFKernel.createKernel({
    storage, pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human"
  });
  P2Ext.install(kernel, { pipeline: pipelineCanon, roster: rosterCanon, storage });
  const p = await kernel.createProject({ name: "Billing", type: "film" });
  kernel.bindProject(p.id);

  /* install guards — manipulated billing parameters refuse install */
  t("install refuses missing rates", (() => { try { Mon.install(kernel, {}); return false; } catch { return true; } })());
  t("install refuses NaN rate", (() => { try { Mon.install(kernel, { rates: { x: NaN } }); return false; } catch { return true; } })());
  t("install refuses negative rate", (() => { try { Mon.install(kernel, { rates: { x: -1 } }); return false; } catch { return true; } })());
  t("install refuses bad currency", (() => { try { Mon.install(kernel, { rates: { x: 1 }, currency: "usd$" }); return false; } catch { return true; } })());

  const mon = Mon.install(kernel, { rates: { video_gen: 4, image_gen: 0.5 } });
  t("mock gateway flagged as mock", mon.gateway_is_mock === true);

  /* metering — frozen shape, fail-closed writes */
  const e1 = await mon.meter("video_gen", "producer");
  t("meter writes cost, never amount", e1.cost === 4 && !("amount" in e1) && e1.action === "meter:video_gen");
  await mon.meter("image_gen", "producer", 4);
  t("units multiply deterministically", kernel.getProjectState().metering_ledger.at(-1).cost === 2);
  t("unmetered type rejected", await rejects(mon.meter("nuke_gen", "producer")));
  t("zero/negative units rejected", await rejects(mon.meter("video_gen", "producer", 0)));
  t("missing actor rejected", await rejects(mon.meter("video_gen", "")));
  const persisted = JSON.parse(storage._mem["wfproj:" + p.id]);
  t("meter entries persisted (single write, FIFO)", persisted.metering_ledger.length === 2);
  t("metering separate from budget_ledger", (persisted.budget_ledger || []).length === 0);

  /* invoicing — deterministic + fail-closed on corruption */
  const inv1 = mon.invoice(), inv2 = mon.invoice();
  t("invoice deterministic (same ledger, same id)", inv1.invoice_id === inv2.invoice_id && inv1.total === 6);
  kernel.getProjectState().metering_ledger.push({ action: "meter:evil", actor: "x", amount: 99, cost: 0, ts: 1 });
  t("amount-injected row ABORTS invoicing (fail-closed)", (() => { try { mon.invoice(); return false; } catch { return true; } })());
  kernel.getProjectState().metering_ledger.pop();

  /* charge — tamper checks + ambiguous gateway = not charged */
  const tampered = { ...mon.invoice(), total: 0.01 };
  t("tampered total refuses to charge", await rejects(mon.charge(tampered)));
  const ok = await mon.charge(mon.invoice());
  t("clean charge receipts via mock", ok.ok === true && /^mockrcpt_/.test(ok.receipt.receipt_id) && ok.receipt.mock === true);
  t("billing_log records the receipt", kernel.getProjectState().billing_log.length === 1);

  const kernel2 = WFKernel.createKernel({
    storage: memStorage(), pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human"
  });
  P2Ext.install(kernel2, { pipeline: pipelineCanon, roster: rosterCanon, storage: memStorage() });
  const p2 = await kernel2.createProject({ name: "B2", type: "film" });
  kernel2.bindProject(p2.id);
  const badGateway = { charge: async () => null };                    // ambiguous response
  const mon2 = Mon.install(kernel2, { rates: { video_gen: 4 }, gateway: badGateway });
  await mon2.meter("video_gen", "producer");
  t("null gateway response = NOT charged (fail-closed)", await rejects(mon2.charge(mon2.invoice())));
  t("failed charge writes no billing_log", !(kernel2.getProjectState().billing_log || []).length);
  t("zero-total invoice refuses charge", await rejects(mon.charge({ ...mon.invoice(), total: 0 })));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
