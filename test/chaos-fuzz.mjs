/* wf-fuzz.mjs — chaos harness for WorldForge kernel v1.1 + ext v1.2.1
 * Attacks: malformed ledger shapes, cost/amount confusion, racing
 * mutations, subscription-chain integrity, corrupt storage entries,
 * global-scope leaks from the built bundle. Read-only against the repo. */
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
// Cross-platform repo root. The prior `href.replace("file:///","")+"/"` idiom
// dropped the leading slash on POSIX (file:///tmp -> tmp) and doubled the
// trailing slash; fileURLToPath yields a correct absolute path (with trailing
// separator) on both Windows drive-letter and POSIX paths.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
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
  const expected = new Set(["WFKernel", "WF", "WFKernelP2Ext", "WFUFDM", "WFGateOverride", "WFUFDMVisual", "WFRecovery", "WFEventChain"]);
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

/* ---- 9. payment webhook seam: spoof, tamper, replay, race (MON-1 bridge) ---- */
{
  const Bridge = require(ROOT + "src/wf-payment-bridge.v1.js");
  const Chain = require(ROOT + "src/wf-event-chain.v1.js");
  const SECRET = "whsec_chaos";
  const NOW = 1_800_000_000;
  const evt = (id) => JSON.stringify({ id, type: "payment_intent.succeeded", data: { object: { amount: 5000, currency: "usd" } } });

  // 9a. signature fuzz storm — garbage + near-miss headers must ALL reject
  const body = evt("evt_chaos");
  const goodSig = Bridge.signPayload(body, SECRET, NOW);
  const spoofs = ["", "t=,v1=", "garbage", "t=" + NOW, "v1=" + "a".repeat(64),
    "t=" + NOW + ",v1=" + "0".repeat(64),
    "t=" + NOW + ",v1=" + goodSig.slice(-64, -1) + "f",         // 1-char forge
    "t=" + (NOW + 9999) + ",v1=" + goodSig.slice(-64),          // valid hmac, shifted ts
    goodSig.toUpperCase(), goodSig + ",v2=extra"];
  for (let i = 0; i < 40; i++) spoofs.push("t=" + NOW + ",v1=" + [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""));
  let accepted = 0;
  for (const h of spoofs) { try { Bridge.verifySignature({ rawBody: body, header: h, secret: SECRET, nowSec: NOW }); accepted++; } catch { /* rejected = correct */ } }
  if (accepted) finding("CRITICAL", "spoofed webhook signature accepted", accepted + " of " + spoofs.length + " forged headers verified");
  else console.log("[ok] " + spoofs.length + " spoofed/forged signature headers all refused");

  // 9b. byte-flip tamper — a signed-then-altered body must never verify
  let tamperPassed = 0;
  for (const pos of [0, 5, 20, body.length - 2]) {
    const flipped = body.slice(0, pos) + String.fromCharCode(body.charCodeAt(pos) ^ 1) + body.slice(pos + 1);
    try { Bridge.verifySignature({ rawBody: flipped, header: goodSig, secret: SECRET, nowSec: NOW }); tamperPassed++; } catch { }
  }
  if (tamperPassed) finding("CRITICAL", "tampered webhook body verified", tamperPassed + " byte-flips passed HMAC");
  else console.log("[ok] byte-flipped bodies all failed authentication");

  // 9c+9d. ingest under attack: concurrent distinct events all land chained,
  // concurrent DUPLICATES land exactly once, ledger stays verifiable
  const { kernel } = await freshKernel();
  Chain.install(kernel);
  const norm = (id) => Bridge.normalizeProcessorEvent(JSON.parse(evt(id)));
  const distinct = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) => Bridge.ingest(kernel, norm("evt_r" + i))));
  const dupes = await Promise.allSettled([0, 0, 0].map(() => Bridge.ingest(kernel, norm("evt_dup"))));
  const log = kernel.getProjectState().decision_log;
  const dupCount = log.filter((r) => r.payment && r.payment.event_id === "evt_dup").length;
  const v = kernel.verifyEventChain();
  if (distinct.some((r) => r.status === "rejected") || log.length !== 7)
    finding("HIGH", "concurrent distinct webhook ingests lost records", "landed=" + log.length + " expected 7");
  else if (dupCount !== 1 || dupes.filter((r) => r.status === "fulfilled").length !== 1)
    finding("CRITICAL", "concurrent duplicate ingest double-recorded a payment", "evt_dup landed " + dupCount + "x");
  else if (!v.ok) finding("CRITICAL", "payment ingest broke the event chain", JSON.stringify(v));
  else console.log("[ok] ingest race: 6 distinct landed, duplicate landed exactly once, chain verifies");

  // 9e. vocabulary law — no `amount` key anywhere in persisted records
  const hasAmount = (o) => o && typeof o === "object" && (("amount" in o) || Object.values(o).some(hasAmount));
  if (log.some(hasAmount)) finding("CRITICAL", "processor `amount` leaked into a governance record", "frozen cost vocabulary violated");
  else console.log("[ok] processor `amount` never survives into governance records");

  // 9f. live HTTP storm — malicious traffic refused LOUDLY, ledger untouched
  const os = await import("node:os"); const fs2 = await import("node:fs");
  const pathMod = await import("node:path"); const http = await import("node:http");
  process.env.WF_WEBHOOK_SECRET = SECRET;
  process.env.WF_GOV_FILE = pathMod.join(fs2.mkdtempSync(pathMod.join(os.tmpdir(), "wfchaos-")), "gov.json");
  const app = require(ROOT + "src/server.js");
  const srv = app.listen(0); const port = srv.address().port;
  const post = (headers, raw) => new Promise((resolve) => {
    const rq = http.request({ port, path: "/api/webhooks/payment", method: "POST", headers: { "content-type": "application/json", ...headers } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    rq.on("error", () => resolve(0)); rq.end(raw);
  });
  let loud = 0; const realErr2 = console.error; console.error = () => { loud++; };
  const nowSec = Math.floor(Date.now() / 1000);
  const liveBody = evt("evt_live");
  const okStatus = await post({ "wf-signature": Bridge.signPayload(liveBody, SECRET, nowSec) }, liveBody);
  const attackStatuses = [];
  for (let i = 0; i < 10; i++) attackStatuses.push(await post({ "wf-signature": "t=" + nowSec + ",v1=" + "f".repeat(64) }, liveBody));
  attackStatuses.push(await post({ "wf-signature": Bridge.signPayload(liveBody, SECRET, nowSec) }, liveBody));            // replay
  attackStatuses.push(await post({ "wf-signature": Bridge.signPayload("not-json", SECRET, nowSec) }, "not-json"));         // signed garbage
  attackStatuses.push(await post({}, liveBody));                                                                            // no header
  console.error = realErr2;
  srv.close();
  const gov = JSON.parse(fs2.readFileSync(process.env.WF_GOV_FILE, "utf8"));
  const govLog = JSON.parse(gov[Object.keys(gov).find((k) => k.startsWith("wfproj:"))]).decision_log;
  if (okStatus !== 200) finding("HIGH", "legitimate signed webhook refused over HTTP", "status=" + okStatus);
  else if (attackStatuses.some((s) => s < 400)) finding("CRITICAL", "malicious webhook traffic accepted over HTTP", attackStatuses.join(","));
  else if (govLog.length !== 1) finding("CRITICAL", "attack traffic mutated the governance ledger", "records=" + govLog.length + " expected 1");
  else if (!loud) finding("MEDIUM", "webhook refusals are silent", "fail-closed but not fail-loud");
  else console.log("[ok] HTTP storm: 1 legit landed, " + attackStatuses.length + " attacks refused loudly, ledger untouched");
}

console.log("\n================ CHAOS REPORT ================");
if (!findings.length) console.log("no findings — all probes survived");
for (const f of findings) console.log(`[${f.sev}] ${f.name}\n    ${f.detail}`);
process.exit(0);
