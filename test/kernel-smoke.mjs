/* kernel-smoke.mjs — P4 smoke suite for worldforge-kernel.v1.1.js (Node, zero deps) */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WFKernel = require("../worldforge-kernel.v1.1.js");

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error("FAIL: " + name)); };

function memStorage(seed) {
  const mem = Object.assign({}, seed || {});
  return {
    get: async (k) => (k in mem ? { key: k, value: mem[k] } : null),
    set: async (k, v) => { mem[k] = v; return { key: k, value: v }; },
    delete: async (k) => { delete mem[k]; return { key: k, deleted: true }; },
    list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || "")) }),
    _mem: mem
  };
}
const STAGES = ["S0", "S1", "S2", "S3", "S4"];
const GATES = { 1: { title: "Gate after S1", text: "confirm" } };
const pipe = { stages: STAGES, gates: GATES, storage: { projectPrefix: "wfproj:", legacyKey: "worldforge-projects-v1" } };

/* -- contract guards -- */
t("throws without storage", (() => { try { WFKernel.createKernel({ pipeline: pipe }); return false; } catch (e) { return true; } })());
t("throws without pipeline", (() => { try { WFKernel.createKernel({ storage: memStorage() }); return false; } catch (e) { return true; } })());
t("throws on <2 stages", (() => { try { WFKernel.createKernel({ storage: memStorage(), pipeline: { stages: ["only"] } }); return false; } catch (e) { return true; } })());
t("version 1.1.1", WFKernel.KERNEL_VERSION === "1.1.1");
t("schema version 2", WFKernel.PROJECT_SCHEMA_VERSION === 2);

const run = async () => {
  const storage = memStorage();
  const k = WFKernel.createKernel({ storage, pipeline: pipe, actor: "human" });

  /* -- create + persist -- */
  const p = await k.createProject({ name: "Test Film", type: "film" });
  t("create returns project", !!p.id && p.stage === 0);
  t("create persists under wfproj:", !!storage._mem["wfproj:" + p.id]);
  t("schemaVersion stamped", JSON.parse(storage._mem["wfproj:" + p.id]).schemaVersion === 2);

  /* -- ungated advance -- */
  let r = await k.advance(p.id, null);
  t("ungated advance ok", r.ok && r.project.stage === 1);

  /* -- gate refusal (gate on LEAVING stage 1) -- */
  r = await k.advance(p.id, null);
  t("gated advance refused without confirm", !r.ok && r.reason === "gate" && r.gate.title === "Gate after S1");
  t("refusal did not advance", k.getProject(p.id).stage === 1);
  t("refusal recorded no decision", (k.getProject(p.id).decisions || []).length === 0);

  /* -- gate pass -- */
  r = await k.advance(p.id, { gatePassed: true, reason: "previz approved" });
  t("gate-pass advances", r.ok && r.project.stage === 2);
  t("gate-pass recorded", r.project.decisions.some((d) => d.kind === "gate-pass" && d.by === "human"));

  /* -- gate override requires reason -- */
  await k.stepBack(p.id, "rewind for override test");
  let threw = false;
  try { await k.advance(p.id, { override: true }); } catch (e) { threw = true; }
  t("override without reason throws", threw);
  r = await k.advance(p.id, { override: true, reason: "producer call" });
  t("override with reason advances + logs gate-override", r.ok && r.project.decisions.some((d) => d.kind === "gate-override"));

  /* -- step-back requires reason (Rule 7) -- */
  threw = false;
  try { await k.stepBack(p.id); } catch (e) { threw = true; }
  t("step-back without reason throws", threw);
  r = await k.stepBack(p.id, "continuity failure");
  t("step-back with reason works + records", r.ok && r.project.decisions.some((d) => d.kind === "step-back" && d.note === "continuity failure"));

  /* -- completion boundary -- */
  await k.advance(p.id, { gatePassed: true, reason: "again" }); // -> 2
  await k.advance(p.id, null); // -> 3
  await k.advance(p.id, null); // -> 4 (terminal)
  r = await k.advance(p.id, null);
  t("advance at terminal stage refuses", !r.ok && r.reason === "complete");

  /* -- notes single-persist -- */
  await k.saveNotes(p.id, "hello");
  t("notes persisted", JSON.parse(storage._mem["wfproj:" + p.id]).notes === "hello");

  /* -- decision cap 100 -- */
  const p2 = await k.createProject({ name: "CapTest" });
  for (let i = 0; i < 120; i++) { await k.advance(p2.id, null); await k.stepBack(p2.id, "r" + i); }
  t("decision cap holds at 100", k.getProject(p2.id).decisions.length === 100);

  /* -- freshen picks up external write -- */
  const ext = JSON.parse(storage._mem["wfproj:" + p.id]); ext.stage = 0; ext.notes = "external";
  storage._mem["wfproj:" + p.id] = JSON.stringify(ext);
  const fp = await k.freshen(p.id);
  t("freshen re-reads storage", fp.notes === "external" && fp.stage === 0);

  /* -- delete -- */
  await k.deleteProject(p.id);
  t("delete removes key", !("wfproj:" + p.id in storage._mem));
  t("delete removes from cache", !k.getProject(p.id));

  /* -- legacy migration (one-time, frozen decision) -- */
  const legacyStorage = memStorage({
    "worldforge-projects-v1": JSON.stringify([{ id: "old1", name: "Legacy", type: "film", stage: 2, notes: "", createdBy: "x", lastTouchedBy: "x", createdAt: 1, updatedAt: 1 }])
  });
  const k2 = WFKernel.createKernel({ storage: legacyStorage, pipeline: pipe, actor: () => "fn-actor" });
  const loaded = await k2.loadProjects();
  t("legacy blob migrated to per-project keys", !!legacyStorage._mem["wfproj:old1"]);
  t("migrated project loaded", loaded.length === 1 && loaded[0].id === "old1");
  t("migration adds decisions array + schema stamp", JSON.parse(legacyStorage._mem["wfproj:old1"]).schemaVersion === 2);

  /* -- actor-as-function seam -- */
  const p3 = await k2.createProject({ name: "FnActor" });
  t("actor function resolves", p3.createdBy === "fn-actor");

  /* -- eventing -- */
  let events = [];
  const un = k2.subscribe((e) => events.push(e.type));
  await k2.advance(p3.id, null);
  t("subscribe receives events", events.includes("advanced"));
  un();
  events = [];
  await k2.advance(p3.id, { gatePassed: true, reason: "x" });
  t("unsubscribe stops events", events.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
