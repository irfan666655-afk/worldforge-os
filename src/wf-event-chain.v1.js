/*!
 * wf-event-chain.v1.js — WorldForge OS cryptographic event provenance (G2)
 *
 * Ratified as PROV-1 work (docs/SYSTEM_IDENTITY.md gap G2). Makes the
 * governance ledger tamper-EVIDENT: every appended decision is hash-chained
 * to the one before it, so altering, reordering, or deleting any historical
 * record breaks verifyEventChain() at the exact point of tampering.
 *
 * SHA-256 is implemented in pure JS (below) because the kernel's record
 * path is synchronous and the artifact must run offline from file:// with
 * zero dependencies (D-2026-07-18-04). SubtleCrypto is async-only in the
 * browser, so it cannot back a sync append; this does.
 *
 * Additive mixin: it wraps kernel.recordDecision (installed by the ext) and
 * stamps each record with a `_chain = { seq, prev, hash }` field. Nothing is
 * removed from the frozen decision shape — the chain fields are excluded
 * from the digest, so the record's own hash never depends on itself.
 *
 * HONEST SCOPE: this is integrity + tamper-evidence with a keyless chain.
 * It proves history was not altered after the fact by anyone who does not
 * also rewrite the whole chain forward. It is NOT signed/keyed authenticity
 * (no private key) — that is a further step, left as marker PROV-2. On a
 * fully hostile storage tier an attacker who controls all bytes could
 * recompute the entire chain; the value is that ANY partial edit is caught.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFEventChain = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0";
  var GENESIS = "0000000000000000000000000000000000000000000000000000000000000000";

  /* ---------------- pure-JS SHA-256 (sync, zero-dep) ---------------- */
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(ascii) {
    // UTF-8 encode
    var bytes = [];
    for (var i = 0; i < ascii.length; i++) {
      var c = ascii.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c < 0xd800 || c >= 0xe000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      else { // surrogate pair
        i++; var c2 = ascii.charCodeAt(i);
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    var l = bytes.length, bitLen = l * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64-bit length, high word is 0 for our sizes
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

    var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,
        h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
    var w = new Array(64);
    for (var j = 0; j < bytes.length; j += 64) {
      for (var t = 0; t < 16; t++)
        w[t] = (bytes[j+t*4] << 24) | (bytes[j+t*4+1] << 16) | (bytes[j+t*4+2] << 8) | (bytes[j+t*4+3]);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3);
        var s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
      }
      var a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
      h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+hh)|0;
    }
    function hex(x){ return ("00000000" + (x >>> 0).toString(16)).slice(-8); }
    return hex(h0)+hex(h1)+hex(h2)+hex(h3)+hex(h4)+hex(h5)+hex(h6)+hex(h7);
  }

  /* Canonical stringify: stable key order, excludes the chain field itself. */
  function canonical(obj) {
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
    var keys = Object.keys(obj).filter(function (k) { return k !== "_chain"; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonical(obj[k]); }).join(",") + "}";
  }

  function digestRecord(rec, prevHash) { return sha256(prevHash + "|" + canonical(rec)); }

  function install(kernel, opts) {
    if (!kernel || typeof kernel.recordDecision !== "function")
      throw new Error("WFEventChain: kernel with ext recordDecision required (install ext first)");
    opts = opts || {};

    function chainOf(state) { return (state.decision_log || []); }

    // Wrap recordDecision: append (original), then stamp the new tail with
    // its chain link over the prior record's hash.
    if (!kernel.recordDecision.__chained) {
      var orig = kernel.recordDecision.bind(kernel);
      kernel.recordDecision = function (rec) {
        var out = orig(rec);
        var s = kernel.getProjectState();
        var log = chainOf(s);
        var tail = log[log.length - 1];
        if (tail && !tail._chain) {
          var prev = log.length >= 2 && log[log.length - 2]._chain ? log[log.length - 2]._chain.hash : GENESIS;
          tail._chain = { seq: log.length - 1, prev: prev, hash: digestRecord(tail, prev) };
        }
        return out;
      };
      kernel.recordDecision.__chained = true;
    }

    // verifyEventChain(): walk the log, recompute every link. Returns the
    // first break (index + reason) or { ok:true }.
    kernel.verifyEventChain = function () {
      var log = chainOf(kernel.getProjectState());
      var prev = GENESIS;
      for (var i = 0; i < log.length; i++) {
        var rec = log[i];
        if (!rec._chain) return { ok: false, brokenAt: i, reason: "unchained record (inserted without the chain)" };
        if (rec._chain.prev !== prev) return { ok: false, brokenAt: i, reason: "prev-hash link broken (reorder/delete)" };
        if (rec._chain.hash !== digestRecord(rec, prev)) return { ok: false, brokenAt: i, reason: "content altered after signing" };
        prev = rec._chain.hash;
      }
      return { ok: true, length: log.length, head: prev };
    };

    kernel.eventChainHead = function () {
      var log = chainOf(kernel.getProjectState());
      var tail = log[log.length - 1];
      return tail && tail._chain ? tail._chain.hash : GENESIS;
    };

    return kernel;
  }

  return { install: install, VERSION: VERSION, sha256: sha256, GENESIS: GENESIS, _canonical: canonical };
});
