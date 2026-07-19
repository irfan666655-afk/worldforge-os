/*!
 * wf-payment-bridge.v1.js — WorldForge OS server-side payment provenance seam (MON-1 bridge)
 *
 * SERVER-SIDE ONLY. This module is deliberately absent from the build.mjs
 * bundle manifest: the offline artifact's isolation (MON-1 bundle exclusion,
 * D-2026-07-19-03) is untouched. It runs in src/server.js, where a network
 * and secrets can legitimately exist.
 *
 * WHAT IT IS: the verification + provenance half of a payment integration.
 *   1. verifySignature — Stripe-scheme webhook authentication:
 *      header `t=<unix>,v1=<hex>`, HMAC-SHA256 over `${t}.${rawBody}`,
 *      constant-time compare, bounded timestamp tolerance (replay window).
 *   2. normalizeProcessorEvent — translates processor vocabulary into the
 *      frozen ledger vocabulary: money lands as `cost` (major units).
 *      `amount` is processor dialect and NEVER survives into a record.
 *   3. ingest — appends a `payment-verified` governance record through the
 *      kernel's recordDecision channel, so it is hash-chained by
 *      wf-event-chain (G2) and persisted once (single-persist discipline).
 *
 * WHAT IT IS NOT: it moves no money, calls no processor API, and holds no
 * card data. It only proves "a correctly-signed webhook arrived and was
 * recorded immutably". Charging remains behind the MON-1 gateway decision.
 *
 * FAIL-CLOSED LAW (every clause probed in test/payment-bridge-smoke.mjs and
 * fuzzed in test/chaos-fuzz.mjs §8):
 *   - no secret configured        -> PAY-01, nothing verifies
 *   - malformed signature header  -> PAY-02
 *   - timestamp outside tolerance -> PAY-03 (replay refused)
 *   - HMAC mismatch               -> PAY-04
 *   - event without id/type       -> PAY-05
 *   - ambiguous money             -> PAY-06 (never guessed)
 *   - duplicate event id          -> PAY-07 (idempotent, ledger untouched)
 */
"use strict";

var crypto = require("node:crypto");
var Chain = require("./wf-event-chain.v1.js");

var TOLERANCE_SEC = 300;

function PaymentBridgeError(code, msg) {
  var e = new Error("wf-payment-bridge " + code + ": " + msg);
  e.name = "PaymentBridgeError";
  e.code = code;
  return e;
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/* Test-mode signer. Exists so probes can mint VALID signatures against a
 * known secret — the suite must exercise the accept path, not only rejects. */
function signPayload(rawBody, secret, tsSec) {
  var t = Math.floor(tsSec);
  return "t=" + t + ",v1=" + hmacHex(secret, t + "." + rawBody);
}

/* Verify a webhook signature. Returns { ok:true, ts } or throws coded. */
function verifySignature(opts) {
  opts = opts || {};
  var rawBody = opts.rawBody, header = opts.header, secret = opts.secret;
  var nowSec = typeof opts.nowSec === "number" ? opts.nowSec : Math.floor(Date.now() / 1000);
  var tolerance = typeof opts.toleranceSec === "number" ? opts.toleranceSec : TOLERANCE_SEC;

  if (typeof secret !== "string" || !secret.trim())
    throw PaymentBridgeError("PAY-01", "no webhook secret configured — set WF_WEBHOOK_SECRET (fail-closed: nothing verifies without it)");
  if (typeof rawBody !== "string" || typeof header !== "string")
    throw PaymentBridgeError("PAY-02", "raw body and signature header are both required");

  var m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) throw PaymentBridgeError("PAY-02", "malformed signature header — expected t=<unix>,v1=<hex64>");

  var ts = parseInt(m[1], 10);
  if (!isFinite(ts) || Math.abs(nowSec - ts) > tolerance)
    throw PaymentBridgeError("PAY-03", "timestamp outside " + tolerance + "s tolerance — replay refused");

  var expected = hmacHex(secret, ts + "." + rawBody);
  var a = Buffer.from(expected, "hex"), b = Buffer.from(m[2], "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw PaymentBridgeError("PAY-04", "signature mismatch — payload not authenticated by the shared secret");

  return { ok: true, ts: ts };
}

/* Processor payload -> frozen vocabulary. Accepts either a Stripe-shaped
 * event ({ id, type, data:{object:{amount, currency}} }, amount in minor
 * units) or an already-normalized { id, type, cost, currency }. Output
 * carries `cost` in major units; `amount` never survives. */
function normalizeProcessorEvent(payload) {
  if (!payload || typeof payload !== "object")
    throw PaymentBridgeError("PAY-05", "event payload must be an object");
  if (typeof payload.id !== "string" || !payload.id.trim())
    throw PaymentBridgeError("PAY-05", "event requires a string id (idempotency key)");
  if (typeof payload.type !== "string" || !payload.type.trim())
    throw PaymentBridgeError("PAY-05", "event requires a string type");

  var obj = payload.data && payload.data.object ? payload.data.object : payload;
  var hasAmount = typeof obj.amount === "number";
  var hasCost = typeof obj.cost === "number";
  if (hasAmount && hasCost)
    throw PaymentBridgeError("PAY-06", "ambiguous money: both `amount` and `cost` present — refused, never guessed");
  if (!hasAmount && !hasCost)
    throw PaymentBridgeError("PAY-06", "no money field: expected processor `amount` (minor units) or `cost` (major units)");

  var cost = hasCost ? obj.cost : obj.amount / 100;
  if (!isFinite(cost) || cost < 0)
    throw PaymentBridgeError("PAY-06", "money must be finite and >= 0, got: " + String(cost));
  if (typeof obj.currency !== "string" || !/^[A-Za-z]{3}$/.test(obj.currency))
    throw PaymentBridgeError("PAY-06", "currency must be a 3-letter code");

  return { id: payload.id, type: payload.type, cost: cost, currency: obj.currency.toUpperCase() };
}

/* Deterministic transaction hash over the normalized event — same primitive
 * and canonicalization as the G2 event chain, so provenance is one system. */
function txHash(normalized) {
  return Chain.sha256(Chain._canonical(normalized));
}

/* Append a verified payment into the governance log. The kernel must have
 * the ext + event chain installed. In-process duplicate safety: the scan
 * and recordDecision append are one synchronous block (no await between
 * them), so concurrent ingests of the same id cannot both pass the scan. */
async function ingest(kernel, normalized, opts) {
  opts = opts || {};
  if (!kernel || typeof kernel.recordDecision !== "function" || typeof kernel.verifyEventChain !== "function")
    throw PaymentBridgeError("PAY-08", "kernel with ext + event chain required (install both first)");

  var state = kernel.getProjectState();
  var log = state.decision_log || [];
  for (var i = 0; i < log.length; i++) {
    var p = log[i].payment;
    if (p && p.event_id === normalized.id)
      throw PaymentBridgeError("PAY-07", "duplicate event " + normalized.id + " — already recorded at index " + i + " (ledger untouched)");
  }

  var hash = txHash(normalized);
  var rec = {
    id: "dec_pay_" + normalized.id,
    kind: "payment-verified",
    actor: typeof opts.actor === "string" && opts.actor.trim() ? opts.actor : "payment-gateway",
    reason: "webhook " + normalized.type + " verified (HMAC) · tx " + hash.slice(0, 12),
    impact: "high",
    ts: new Date(typeof opts.now === "number" ? opts.now : Date.now()).toISOString(),
    payment: {
      event_id: normalized.id,
      type: normalized.type,
      cost: normalized.cost,
      currency: normalized.currency,
      tx_hash: hash
    }
  };
  kernel.recordDecision(rec);
  await kernel._p2Persist(kernel.getProjectState());
  return { tx_hash: hash, chain_head: kernel.eventChainHead() };
}

module.exports = {
  VERSION: "1.0.0",
  TOLERANCE_SEC: TOLERANCE_SEC,
  signPayload: signPayload,
  verifySignature: verifySignature,
  normalizeProcessorEvent: normalizeProcessorEvent,
  txHash: txHash,
  ingest: ingest
};
