/*!
 * wf-gate-override.v1.js — WorldForge OS P4-UI1: gate-override affordance
 *
 * Ratified 2026-07-18 (P4-UI1-D1): the override surface ships in the UI.
 * An override is a decision, not a shortcut — this component exists to make
 * the ceremony cheap and the record mandatory, mirroring Step Back (Rule 7).
 *
 * Contract: WFComponent (mount/update/destroy), kernel-owned state, view
 * state only in the component, single kernel dispatch per commit.
 *
 * Integration (Claude Code, real tree):
 *   src/forge-ui.js — where a gate modal renders its Pass/Cancel actions,
 *   add an "Override…" tertiary action that constructs
 *     new WFGateOverride(kernel, { mount, projectId, stageId, onDone })
 *   Shell CSS already carries the d-kind-gate-override hook (verified in
 *   shell.html grep, 2026-07-17 session).
 *
 * MARKER UI1-K1: exact kernel write method for an override record. This
 * module capability-detects, in order:
 *   kernel.recordGateOverride(projectId, rec)   — preferred, add if absent
 *   kernel.recordDecision(projectId, rec)       — generic decision write
 *   kernel.ext.decisionLog.append(projectId, rec) — ext seam fallback
 * Whichever exists first is used; if none exist the commit fails LOUDLY in
 * the UI (fail-closed — an unrecordable override must not happen).
 * Burn this marker against worldforge-kernel.v1.1.js in the real tree.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFGateOverride = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var REASON_FLOOR = 10; // GOV-7 spirit: advisory, not a hard gate

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function writeSeam(kernel) {
    if (typeof kernel.recordGateOverride === "function")
      return function (pid, rec) { return kernel.recordGateOverride(pid, rec); };
    if (typeof kernel.recordDecision === "function")
      return function (pid, rec) { return kernel.recordDecision(pid, rec); };
    var ext = kernel.ext && kernel.ext.decisionLog;
    if (ext && typeof ext.append === "function")
      return function (pid, rec) { return ext.append(pid, rec); };
    return null; // MARKER UI1-K1 unresolved at runtime → fail-closed
  }

  function WFGateOverride(kernel, opts) {
    this.kernel = kernel;
    this.el = opts.mount;
    this.projectId = opts.projectId;
    this.stageId = opts.stageId;
    this.onDone = opts.onDone || function () {};
    this.defaultActor = opts.actor || "human"; // ACT-1 interim convention
    this._committing = false;
  }

  WFGateOverride.prototype.mount = function () {
    this.update();
    return this;
  };

  WFGateOverride.prototype.update = function () {
    var el = this.el;
    el.innerHTML =
      '<div class="panel gate-override" role="dialog" aria-modal="true" aria-labelledby="wfgo-h">' +
      '<h3 id="wfgo-h">Override gate — stage ' + esc(this.stageId) + "</h3>" +
      '<p class="warn">An override bypasses this gate\u2019s check. It is written to the ' +
      "decision record with your name and reason, permanently, next to every clean pass.</p>" +
      '<label>Actor <input name="actor" value="' + esc(this.defaultActor) + '" autocomplete="off"></label>' +
      '<label>Reason (required) <textarea name="reason" rows="3" ' +
      'placeholder="Why is bypassing this gate the right call?"></textarea></label>' +
      '<div class="findings" aria-live="polite"></div>' +
      '<div class="actions">' +
      '<button type="button" class="danger" data-act="commit">Record override &amp; advance</button>' +
      '<button type="button" data-act="cancel">Cancel</button>' +
      "</div></div>";

    var self = this;
    el.querySelector('[data-act="cancel"]').onclick = function () { self.destroy(); self.onDone(null); };
    el.querySelector('[data-act="commit"]').onclick = function () { self._commit(); };
    var ta = el.querySelector("textarea[name=reason]");
    ta.oninput = function () {
      var box = el.querySelector(".findings");
      var v = ta.value.trim();
      box.textContent =
        v && v.length < REASON_FLOOR
          ? "Reason is under " + REASON_FLOOR + " characters — write it for the reviewer, not the checkbox (GOV-7)."
          : "";
    };
    ta.focus();
  };

  WFGateOverride.prototype._commit = function () {
    if (this._committing) return;
    var el = this.el;
    var box = el.querySelector(".findings");
    var actor = el.querySelector("input[name=actor]").value.trim();
    var reason = el.querySelector("textarea[name=reason]").value.trim();
    if (!reason) { box.textContent = "A reason is required (GOV-1 / Rule 7). No silent overrides."; return; }
    if (!actor) { box.textContent = "An actor is required (GOV-1b / Rule 7)."; return; }

    var write = writeSeam(this.kernel);
    if (!write) {
      box.textContent =
        "FATAL: no kernel decision-write seam found (MARKER UI1-K1). " +
        "Override NOT recorded, gate NOT advanced. Fix the kernel binding.";
      return;
    }
    var rec = {
      kind: "gate-override",       // renders via d-kind-gate-override
      stage_id: this.stageId,
      actor: actor,                // ACT-1: kernel tier free text; export tier enforces
      reason: reason,
      ts: new Date().toISOString(),
    };
    this._committing = true;
    var self = this;
    Promise.resolve(write(this.projectId, rec)).then(
      function () { self.destroy(); self.onDone(rec); },      // single persist: forge-ui
      function (e) {                                          // advances stage on onDone,
        self._committing = false;                             // never before the record lands
        box.textContent = "Record failed to persist — override aborted: " + esc(e && e.message);
      }
    );
  };

  WFGateOverride.prototype.destroy = function () {
    if (this.el) this.el.innerHTML = "";
  };

  return WFGateOverride;
});
