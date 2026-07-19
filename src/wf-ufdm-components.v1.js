/*!
 * wf-ufdm-components.v1.js — WorldForge OS P2: Real UFDM Surface
 * Framework-agnostic UI components for WFKernel v1.x
 *
 * Contract (all components):
 *   const c = new Component(kernel, { mount: HTMLElement, ...opts });
 *   c.mount();     // renders + subscribes to kernel
 *   c.update();    // re-reads kernel state, re-renders
 *   c.destroy();   // unsubscribes, clears DOM
 *
 * Domain state lives in the kernel. Components hold VIEW state only
 * (filters, open modals, sort order). Every mutation goes through a
 * kernel dispatch; components never write project state directly.
 *
 * Kernel dependencies are listed per component; see the P2 spec doc
 * for which are live vs. new (wfkernel-p2-ext).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WFUFDM = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Shared: category derivation for budget line items.                  */
  /* Ledger entry shape is FROZEN: {stage_id, actor, action, cost, ts}.  */
  /* Category is DERIVED, never stored. Mapping should be regenerated    */
  /* from canonical config (gen_rules.py pattern), not hand-edited.      */
  /* ------------------------------------------------------------------ */
  const LINE_CATEGORIES = {
    vision:   { label: "Vision & Stills",     match: /^(image|still|anchor|vision|concept)/i },
    video:    { label: "Video Generation",    match: /^(video|clip|gen_video|animate)/i },
    motion:   { label: "Motion & Graphics",   match: /^(motion|graphics|comp|edit|assembly)/i },
    other:    { label: "Other",               match: /.*/ },
  };
  function categorize(entry) {
    for (const [key, def] of Object.entries(LINE_CATEGORIES)) {
      if (def.match.test(entry.action || "")) return key;
    }
    return "other";
  }

  class WFComponent {
    constructor(kernel, opts = {}) {
      this.kernel = kernel;
      this.el = opts.mount;
      this._unsub = null;
    }
    mount() {
      // kernel.subscribe(fn) -> unsubscribe fn   [NEW: wfkernel-p2-ext]
      if (typeof this.kernel.subscribe === "function") {
        this._unsub = this.kernel.subscribe(() => this.update());
      }
      this.update();
      return this;
    }
    update() { /* implemented by subclass */ }
    destroy() {
      if (this._unsub) this._unsub();
      if (this.el) this.el.innerHTML = "";
    }
  }

  /* ==================================================================
   * 1. BudgetLedger
   * Reads:   kernel.getBudgetSummary(), kernel.getProjectState()
   * Writes:  kernel.updateBudget(entry), kernel.reserveBudget(entry)
   * Emits:   'wf:budget-warning' (>=80%), 'wf:budget-gate' (>=100%)
   * ================================================================== */
  class BudgetLedger extends WFComponent {
    constructor(kernel, opts = {}) {
      super(kernel, opts);
      this.view = {
        categories: new Set(Object.keys(LINE_CATEGORIES)), // toggles
        drillAgent: null,                                   // agent drill-down
      };
    }

    /** Derived rollup. If kernel.getBudgetSummary exists, prefer it. */
    summary() {
      if (typeof this.kernel.getBudgetSummary === "function") {
        return this.kernel.getBudgetSummary();
      }
      // Fallback: derive from raw ledger (frozen shape).
      const st = this.kernel.getProjectState();
      const ledger = st.budget_ledger || [];
      const start = st.budget_start || 0;
      const byStage = {}, byAgent = {}, byCategory = {};
      let spent = 0;
      for (const e of ledger) {
        const cat = categorize(e);
        if (!this.view.categories.has(cat)) continue;
        spent += e.cost;
        byStage[e.stage_id] = (byStage[e.stage_id] || 0) + e.cost;
        byAgent[e.actor] = (byAgent[e.actor] || 0) + e.cost;
        byCategory[cat] = (byCategory[cat] || 0) + e.cost;
      }
      const utilization = start ? spent / start : 0;
      return { start, spent, remaining: start - spent, utilization,
               byStage, byAgent, byCategory,
               burn: this._burnProjection(ledger, start, spent) };
    }

    /** Linear projection: current burn rate continued to timeline end. */
    _burnProjection(ledger, start, spent) {
      if (ledger.length < 2) return null;
      const ts = ledger.map(e => +new Date(e.timestamp)).sort((a, b) => a - b);
      const elapsed = ts[ts.length - 1] - ts[0];
      if (elapsed <= 0) return null;
      const ratePerDay = spent / (elapsed / 86400000);
      const daysToGate = ratePerDay > 0 ? (start - spent) / ratePerDay : Infinity;
      return { ratePerDay, daysToGate };
    }

    /** Hard gate: rejects any entry that would exceed 100%. */
    addSpend(entry) {
      const s = this.summary();
      if (s.spent + entry.cost > s.start) {
        this._emit("wf:budget-gate", { entry, summary: s });
        return { ok: false, reason: "BUDGET_GATE_100" };
      }
      this.kernel.updateBudget(entry); // live in v1.0.0
      const after = this.summary();
      if (after.utilization >= 0.8) this._emit("wf:budget-warning", after);
      return { ok: true };
    }

    toggleCategory(key) {
      this.view.categories.has(key)
        ? this.view.categories.delete(key)
        : this.view.categories.add(key);
      this.update();
    }

    _emit(name, detail) {
      if (this.el) this.el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    update() {
      if (!this.el) return;
      // Rendering left to host surface / mockup. Subclass or template here.
      this.el.dataset.utilization = String(this.summary().utilization);
    }
  }

  /* ==================================================================
   * 2. LockedAssets
   * Reads:   kernel.getAssets(), kernel.verifyAssetFingerprint(id)
   * Writes:  kernel.lockAsset(id, actor), kernel.unlockAsset(id, actor)
   * Emits:   'wf:asset-corrupted' (fingerprint mismatch)
   * Asset shape (frozen): {asset_id, stage_created, type,
   *                        fingerprint, locked, promotion_log[]}
   * ================================================================== */
  class LockedAssets extends WFComponent {
    constructor(kernel, opts = {}) {
      super(kernel, opts);
      this.view = { typeFilter: null, expanded: new Set() };
    }

    assets() {
      const all = this.kernel.getAssets(); // NEW: wfkernel-p2-ext
      return this.view.typeFilter
        ? all.filter(a => a.type === this.view.typeFilter)
        : all;
    }

    /** Locked assets are immutable; only unlocked assets may change. */
    setLocked(assetId, locked, actor) {
      const a = this.kernel.getAssets().find(x => x.asset_id === assetId);
      if (!a) return { ok: false, reason: "NOT_FOUND" };
      if (a.locked === locked) return { ok: true, noop: true };
      return locked
        ? this.kernel.lockAsset(assetId, actor)
        : this.kernel.unlockAsset(assetId, actor);
    }

    /** Recompute SHA256 of stored bytes and compare to record. */
    async verify(assetId) {
      const res = await this.kernel.verifyAssetFingerprint(assetId); // NEW
      if (!res.match) {
        this.el?.dispatchEvent(new CustomEvent("wf:asset-corrupted", {
          detail: { assetId, expected: res.expected, actual: res.actual },
          bubbles: true,
        }));
      }
      return res;
    }

    update() {
      if (!this.el) return;
      this.el.dataset.assetCount = String(this.assets().length);
    }
  }

  /* ==================================================================
   * 3. PromotionWorkflow
   * P2 rule: promotion REQUIRES a decision record that validates
   * against the governance schema. No record, no promotion.
   *
   * Reads:   kernel.getAssets(), kernel.evaluateRules(ctx)  [JS rule
   *          evaluator compiled from lint_worldforge.py via gen_rules.py]
   * Writes:  kernel.promoteAsset(assetId, decisionDraft)    [transactional]
   * Emits:   'wf:promotion-complete', 'wf:promotion-blocked'
   * ================================================================== */
  class PromotionWorkflow extends WFComponent {
    constructor(kernel, opts = {}) {
      super(kernel, opts);
      this.view = { open: false, assetId: null, draft: null, lintResult: null };
    }

    /** Step 1: open modal with a pre-filled draft (fast path <10s). */
    begin(assetId, sessionActor) {
      this.view.open = true;
      this.view.assetId = assetId;
      this.view.draft = {
        reason: "",
        promoted_by: sessionActor || "",   // pre-filled from session
        impact: "medium",                  // defaulted
        rule_override: null,               // only if linter flags
      };
      this.update();
    }

    /** Step 2: run the rule evaluator BEFORE submit so the user sees
     *  the GOV-2 requirement up front, not as a rejection. */
    lint() {
      this.view.lintResult = this.kernel.evaluateRules({
        kind: "asset_promotion",
        asset_id: this.view.assetId,
        draft: this.view.draft,
      }); // -> { violations: [{rule_id, severity, message}], clean: bool }
      this.update();
      return this.view.lintResult;
    }

    /** Step 3: transactional promote. The kernel must do ALL of this
     *  atomically — validate draft against governance schema, re-run
     *  rules, require GOV-2 sign-off on violations, write the decision
     *  record to the events ledger, append to the asset's
     *  promotion_log, timestamp it. Promotion is immutable. */
    async submit(gov2Signoff /* {actor, timestamp} | null */) {
      const res = await this.kernel.promoteAsset(this.view.assetId, {
        draft: this.view.draft,
        gov2: gov2Signoff,
      });
      const evt = res.ok ? "wf:promotion-complete" : "wf:promotion-blocked";
      this.el?.dispatchEvent(new CustomEvent(evt, { detail: res, bubbles: true }));
      if (res.ok) { this.view.open = false; this.view.draft = null; }
      this.update();
      return res;
    }

    update() {
      if (!this.el) return;
      this.el.dataset.modalOpen = String(this.view.open);
    }
  }

  /* ==================================================================
   * 4a. UFDMExport
   * kernel.exportUFDM() -> full project state: stages, assets, agents,
   * decision log, budget. Serializable, transferable.
   * ================================================================== */
  class UFDMExport extends WFComponent {
    exportJSON() {
      const doc = this.kernel.exportUFDM(); // NEW: wfkernel-p2-ext
      return JSON.stringify(doc, null, 2);
    }
    download(filename) {
      const blob = new Blob([this.exportJSON()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"),
        { href: url, download: filename || "project.ufdm.v1.json" });
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  /* ==================================================================
   * 4b. UFDMImport
   * Validation order matters — fail fast, report ALL findings:
   *   1. envelope + version check (ufdm_version)
   *   2. every referenced agent exists in canonical roster
   *   3. every stage_id exists in pipeline.v1.json
   *   4. no orphaned decision records (every record's actor + every
   *      asset promotion_log entry resolves)
   *   5. asset fingerprints are well-formed SHA256
   * Only after a clean validation: kernel.importUFDM(doc) reconstructs
   * state. Import NEVER partially applies.
   * ================================================================== */
  class UFDMImport extends WFComponent {
    async validate(doc) {
      return this.kernel.validateUFDM(doc); // NEW -> {valid, findings[]}
    }
    async importDoc(doc) {
      const v = await this.validate(doc);
      if (!v.valid) return { ok: false, findings: v.findings };
      return this.kernel.importUFDM(doc);   // NEW: atomic reconstruct
    }
  }

  return { BudgetLedger, LockedAssets, PromotionWorkflow,
           UFDMExport, UFDMImport, LINE_CATEGORIES, categorize };
});
