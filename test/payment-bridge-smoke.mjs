/* payment-bridge-smoke.mjs — MON-1 server bridge: webhook auth + chained provenance */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const WFKernel = require("../worldforge-kernel.v1.1.js");
const P2Ext = require("../src/wfkernel-p2-ext.v1.2.js");
const Chain = require("../src/wf-event-chain.v1.js");
const Bridge = require("../src/wf-payment-bridge.v1.js");
const { validateEnv } = require("../src/env-validation.js");

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.error("FAIL: " + n)); };
const throwsCode = (code, fn) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const rejectsCode = async (code, p) => { try { await p; return false; } catch (e) { return e.code === code; } };

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
async function mkKernel() {
  const storage = memStorage();
  const pipelineCanon = { stages: [{ id: "st0", label: "Open" }, { id: "st1", label: "Closed" }], storage: { projectPrefix: "wfproj:" }, budget: { currency: "USD" } };
  const kernel = WFKernel.createKernel({ storage, pipeline: { stages: ["Open", "Closed"], gates: {}, storage: pipelineCanon.storage }, actor: "server" });
  P2Ext.install(kernel, { pipeline: pipelineCanon, roster: { agents: [{ id: "payment-gateway", name: "PG" }] }, storage });
  const p = await kernel.createProject({ name: "gov", type: "ledger" });
  kernel.bindProject(p.id);
  Chain.install(kernel);
  return kernel;
}

const SECRET = "whsec_test_0123456789abcdef";
const NOW = 1_800_000_000;
const body = JSON.stringify({ id: "evt_001", type: "payment_intent.succeeded", data: { object: { amount: 12550, currency: "usd" } } });

const run = async () => {
  /* ---- signature verification: the accept path must exist ---- */
  const good = Bridge.signPayload(body, SECRET, NOW);
  t("valid signature verifies", Bridge.verifySignature({ rawBody: body, header: good, secret: SECRET, nowSec: NOW }).ok === true);
  t("HMAC agrees with node crypto directly",
    good.endsWith(crypto.createHmac("sha256", SECRET).update(NOW + "." + body).digest("hex")));

  /* ---- fail-closed rejects, each with its code ---- */
  t("PAY-01 no secret", throwsCode("PAY-01", () => Bridge.verifySignature({ rawBody: body, header: good, secret: "", nowSec: NOW })));
  t("PAY-02 malformed header", throwsCode("PAY-02", () => Bridge.verifySignature({ rawBody: body, header: "v1=deadbeef", secret: SECRET, nowSec: NOW })));
  t("PAY-03 stale timestamp (replay window)", throwsCode("PAY-03", () => Bridge.verifySignature({ rawBody: body, header: good, secret: SECRET, nowSec: NOW + 301 })));
  t("PAY-04 wrong secret", throwsCode("PAY-04", () => Bridge.verifySignature({ rawBody: body, header: Bridge.signPayload(body, "whsec_other", NOW), secret: SECRET, nowSec: NOW })));
  t("PAY-04 tampered body", throwsCode("PAY-04", () => Bridge.verifySignature({ rawBody: body.replace("12550", "12551"), header: good, secret: SECRET, nowSec: NOW })));

  /* ---- vocabulary translation: `amount` never survives ---- */
  const norm = Bridge.normalizeProcessorEvent(JSON.parse(body));
  t("processor amount (minor) -> cost (major)", norm.cost === 125.5 && norm.currency === "USD");
  t("normalized carries no `amount` key", !("amount" in norm));
  t("PAY-05 missing id", throwsCode("PAY-05", () => Bridge.normalizeProcessorEvent({ type: "x", cost: 1, currency: "usd" })));
  t("PAY-06 ambiguous money (both fields)", throwsCode("PAY-06", () => Bridge.normalizeProcessorEvent({ id: "e", type: "x", amount: 100, cost: 1, currency: "usd" })));
  t("PAY-06 no money field", throwsCode("PAY-06", () => Bridge.normalizeProcessorEvent({ id: "e", type: "x", currency: "usd" })));
  t("PAY-06 negative refused", throwsCode("PAY-06", () => Bridge.normalizeProcessorEvent({ id: "e", type: "x", cost: -1, currency: "usd" })));
  t("tx hash deterministic + key-order independent",
    Bridge.txHash(norm) === Bridge.txHash({ currency: norm.currency, cost: norm.cost, type: norm.type, id: norm.id }));

  /* ---- ingest: chained provenance ---- */
  const kernel = await mkKernel();
  const out = await Bridge.ingest(kernel, norm);
  const log = kernel.getProjectState().decision_log;
  t("payment record landed chained", log.length === 1 && log[0].kind === "payment-verified" && log[0]._chain.hash.length === 64);
  t("record carries cost, never amount", log[0].payment.cost === 125.5 && !("amount" in log[0].payment));
  t("chain head returned matches chain", out.chain_head === kernel.eventChainHead() && kernel.verifyEventChain().ok);
  t("PAY-07 duplicate refused, ledger untouched",
    (await rejectsCode("PAY-07", Bridge.ingest(kernel, norm))) && kernel.getProjectState().decision_log.length === 1);
  t("PAY-08 kernel without chain refused", await rejectsCode("PAY-08", Bridge.ingest({}, norm)));

  /* ---- env validation contract ---- */
  const ev = validateEnv({});
  t("empty env: every seam disabled with codes",
    !ev.ok && ev.seams["payment-webhook"] === false && ev.seams["roster-api"] === false &&
    ev.missing.some((m) => m.code === "ENV-03"));
  t("populated env: seams live",
    validateEnv({ SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k", WF_WEBHOOK_SECRET: "s" }).ok === true);

  /* ---- live HTTP round through the real express app ---- */
  process.env.WF_WEBHOOK_SECRET = SECRET;
  process.env.WF_GOV_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wfgov-")), "gov.json");
  const appMod = require("../src/server.js");
  const srv = appMod.listen(0);
  const port = srv.address().port;
  const post = (headers, raw) => new Promise((resolve, reject) => {
    const req = http.request({ port, path: "/api/webhooks/payment", method: "POST", headers: { "content-type": "application/json", ...headers } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    req.on("error", reject); req.end(raw);
  });
  const nowSec = Math.floor(Date.now() / 1000);
  const liveBody = JSON.stringify({ id: "evt_http_1", type: "payment_intent.succeeded", data: { object: { amount: 990, currency: "eur" } } });
  const okRes = await post({ "wf-signature": Bridge.signPayload(liveBody, SECRET, nowSec) }, liveBody);
  t("HTTP: signed webhook accepted, tx hash returned", okRes.status === 200 && okRes.body.tx_hash.length === 64);
  const dupRes = await post({ "wf-signature": Bridge.signPayload(liveBody, SECRET, nowSec) }, liveBody);
  t("HTTP: replayed event -> 409 PAY-07", dupRes.status === 409 && dupRes.body.code === "PAY-07");
  const spoofRes = await post({ "wf-signature": "t=" + nowSec + ",v1=" + "0".repeat(64) }, liveBody);
  t("HTTP: spoofed signature -> 401 PAY-04", spoofRes.status === 401 && spoofRes.body.code === "PAY-04");
  const govOnDisk = JSON.parse(fs.readFileSync(process.env.WF_GOV_FILE, "utf8"));
  const projKey = Object.keys(govOnDisk).find((k) => k.startsWith("wfproj:"));
  t("HTTP: provenance persisted to disk, chained", JSON.parse(govOnDisk[projKey]).decision_log[0]._chain.hash.length === 64);
  srv.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
