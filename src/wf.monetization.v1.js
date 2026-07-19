/*!
 * wf.monetization.v1.js — WorldForge OS commercial layer (FROZEN CONTRACT v1)
 *
 * Ratified D-2026-07-19-03. Deterministic usage metering + tamper-checked
 * invoicing on the frozen ledger vocabulary: entries carry `cost` — NEVER
 * `amount` (the fuzz-proven bug class) — under a `meter:` action prefix in
 * their own `state.metering_ledger`, kept separate from `budget_ledger`
 * (R6-style separation: money spent making the thing vs money owed for
 * using the thing).
 *
 * FAIL-CLOSED LAW (every clause chaos-tested in test/chaos-fuzz.mjs):
 *   - a malformed meter entry throws at write time — it never lands;
 *   - a corrupt row in the ledger ABORTS invoicing (billing never guesses);
 *   - an invoice whose total does not recompute from the ledger refuses to
 *     charge (tamper check);
 *   - a null/ambiguous gateway response is a FAILURE, never assumed paid.
 *
 * GATEWAY (marker MON-1): the default gateway is a MOCK — it validates and
 * receipts, moves no money, and exists so the charge seam can be exercised.
 * No real payment processing exists in this codebase. This module stays OUT
 * of the browser bundle manifest until a real-gateway decision is recorded
 * in docs/decision_log.md.
 *
 * Persistence: joins the ext's mutation FIFO via kernel._p2Enqueue
 * (D-2026-07-19-02) so meter writes cannot re-create the lost-write race.
 * UMD, zero dependencies (D-2026-07-18-04).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFMonetization = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CONTRACT_VERSION = "1.0.0";

  function MonetizationError(msg) {
    var e = new Error("WFMonetization: " + msg);
    e.name = "MonetizationError";
    return e;
  }

  /* Frozen-shape validation. Throws — a bad entry never lands. */
  function validateEntry(e) {
    if (!e || typeof e !== "object") throw MonetizationError("meter entry must be an object");
    if ("amount" in e) throw MonetizationError("frozen shape violation: `amount` is forbidden — the field is `cost`");
    if (typeof e.action !== "string" || e.action.indexOf("meter:") !== 0)
      throw MonetizationError("meter entry action must be a 'meter:'-prefixed string");
    if (typeof e.actor !== "string" || !e.actor.trim())
      throw MonetizationError("meter entry requires an actor (Rule 7 — usage is attributable)");
    if (typeof e.cost !== "number" || !isFinite(e.cost) || e.cost < 0)
      throw MonetizationError("meter entry cost must be a finite number >= 0, got: " + String(e.cost));
    if (typeof e.ts !== "number" || !isFinite(e.ts))
      throw MonetizationError("meter entry requires a numeric ts");
    return e;
  }

  /* Deterministic mock gateway — validates, receipts, moves no money. */
  function MockGateway() {
    var seq = 0;
    return {
      mock: true,
      charge: function (invoice) {
        seq += 1;
        return Promise.resolve({
          ok: true,
          receipt_id: "mockrcpt_" + invoice.invoice_id + "_" + seq,
          charged: invoice.total,
          currency: invoice.currency,
          mock: true
        });
      }
    };
  }

  function install(kernel, opts) {
    if (!kernel || typeof kernel.getProjectState !== "function")
      throw MonetizationError("kernel with P2 ext required (getProjectState missing — install ext first)");
    opts = opts || {};

    /* Rates are the billing parameters — validated like entries: a
     * manipulated or null rate table refuses install (fail-closed). */
    var ratesIn = opts.rates;
    if (!ratesIn || typeof ratesIn !== "object" || Array.isArray(ratesIn))
      throw MonetizationError("rates table required: { eventType: costPerUnit }");
    // Copy + freeze: the caller's object is NOT the contract. Holding the
    // reference would let anyone with it re-rate (or zero-rate) billing
    // after install — chaos-probed in test/chaos-fuzz.mjs.
    var rates = {};
    Object.keys(ratesIn).forEach(function (k) {
      var v = ratesIn[k];
      if (typeof v !== "number" || !isFinite(v) || v < 0)
        throw MonetizationError("rate for '" + k + "' must be a finite number >= 0, got: " + String(v));
      rates[k] = v;
    });
    Object.freeze(rates);
    var currency = (opts.currency == null) ? "USD" : opts.currency;
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
      throw MonetizationError("currency must be a 3-letter ISO code");
    var gateway = opts.gateway || MockGateway();
    if (typeof gateway.charge !== "function")
      throw MonetizationError("gateway must expose charge(invoice)");

    // Serialize writes with every other mutator (D-2026-07-19-02); a local
    // tail keeps the law even if a bare kernel is injected in tests.
    var localTail = Promise.resolve();
    var enqueue = typeof kernel._p2Enqueue === "function"
      ? kernel._p2Enqueue
      : function (fn) { var r = localTail.then(fn, fn); localTail = r.then(function () {}, function () {}); return r; };

    function persist(state) {
      if (typeof kernel._p2Persist !== "function")
        throw MonetizationError("no persist seam (kernel._p2Persist) — ext v1.2+ required");
      return kernel._p2Persist(state);
    }

    function ledger(state) {
      if (!state.metering_ledger) state.metering_ledger = [];
      return state.metering_ledger;
    }

    var api = {
      contract_version: CONTRACT_VERSION,
      gateway_is_mock: !!gateway.mock,

      /* meter(type, actor[, units]) — one validated entry, one persist. */
      meter: function (type, actor, units) {
        if (!(type in rates)) return Promise.reject(MonetizationError("unmetered event type: " + type));
        var n = (units == null) ? 1 : units;
        if (typeof n !== "number" || !isFinite(n) || n <= 0)
          return Promise.reject(MonetizationError("units must be a finite number > 0"));
        var entry;
        try {
          entry = validateEntry({
            action: "meter:" + type,
            actor: actor,
            cost: rates[type] * n,
            units: n,
            ts: Date.now()
          });
        } catch (e) { return Promise.reject(e); }
        return enqueue(function () {
          var s = kernel.getProjectState();
          ledger(s).push(entry);
          return Promise.resolve(persist(s)).then(function () { return entry; });
        });
      },

      /* Usage totals, deterministic ordering. Corrupt rows abort (never guess). */
      getUsageSummary: function () {
        var rows = ledger(kernel.getProjectState());
        var byAction = {};
        var total = 0;
        for (var i = 0; i < rows.length; i++) {
          var e = rows[i];
          try { validateEntry(e); }
          catch (err) { throw MonetizationError("metering ledger row " + i + " is corrupt — summary aborted (fail-closed): " + err.message); }
          byAction[e.action] = (byAction[e.action] || 0) + e.cost;
          total += e.cost;
        }
        var lines = Object.keys(byAction).sort().map(function (a) { return { action: a, cost: byAction[a] }; });
        return { contract_version: CONTRACT_VERSION, currency: currency, lines: lines, total: total, entries: rows.length };
      },

      /* Deterministic invoice: same ledger -> same invoice_id, always. */
      invoice: function () {
        var sum = api.getUsageSummary(); // throws on corruption — invoicing aborts with it
        var basis = sum.lines.map(function (l) { return l.action + "=" + l.cost; }).join("|") + "|" + sum.total + sum.currency;
        var h = 0;
        for (var i = 0; i < basis.length; i++) { h = ((h << 5) - h + basis.charCodeAt(i)) | 0; }
        return {
          invoice_version: "1.0.0",
          invoice_id: "inv_" + (h >>> 0).toString(16),
          currency: sum.currency,
          line_items: sum.lines,
          total: sum.total,
          entries: sum.entries
        };
      },

      /* charge(invoice) — recompute-and-compare BEFORE the gateway sees it.
       * A tampered total, id, or line item refuses loudly. */
      charge: function (invoice) {
        var fresh;
        try { fresh = api.invoice(); }
        catch (e) { return Promise.reject(e); }
        if (!invoice || invoice.invoice_id !== fresh.invoice_id || invoice.total !== fresh.total ||
            JSON.stringify(invoice.line_items) !== JSON.stringify(fresh.line_items)) {
          return Promise.reject(MonetizationError(
            "invoice does not recompute from the ledger — charge REFUSED (tamper check). " +
            "expected " + fresh.invoice_id + " total " + fresh.total));
        }
        if (fresh.total === 0) return Promise.reject(MonetizationError("zero-total invoice — nothing to charge"));
        return Promise.resolve(gateway.charge(fresh)).then(function (res) {
          if (!res || res.ok !== true || typeof res.receipt_id !== "string")
            throw MonetizationError("gateway response invalid or ambiguous — treated as NOT charged (fail-closed)");
          if (res.charged !== fresh.total)
            throw MonetizationError("gateway charged " + res.charged + " but invoice total is " + fresh.total + " — mismatch, treated as failed");
          return enqueue(function () {
            var s = kernel.getProjectState();
            if (!s.billing_log) s.billing_log = [];
            s.billing_log.push({
              invoice_id: fresh.invoice_id, receipt_id: res.receipt_id,
              total: fresh.total, currency: fresh.currency,
              mock: !!res.mock, ts: Date.now()
            });
            return Promise.resolve(persist(s)).then(function () { return { ok: true, receipt: res, invoice: fresh }; });
          });
        });
      }
    };

    kernel.monetization = api;
    return api;
  }

  return { install: install, CONTRACT_VERSION: CONTRACT_VERSION, MockGateway: MockGateway };
});
