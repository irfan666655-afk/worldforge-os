/* event-chain-smoke.mjs — G2 cryptographic event provenance (PROV-1) */
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const WFKernel = require("../worldforge-kernel.v1.1.js");
const P2Ext = require("../src/wfkernel-p2-ext.v1.2.js");
const Chain = require("../src/wf-event-chain.v1.js");

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.error("FAIL: " + n)); };

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
const pipelineCanon = { stages: STAGES.map((s, i) => ({ id: "st" + i, label: s })), storage: { projectPrefix: "wfproj:" }, budget: { currency: "USD" } };
const rosterCanon = { agents: [{ id: "producer", name: "Producer" }] };

const mkRec = (i) => ({ id: "dec_" + i, kind: "promotion", actor: "producer", reason: "r" + i, impact: "low", ts: "2026-07-19T00:0" + i + ":00Z" });

const run = async () => {
  /* SHA-256 correctness — the chain is worthless if the primitive is wrong */
  const vectors = ["", "abc", "hello world", "x".repeat(64), "x".repeat(65), "héllo ✓", "🔥pair🔥"];
  t("pure-JS SHA-256 matches Node crypto on all vectors",
    vectors.every((v) => Chain.sha256(v) === crypto.createHash("sha256").update(v, "utf8").digest("hex")));

  const storage = memStorage();
  const kernel = WFKernel.createKernel({
    storage, pipeline: { stages: STAGES, gates: {}, storage: pipelineCanon.storage }, actor: "human"
  });
  P2Ext.install(kernel, { pipeline: pipelineCanon, roster: rosterCanon, storage });
  const p = await kernel.createProject({ name: "Chain", type: "film" });
  kernel.bindProject(p.id);
  Chain.install(kernel);

  t("install refuses a kernel without ext", (() => { try { Chain.install({}); return false; } catch { return true; } })());
  t("empty chain verifies (genesis)", kernel.verifyEventChain().ok && kernel.eventChainHead() === Chain.GENESIS);

  for (let i = 0; i < 5; i++) kernel.recordDecision(mkRec(i));
  const log = () => kernel.getProjectState().decision_log;
  t("every record is chained", log().length === 5 && log().every((r) => r._chain && r._chain.hash.length === 64));
  t("links reference the previous hash", log().every((r, i) => r._chain.prev === (i === 0 ? Chain.GENESIS : log()[i - 1]._chain.hash)));
  t("clean chain verifies", kernel.verifyEventChain().ok === true);
  t("head is the tail hash", kernel.eventChainHead() === log()[4]._chain.hash);
  t("frozen shape preserved (no fields lost)", log()[0].id === "dec_0" && log()[0].reason === "r0" && log()[0].kind === "promotion");

  /* determinism: same content + same prev => same hash */
  const h = Chain.sha256(Chain._canonical(mkRec(0)));
  t("digest deterministic + key-order independent",
    h === Chain.sha256(Chain._canonical({ ts: mkRec(0).ts, reason: "r0", impact: "low", actor: "producer", kind: "promotion", id: "dec_0" })));

  /* TAMPER DETECTION — the entire point */
  const snapshot = () => JSON.parse(JSON.stringify(log()));
  const restore = (snap) => { kernel.getProjectState().decision_log = snap; };

  let snap = snapshot();
  log()[2].reason = "quietly rewritten history";
  let v = kernel.verifyEventChain();
  t("content tampering detected at the exact index", v.ok === false && v.brokenAt === 2 && /altered/.test(v.reason));
  restore(snap);

  snap = snapshot();
  kernel.getProjectState().decision_log.splice(2, 1);
  v = kernel.verifyEventChain();
  t("deletion detected", v.ok === false && v.brokenAt === 2);
  restore(snap);

  snap = snapshot();
  const l = kernel.getProjectState().decision_log;
  [l[1], l[3]] = [l[3], l[1]];
  v = kernel.verifyEventChain();
  t("reordering detected", v.ok === false);
  restore(snap);

  snap = snapshot();
  kernel.getProjectState().decision_log.push({ id: "dec_forged", kind: "promotion", actor: "attacker", reason: "smuggled in" });
  v = kernel.verifyEventChain();
  t("unchained insertion detected", v.ok === false && /unchained/.test(v.reason));
  restore(snap);

  // forging a link requires recomputing everything forward — a partial forge fails
  snap = snapshot();
  const victim = kernel.getProjectState().decision_log[1];
  victim.reason = "forged";
  victim._chain.hash = Chain.sha256(victim._chain.prev + "|" + Chain._canonical(victim));
  v = kernel.verifyEventChain();
  t("partial re-forge breaks the FOLLOWING link (chain property holds)", v.ok === false && v.brokenAt === 2);
  restore(snap);

  t("chain verifies again after every restore", kernel.verifyEventChain().ok === true);

  /* survives persistence round-trip */
  await kernel._p2Persist(kernel.getProjectState());
  const reloaded = JSON.parse(storage._mem["wfproj:" + p.id]);
  const prevHashes = reloaded.decision_log.map((r) => r._chain.prev);
  t("chain survives persist/reload intact", prevHashes[0] === Chain.GENESIS && reloaded.decision_log.length === 5);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
