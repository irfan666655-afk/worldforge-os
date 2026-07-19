/*!
 * wf-ufdm-visual.v1.js — WorldForge OS P2 visual pass (mockup → shell)
 *
 * Migrates the ufdm-mockup layout (panel / burnstrip / lockchip / chain
 * vocabulary) into the shell as a live surface driven by real kernel data:
 * budget from the frozen ledger shape {stage_id, actor, action, cost, ts},
 * lock state from the asset library, promotion chain from decision_log.
 *
 * ANIMATION DECISION (P2-VIS-D1): Framer Motion was requested; it is a
 * React library and the ratified P2 architecture decision is vanilla
 * JS/UMD with no build chain. That decision is frozen; reopening it needs
 * a decision record. This module delivers the same motion language —
 * spring-ish entrances, animated bar fills, count-up numerals, chip pulse
 * on lock-state change — with the Web Animations API + CSS. Zero deps.
 *
 * Contract: WFComponent (mount/update/destroy). Subscribes once; the
 * kernel's chained subscription (ext v1.2 eventing fix) delivers both
 * kernel and ext events through this one channel.
 *
 * Mount (Claude Code): reserve <section id="ufdm-surface"> in shell.html
 * next to the forge detail panel; boot in src/app.js after ext binding:
 *   new WFUFDMVisual(kernel, { mount: document.getElementById('ufdm-surface') }).mount();
 * Load wf-ufdm-visual.v1.css in the shell <head> (build.mjs inlines it).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFUFDMVisual = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EASE_SPRING = "cubic-bezier(0.22, 1.4, 0.36, 1)"; // overshoot ≈ spring
  var DUR = { enter: 420, bar: 600, pulse: 700, num: 500 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

  function animateEnter(el, i) {
    if (el.animate) el.animate(
      [{ opacity: 0, transform: "translateY(10px) scale(0.985)" },
       { opacity: 1, transform: "translateY(0) scale(1)" }],
      { duration: DUR.enter, delay: (i || 0) * 45, easing: EASE_SPRING, fill: "backwards" });
  }
  function animateBar(el, pct) {
    var to = Math.max(0, Math.min(100, pct)) + "%";
    if (el.animate) el.animate([{ width: el.style.width || "0%" }, { width: to }],
      { duration: DUR.bar, easing: "cubic-bezier(0.16,1,0.3,1)" });
    el.style.width = to;
  }
  function countUp(el, from, to) {
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / DUR.num);
      p = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * p);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function pulse(el) {
    if (el.animate) el.animate(
      [{ boxShadow: "0 0 0 0 rgba(240,180,60,0.7)" }, { boxShadow: "0 0 0 12px rgba(240,180,60,0)" }],
      { duration: DUR.pulse, easing: "ease-out" });
  }

  /* --------------------------- kernel reads (seam-tolerant) ----------- */
  function readLedger(k, pid) {
    if (k.getLedger) return k.getLedger(pid) || [];
    if (k.ext && k.ext.getLedger) return k.ext.getLedger(pid) || [];
    return [];
  }
  function readAssets(k, pid) {
    if (k.getAssets) return k.getAssets(pid) || [];
    if (k.ext && k.ext.getAssets) return k.ext.getAssets(pid) || [];
    return [];
  }
  function readDecisions(k, pid) {
    if (k.getDecisions) return k.getDecisions(pid) || [];
    if (k.ext && k.ext.getDecisionLog) return k.ext.getDecisionLog(pid) || [];
    return [];
  }
  function readBudget(k, pid) {
    if (k.getBudget) return k.getBudget(pid);
    if (k.ext && k.ext.getBudget) return k.ext.getBudget(pid);
    return null;
  }

  function WFUFDMVisual(kernel, opts) {
    this.kernel = kernel;
    this.el = opts.mount;
    this.projectId = opts.projectId || (kernel.getBoundProject && kernel.getBoundProject());
    this._unsub = null;
    this._prev = { spend: 0, locks: {} };
    this._mounted = false;
  }

  WFUFDMVisual.prototype.mount = function () {
    var self = this;
    if (typeof this.kernel.subscribe === "function")
      this._unsub = this.kernel.subscribe(function () { self.update(); });
    this.update();
    this._mounted = true;
    return this;
  };

  WFUFDMVisual.prototype.update = function () {
    var k = this.kernel, pid = this.projectId;
    if (!pid && k.getBoundProject) pid = this.projectId = k.getBoundProject();
    var ledger = readLedger(k, pid);
    var assets = readAssets(k, pid);
    var decisions = readDecisions(k, pid).slice().reverse(); // newest first
    var budget = readBudget(k, pid) || {};

    // FROZEN ledger shape: sum `cost` — never `amount` (ext v1.2 bug class)
    var spend = ledger.reduce(function (s, e) { return s + (Number(e.cost) || 0); }, 0);
    var start = Number(budget.budget_start) || 0;
    var remaining = start - spend;
    var pct = start ? (spend / start) * 100 : 0;

    var firstRender = !this._mounted;
    this.el.innerHTML =
      '<div class="panel ufdm" data-anim="0"><h3>Budget</h3>' +
      '<div class="bignum" data-num>' + fmt(this._prev.spend) + "</div>" +
      '<div class="bar"><div class="fill' + (remaining < start * 0.2 ? " warn" : "") + '"></div></div>' +
      '<div class="foot">' + fmt(remaining) + " remaining of " + fmt(start) + "</div>" +
      '<div class="burnstrip">' + ledger.slice(-6).reverse().map(function (e) {
        return '<span class="amt" title="' + esc(e.actor) + " · " + esc(e.ts) + '">' +
               esc(e.action) + " −" + fmt(e.cost) + "</span>";
      }).join("") + "</div></div>" +

      '<div class="panel" data-anim="1"><h3>Locked assets</h3><div class="cats">' +
      (assets.length ? assets.map(function (a) {
        var st = a.corrupt ? "corrupt" : a.locked ? "locked" : "unlocked";
        return '<span class="lockchip ' + st + '" data-aid="' + esc(a.id) + '">' +
               esc(a.name || a.id) + '<span class="fp">' + esc((a.fingerprint || "").slice(0, 14)) + "</span></span>";
      }).join("") : '<span class="foot">No assets registered.</span>') + "</div></div>" +

      '<div class="panel" data-anim="2"><h3>Decision chain</h3><div class="chain">' +
      (decisions.length ? decisions.slice(0, 8).map(function (d) {
        return '<div class="arow d-kind-' + esc(d.kind || "decision") + '">' +
               '<span class="id">' + esc(d.kind || "decision") + "</span> " +
               esc(d.reason || d.action || "") +
               '<span class="foot"> — ' + esc(d.actor) + "</span></div>";
      }).join("") : '<span class="foot">No decisions recorded yet.</span>') + "</div></div>";

    // motion pass
    var i = 0, self = this;
    if (firstRender)
      this.el.querySelectorAll("[data-anim]").forEach(function (p) { animateEnter(p, i++); });
    animateBar(this.el.querySelector(".fill"), pct);
    countUp(this.el.querySelector("[data-num]"), this._prev.spend, spend);
    assets.forEach(function (a) {
      var was = self._prev.locks[a.id], now = !!a.locked;
      if (was !== undefined && was !== now) {
        var chip = self.el.querySelector('[data-aid="' + CSS.escape(a.id) + '"]');
        if (chip) pulse(chip);
      }
      self._prev.locks[a.id] = now;
    });
    this._prev.spend = spend;
  };

  WFUFDMVisual.prototype.destroy = function () {
    if (this._unsub) this._unsub();
    if (this.el) this.el.innerHTML = "";
    this._mounted = false;
  };

  return WFUFDMVisual;
});
