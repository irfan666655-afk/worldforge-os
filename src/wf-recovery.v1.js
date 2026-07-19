/*!
 * wf-recovery.v1.js — WorldForge OS automated state recovery (D-2026-07-19-04)
 *
 * Gap G1 (docs/SYSTEM_IDENTITY.md): corruption-at-rest was detected loudly
 * (kernel 1.1.1) but the data was simply lost — detection without
 * restitution. This layer closes it AT THE STORAGE SEAM: it wraps the
 * injected storage adapter, so the kernel, ext, and monetization tiers are
 * untouched (mixin discipline, D-2026-07-18-04 zero deps).
 *
 * Mechanics:
 *   WRITE  — a guarded key's value must parse as a JSON object or the write
 *            THROWS (fail-closed: a corrupt transaction never lands). After
 *            the primary persists, a hash-stamped shadow copy is written
 *            under shadowPrefix+key: { h, v, ts } — the "last pristine
 *            state-hash" the system can always fall back to.
 *   READ   — a guarded primary that fails to parse triggers auto-rollback:
 *            the shadow's hash is re-verified (provenance — a tampered
 *            shadow is REFUSED, never restored), the primary is rewritten
 *            from the shadow, the event is loud (console + onEvent), and
 *            the caller transparently receives the recovered state.
 *   No shadow, or shadow tampered → loud null. Recovery never guesses.
 *
 * Hash: FNV-1a 32-bit, synchronous, dependency-free. This is INTEGRITY
 * provenance (bit-rot, truncation, partial writes), not cryptographic
 * tamper-proofing — that is marker PROV-1 in the identity doc.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFRecovery = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0";

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function parseableObject(v) {
    if (typeof v !== "string") return false;
    try { var o = JSON.parse(v); return o !== null && typeof o === "object"; }
    catch (e) { return false; }
  }

  function wrap(adapter, opts) {
    if (!adapter || typeof adapter.get !== "function" || typeof adapter.set !== "function")
      throw new Error("WFRecovery: storage adapter with get/set/delete/list required");
    opts = opts || {};
    var prefixes = opts.prefixes || ["wfproj:"];
    var SHADOW = opts.shadowPrefix || "wfshadow:";
    var onEvent = typeof opts.onEvent === "function" ? opts.onEvent : function () {};
    var loud = function (type, detail) {
      if (typeof console !== "undefined") console.error("[wf-recovery] " + type + ": " + detail);
      try { onEvent({ type: type, detail: detail, ts: Date.now() }); } catch (e) { /* observer never breaks recovery */ }
    };
    function guarded(k) {
      if (typeof k !== "string" || k.indexOf(SHADOW) === 0) return false;
      for (var i = 0; i < prefixes.length; i++) if (k.indexOf(prefixes[i]) === 0) return true;
      return false;
    }

    return {
      recoveryVersion: VERSION,

      set: async function (k, v, shared) {
        if (guarded(k) && !parseableObject(v)) {
          loud("corrupt-write-refused", k + " — value is not a JSON object; write REFUSED (fail-closed)");
          throw new Error("WFRecovery: refusing to persist corrupt state for " + k);
        }
        var res = await adapter.set(k, v, shared);
        if (guarded(k)) {
          try {
            await adapter.set(SHADOW + k, JSON.stringify({ h: fnv1a(v), v: v, ts: Date.now() }), shared);
          } catch (e) {
            // Primary landed; a missing shadow only narrows future recovery.
            loud("shadow-write-failed", k + " — " + String(e && e.message));
          }
        }
        return res;
      },

      get: async function (k, shared) {
        var r = await adapter.get(k, shared);
        if (!guarded(k) || !r || r.value == null || parseableObject(r.value)) return r;

        // Primary is corrupt — attempt rollback to last pristine shadow.
        loud("corrupt-primary", k + " — attempting rollback to last pristine state");
        var s = null;
        try { s = await adapter.get(SHADOW + k, shared); } catch (e) { /* fall through to refusal */ }
        var rec = null;
        if (s && s.value != null) { try { rec = JSON.parse(s.value); } catch (e) { rec = null; } }
        if (!rec || typeof rec.v !== "string" || fnv1a(rec.v) !== rec.h || !parseableObject(rec.v)) {
          loud("rollback-refused", k + " — shadow missing or hash mismatch; recovery never guesses");
          return null; // loud null: caller sees absence, not invented state
        }
        try { await adapter.set(k, rec.v, shared); } catch (e) {
          loud("rollback-rewrite-failed", k + " — serving shadow state without healing primary");
        }
        loud("rolled-back", k + " — restored pristine state hash " + rec.h + " (shadow ts " + rec.ts + ")");
        return { key: k, value: rec.v, recovered: true };
      },

      delete: async function (k, shared) {
        var res = await adapter.delete(k, shared);
        if (guarded(k)) { try { await adapter.delete(SHADOW + k, shared); } catch (e) { /* shadow orphan is harmless */ } }
        return res;
      },

      list: async function (prefix, shared) {
        var r = await adapter.list(prefix, shared);
        if (r && r.keys) r.keys = r.keys.filter(function (k) { return k.indexOf(SHADOW) !== 0; });
        return r;
      }
    };
  }

  return { wrap: wrap, VERSION: VERSION, _fnv1a: fnv1a };
});
