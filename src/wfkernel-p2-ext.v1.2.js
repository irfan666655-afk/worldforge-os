/*!
 * wfkernel-p2-ext.v1.2.js — WorldForge OS P2 kernel extension (SOURCE-BOUND)
 *
 * v1.2 CHANGE LOG — VERIFY(kernel-src) markers burned against the REAL
 * worldforge-kernel.v1.1.js (extracted 2026-07-17). All six resolved:
 *   R1 version: kernel instance exposes `version` ('1.1.0'); accept 1.x.
 *   R2 accessors: kernel exposes NEITHER getPipeline nor getRoster —
 *      injection fallback is the live path (as designed).
 *   R3 key scheme: prefix + id verbatim CONFIRMED. Divergence FIXED:
 *      kernel writes with shared=true; v1.1 fallback omitted the flag,
 *      silently splitting personal/shared scopes. Now passes true.
 *   R4 persist hook: kernel exposes no persist/saveProject/save/_persist;
 *      adapter fallback is the live path (with R3 fix).
 *   R5 mutators: kernel has NEITHER updateBudget NOR recordDecision.
 *      v1.2 provides additive fallbacks (P2 ledger: state.decision_log,
 *      distinct from the kernel's pipeline ledger state.decisions).
 *   R6 decision log field: kernel pipeline ledger is `decisions`
 *      ({ts:number, by, kind, label, note}); P2 records land in
 *      `decision_log` (frozen asset-ledger shape). Dual-read stands.
 *   +  Multi-project binding: kernel is multi-project (getProject(id));
 *      ext adds bindProject(id) and derives getProjectState from it.
 *   +  Budget entries: components' FROZEN shape uses `cost`; summary now
 *      reads cost with legacy `amount` fallback.
 *
 * v1.2.1 CHANGE LOG (backlog-close splice, 2026-07-19)
 * ----------------------------------------------------------------
 *   UI1-K1 BURNED: recordGateOverride added as a thin alias over the
 *     kernel's atomic advance({override:true, reason}) — see the marker
 *     comment at the alias for the contract shift (resolve = advanced).
 *   Step 4.4 seams BURNED: getLedger / getDecisions / getBudget additive
 *     read aliases pinned to the real state fields (budget_ledger,
 *     decisions + decision_log merged view, budget_start).
 *
 * v1.1 CHANGE LOG (reconciliation of the three "assumed" methods)
 * ----------------------------------------------------------------
 * Source files were NOT available in this session (uploads empty; search
 * returns fragments only). Reconciliation therefore does NOT bind to
 * private kernel internals — it REPLACES every assumption with an
 * injected seam + capability-detection chain. This is strictly safer
 * than the v1.0 assumptions and remains correct regardless of what
 * worldforge-kernel.v1.js actually contains. Verify points are marked
 * `// VERIFY(kernel-src):` — a 10-minute pass once the file is uploaded.
 *
 *   1. `kernel._persist(state)`   → REMOVED. Persistence now flows
 *      through `_p2Persist()`: (a) kernel.persist / kernel.save /
 *      kernel._persist if any exists, else (b) direct write via the
 *      injected storage adapter under the pipeline-defined project
 *      prefix (`wfproj:` default — documented kernel behavior).
 *   2. `kernel.readAssetBytes(id)` → REMOVED. Fingerprint verification
 *      now takes an injected `readAssetBytes(assetRecord)` function.
 *      Absent that, verification returns tri-state 'unverifiable' —
 *      never a false pass, never a false fail (Rule 4 discipline).
 *   3. `kernel.getRoster()/getPipeline()` → REMOVED as requirements.
 *      Canonical roster + pipeline JSON are injected at install (they
 *      are canonical sources — principle 1 — so injection is the
 *      *correct* seam, not a workaround). Kernel methods are used
 *      opportunistically if present.
 *
 * Everything else carries over from v1.0 unchanged in contract:
 * eventing, budget rollup + reservation (reserve: ledger prefix),
 * asset ledger, rule evaluator (rules.v1.json DSL), transactional
 * promoteAsset, UFDM export/validate/import.
 *
 * UMD. No build chain. Ships alongside worldforge-kernel.v1.js —
 * the kernel file itself is never modified (mixin discipline).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.WFKernelP2Ext = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXT_VERSION = '1.2.1';
  var REQUIRED_KERNEL_MAJOR = 1; // RESOLVED(kernel-src): instance exposes `version`; accept 1.x

  /* ================================================================
   * install(kernel, opts)
   *   kernel : a live WFKernel instance (createKernel result)
   *   opts:
   *     pipeline       REQUIRED  canonical pipeline.v1.json object
   *     roster         REQUIRED  canonical agent-roster.v5.2.json object
   *     rules          optional  parsed rules.v1.json (or loadRules later)
   *     storage        optional  the SAME adapter given to createKernel;
   *                              needed only if the kernel exposes no
   *                              persist/save method (seam #1 fallback)
   *     readAssetBytes optional  async (assetRecord) => ArrayBuffer|Uint8Array|string
   *                              (seam #2; absent => 'unverifiable')
   *     digest         optional  async (bytes) => hex string; defaults to
   *                              SubtleCrypto SHA-256 when available
   * ================================================================ */
  function install(kernel, opts) {
    if (!kernel) throw new Error('P2Ext: kernel instance required');
    opts = opts || {};
    if (!opts.pipeline || !Array.isArray(opts.pipeline.stages)) {
      throw new Error('P2Ext: canonical pipeline definition required (inject pipeline.v1.json)');
    }
    if (!opts.roster || !Array.isArray(opts.roster.agents)) {
      throw new Error('P2Ext: canonical roster required (inject agent-roster.v5.2.json)');
    }
    if (kernel.version && parseInt(kernel.version, 10) !== REQUIRED_KERNEL_MAJOR) {
      throw new Error('P2Ext: kernel major version mismatch: ' + kernel.version);
    }

    /* ------- multi-project binding (RESOLVED: kernel is multi-project) ------- */
    var boundProjectId = opts.projectId || null;
    kernel.bindProject = function (id) { boundProjectId = id; };
    kernel.getBoundProject = function () { return boundProjectId; };
    if (typeof kernel.getProjectState !== 'function') {
      kernel.getProjectState = opts.getProjectState || function () {
        if (!boundProjectId) throw new Error('P2Ext: no project bound — call kernel.bindProject(id)');
        var p = typeof kernel.getProject === 'function' ? kernel.getProject(boundProjectId) : null;
        if (!p) throw new Error('P2Ext: bound project not found: ' + boundProjectId);
        return p;
      };
    }

    var listeners = [];
    var rules = opts.rules || null;
    var pipelineDef = opts.pipeline;
    var rosterDef = opts.roster;
    var injectedStorage = opts.storage || null;
    var injectedReadBytes = opts.readAssetBytes || null;

    /* ---------------- seam #3: canonical accessors ---------------- */
    // Kernel methods win if they exist (opportunistic), canon injection
    // is the guaranteed path.
    kernel.getPipeline = kernel.getPipeline || function () { return pipelineDef; };
    kernel.getRoster   = kernel.getRoster   || function () { return rosterDef; };
    // RESOLVED(kernel-src): kernel v1.1 exposes neither method; injection
    // fallback above is the live path. Shapes are the canonical JSON by construction.

    /* ---------------- seam #1: persistence ---------------- */
    function projectKey(state) {
      var prefix = (pipelineDef.storage && pipelineDef.storage.projectPrefix) || 'wfproj:';
      var id = state && (state.id || state.project_id);
      if (!id) throw new Error('P2Ext: project state has no id; cannot derive storage key');
      // RESOLVED(kernel-src): kernel persists under PREFIX + p.id verbatim. Confirmed.
      return prefix + id;
    }

    async function _p2Persist(state) {
      // (a) public/internal persist on the kernel, in preference order
      var hook = kernel.persist || kernel.saveProject || kernel.save || kernel._persist;
      if (typeof hook === 'function') return hook.call(kernel, state);
      // (b) direct adapter write — same key scheme the kernel documents
      if (!injectedStorage) {
        throw new Error('P2Ext: no kernel persist method found and no storage adapter injected. ' +
                        'Pass the createKernel storage adapter as opts.storage.');
      }
      // window.storage-style adapter: async set(key, stringValue)
      // RESOLVED(kernel-src) FIX: kernel writes with shared=true; match it,
      // or ext writes land in personal scope while the kernel reads shared.
      return injectedStorage.set(projectKey(state), JSON.stringify(state), true);
    }
    kernel._p2Persist = _p2Persist;

    /* ---------------- eventing (v1.2: unified channel) ---------------- */
    // RESOLVED(kernel-src): kernel v1.1 HAS subscribe/emit. v1.1's
    // `kernel.subscribe || fallback` left ext notify() invisible to kernel
    // subscribers (two disjoint channels). v1.2 chains: one subscribe call
    // registers for BOTH kernel-originated and ext-originated events.
    var kernelSubscribe = typeof kernel.subscribe === 'function' ? kernel.subscribe.bind(kernel) : null;
    kernel.subscribe = function (fn) {
      listeners.push(fn);
      var unK = kernelSubscribe ? kernelSubscribe(fn) : null;
      return function unsubscribe() {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
        if (unK) unK();
      };
    };
    function notify(event) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](event); } catch (e) { /* listener errors never break the kernel */ }
      }
    }
    kernel._p2Notify = notify;

    /* ---------------- mutation serializer (chaos immunity 2026-07-19) ----
     * Two fuzz/browser-proven lost-state races:
     *   1. kernel freshen() re-reads storage and REPLACES the in-memory
     *      project object while an in-flight ext mutation holds the OLD
     *      reference — whichever persists last silently wins.
     *   2. loadProjects() wholesale-replaces the projects array while a
     *      concurrent createProject() is mid-flight — the new project
     *      vanishes from memory (first-use UI race, browser-proven).
     * Every state-replacing op therefore joins ONE global in-process FIFO
     * (the wrap loop sits at the END of install so it covers ext methods
     * too). Cross-client concurrency (two browsers on the shared floor)
     * stays governed by freshen(), unchanged. A failed op rejects to its
     * caller but never wedges the queue. NOTE for maintainers: a queued
     * method must never call another queued method — that deadlocks the
     * tail. Un-queued callers (reserveBudget, recordGateOverride) may. */
    var _mutTail = Promise.resolve();
    function enqueue(fn) {
      var run = _mutTail.then(fn, fn);
      _mutTail = run.then(function () {}, function () {});
      return run;
    }

    /* RESOLVED(kernel-src): kernel v1.1 exposes NEITHER updateBudget NOR
     * recordDecision — additive fallbacks below. P2 governance records
     * append to state.decision_log (frozen asset-ledger shape), kept
     * distinct from the kernel's pipeline ledger state.decisions.
     * recordDecision does NOT persist (callers persist once per mutation
     * — single-persist discipline); updateBudget persists, as UI callers
     * treat it as a complete mutation. */
    kernel.recordDecision = kernel.recordDecision || function (rec) {
      var s = kernel.getProjectState();
      if (!s.decision_log) s.decision_log = [];
      s.decision_log.push(rec);
      return rec;
    };
    kernel.updateBudget = kernel.updateBudget || function (entry) {
      var s = kernel.getProjectState();
      if (!s.budget_ledger) s.budget_ledger = [];
      s.budget_ledger.push(entry);
      return _p2Persist(s).then(function () { return entry; });
    };

    // Wrap the mutators with notify. Wrapping is additive — originals untouched.
    // Async mutators notify AFTER completion (the FIFO means the state a
    // subscriber reads must already hold the mutation it was told about).
    ['updateBudget', 'recordDecision'].forEach(function (m) {
      if (typeof kernel[m] === 'function' && !kernel[m].__p2wrapped) {
        var orig = kernel[m].bind(kernel);
        kernel[m] = function () {
          var args = Array.prototype.slice.call(arguments);
          var r = orig.apply(null, args);
          if (r && typeof r.then === 'function') {
            return r.then(function (v) { notify({ type: m, args: args }); return v; });
          }
          notify({ type: m, args: args });
          return r;
        };
        kernel[m].__p2wrapped = true;
      }
    });

    /* ---------------- UI1-K1 (BURNED 2026-07-19): gate-override seam ----
     * Kernel v1.1's decision-write for a gate override IS
     * advance(id, {override:true, reason}) — the 'gate-override' record and
     * the stage move are ONE mutation, ONE persist (kernel single-persist
     * discipline, worldforge-kernel.v1.1.js advance()). This alias adapts
     * the WFGateOverride component contract to that atomic truth: when the
     * promise resolves, the stage has ALREADY advanced — onDone refreshes,
     * never advances again. Rejects loudly when the current stage has no
     * gate: an ungated advance must never masquerade as an override,
     * because the kernel would record nothing. */
    kernel.recordGateOverride = kernel.recordGateOverride || function (projectId, rec) {
      if (!rec || !rec.reason) {
        return Promise.reject(new Error('recordGateOverride: a recorded reason is required (Rule 7)'));
      }
      var p = typeof kernel.getProject === 'function' ? kernel.getProject(projectId) : null;
      if (!p) return Promise.reject(new Error('recordGateOverride: unknown project ' + projectId));
      if (typeof kernel.gateFor !== 'function' || !kernel.gateFor(p.stage)) {
        return Promise.reject(new Error('recordGateOverride: no gate on the current stage — nothing to override'));
      }
      return Promise.resolve(kernel.advance(projectId, { override: true, reason: rec.reason }))
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error('recordGateOverride: kernel refused the advance: ' + ((res && res.reason) || 'unknown'));
          }
          notify({ type: 'gateOverride', project_id: projectId, stage: res.project.stage });
          return res;
        });
    };

    /* ---------------- budget (v1.0, unchanged contract) ---------------- */
    kernel.getBudgetSummary = function () {
      var s = kernel.getProjectState();
      var ledger = (s && s.budget_ledger) || [];
      var start = (s && s.budget_start) || 0;
      var spent = 0, reserved = 0, corrupt = 0;
      for (var i = 0; i < ledger.length; i++) {
        var e = ledger[i];
        // Chaos immunity 2026-07-19 (fuzz-proven): a null/non-object row
        // crashed the whole summary. Count it loudly instead of dying on it.
        if (!e || typeof e !== 'object') { corrupt++; continue; }
        // RESOLVED: components' frozen entry shape uses `cost`; legacy `amount` honored.
        var amt = Number(e.cost != null ? e.cost : e.amount) || 0;
        if (typeof e.action === 'string' && e.action.indexOf('reserve:') === 0) reserved += amt;
        else spent += amt;
      }
      if (corrupt) console.error('[wf-ext] budget ledger holds ' + corrupt + ' corrupt row(s) — excluded from summary');
      return {
        start: start, spent: spent, reserved: reserved, corrupt: corrupt,
        available: start - spent - reserved,
        currency: (pipelineDef.budget && pipelineDef.budget.currency) || 'USD'
      };
    };

    /* ------- P2 visual read seams (BURNED 2026-07-19, handoff Step 4.4) ----
     * Real names against kernel v1.1 + this ext:
     *   ledger    = state.budget_ledger   (frozen {stage_id, actor, action, cost, ts})
     *   decisions = state.decisions       (kernel pipeline: {ts:number, by, kind, label, note})
     *             + state.decision_log    (P2 governance: ISO ts, actor, kind, reason)
     *   budget    = state.budget_start
     * WFUFDMVisual probes getLedger/getDecisions/getBudget first; these
     * additive read-only aliases are that first probe. getDecisions merges
     * both ledgers (R6 separation holds in storage; the chain is a view)
     * normalized to the component's {kind, reason, actor, ts} vocabulary. */
    kernel.getLedger = kernel.getLedger || function () {
      return (kernel.getProjectState().budget_ledger || []).slice();
    };
    kernel.getDecisions = kernel.getDecisions || function () {
      var s = kernel.getProjectState();
      var out = [];
      (s.decisions || []).forEach(function (d) {
        out.push({ kind: d.kind, reason: d.note || d.label || '', actor: d.by, ts: d.ts });
      });
      (s.decision_log || []).forEach(function (d) { out.push(d); });
      out.sort(function (a, b) {
        var ta = typeof a.ts === 'number' ? a.ts : (Date.parse(a.ts) || 0);
        var tb = typeof b.ts === 'number' ? b.ts : (Date.parse(b.ts) || 0);
        return ta - tb;
      });
      return out;
    };
    kernel.getBudget = kernel.getBudget || function () {
      return { budget_start: Number(kernel.getProjectState().budget_start) || 0 };
    };

    kernel.reserveBudget = function (amount, label) {
      var sum = kernel.getBudgetSummary();
      if (amount > sum.available) {
        return { ok: false, reason: 'insufficient available budget', summary: sum };
      }
      // Frozen ledger shape holds — reservation is just an entry with a
      // reserve: action prefix (design decision carried from v1.0).
      // Chaos immunity 2026-07-19 (fuzz-proven): this wrote `amount`, the
      // exact bug class the frozen shape forbids — the visual tier sums
      // only `cost`, so reservations were invisible. `cost` is the field.
      kernel.updateBudget({ action: 'reserve:' + (label || 'unlabeled'), cost: amount, ts: Date.now() });
      return { ok: true, summary: kernel.getBudgetSummary() };
    };

    /* ---------------- asset ledger (v1.0, persistence rerouted) -------- */
    function assets(s) { s.assets = s.assets || []; return s.assets; }

    kernel.getAssets = function () {
      return assets(kernel.getProjectState()).slice();
    };

    kernel.registerAsset = async function (record) {
      var required = ['id', 'type', 'name']; // aligns with asset-library-schema v3.1 minimums
      // VERIFY(schema): confirm required list against asset-library-schema.v3.1.json
      for (var i = 0; i < required.length; i++) {
        if (record[required[i]] == null) {
          return { ok: false, reason: 'missing required field: ' + required[i] };
        }
      }
      var s = kernel.getProjectState();
      if (assets(s).some(function (a) { return a.id === record.id; })) {
        return { ok: false, reason: 'duplicate asset id: ' + record.id };
      }
      record.locked = false;
      record.registered_at = new Date().toISOString();
      assets(s).push(record);
      await _p2Persist(s);
      notify({ type: 'registerAsset', asset: record });
      return { ok: true, asset: record };
    };

    async function setLock(id, locked, reason) {
      var s = kernel.getProjectState();
      var a = assets(s).find(function (x) { return x.id === id; });
      if (!a) return { ok: false, reason: 'unknown asset: ' + id };
      if (locked && a.locked) return { ok: false, reason: 'already locked' };
      if (!locked && !a.locked) return { ok: false, reason: 'not locked' };
      if (!locked && !reason) return { ok: false, reason: 'unlock requires a reason (Rule 7)' };
      a.locked = locked;
      a[locked ? 'locked_at' : 'unlocked_at'] = new Date().toISOString();
      if (!locked) {
        kernel.recordDecision({
          kind: 'asset-unlock', asset_id: id, reason: reason,
          impact: 'low', ts: new Date().toISOString()
        });
        // RESOLVED(kernel-src): lands in decision_log via fallback; frozen shape as given.
      }
      await _p2Persist(s);
      notify({ type: locked ? 'lockAsset' : 'unlockAsset', asset: a });
      return { ok: true, asset: a };
    }
    kernel.lockAsset = function (id) { return setLock(id, true); };
    kernel.unlockAsset = function (id, reason) { return setLock(id, false, reason); };

    /* ------ seam #2: fingerprint verification (tri-state) ------ */
    async function defaultDigest(bytes) {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        var buf = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
        var h = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(h))
          .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
      return null; // Node path: inject opts.digest using require('crypto')
    }
    var digest = opts.digest || defaultDigest;

    kernel.verifyAssetFingerprint = async function (id) {
      var a = kernel.getAssets().find(function (x) { return x.id === id; });
      if (!a) return { status: 'error', reason: 'unknown asset: ' + id };
      if (!a.fingerprint) return { status: 'unverifiable', reason: 'no recorded fingerprint' };
      if (!injectedReadBytes) {
        return { status: 'unverifiable',
                 reason: 'no readAssetBytes injected — asset-byte storage location is decision P2-D-bytes (open)' };
      }
      try {
        var bytes = await injectedReadBytes(a);
        if (bytes == null) return { status: 'unverifiable', reason: 'bytes unavailable for ' + id };
        var hex = await digest(bytes);
        if (hex == null) return { status: 'unverifiable', reason: 'no digest implementation in this runtime' };
        return hex === a.fingerprint
          ? { status: 'verified', fingerprint: hex }
          : { status: 'mismatch', expected: a.fingerprint, actual: hex };
      } catch (e) {
        return { status: 'error', reason: String(e && e.message || e) };
      }
    };

    /* ---------------- rule evaluator (rules.v1.json DSL) --------------- */
    kernel.loadRules = function (doc) {
      if (!doc || !Array.isArray(doc.rules)) throw new Error('P2Ext: invalid rules.v1.json');
      rules = doc;
      notify({ type: 'loadRules', version: doc.rules_version, source: doc.source });
      return { ok: true, count: doc.rules.length, source: doc.source };
    };

    var PREDICATES = {
      missing_field: function (ctx, p) {
        var v = p.path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, ctx);
        return v == null || v === '';
      },
      impact_gte: function (ctx, p) {
        var order = { low: 0, medium: 1, high: 2, critical: 3 };
        return (order[ctx.promotion && ctx.promotion.impact] || 0) >= (order[p.threshold] || 0);
      },
      asset_unlocked_promotion: function (ctx) {
        return !!(ctx.asset && ctx.asset.locked === false && ctx.promotion);
      }
      // extensible: gen_rules.py may emit new predicate ids; unknown ids
      // evaluate to a finding of severity 'error' (fail-closed, below).
    };

    kernel.evaluateRules = function (ctx) {
      if (!rules) return { ok: false, findings: [{ rule: 'RULES-MISSING', severity: 'error',
        message: 'rules.v1.json not loaded — promotion blocked (fail-closed)' }] };
      var findings = [];
      for (var i = 0; i < rules.rules.length; i++) {
        var r = rules.rules[i];
        var fn = PREDICATES[r.predicate];
        if (!fn) {
          findings.push({ rule: r.id, severity: 'error',
            message: 'unknown predicate "' + r.predicate + '" — regenerate ext or rules' });
          continue;
        }
        var fired;
        try { fired = fn(ctx, r.params || {}); }
        catch (e) { findings.push({ rule: r.id, severity: 'error', message: String(e) }); continue; }
        if (fired) findings.push({ rule: r.id, severity: r.severity || 'error', message: r.message });
      }
      if (rules.source === 'bootstrap') {
        findings.push({ rule: 'RULES-PROVENANCE', severity: 'warn',
          message: 'rules.v1.json compiled from bootstrap table, not lint_worldforge.py — advisory only' });
      }
      return { ok: !findings.some(function (f) { return f.severity === 'error'; }), findings: findings };
    };

    /* ---------------- promoteAsset (transactional) ---------------- */
    kernel.promoteAsset = async function (req) {
      // req: { asset_id, actor, reason, impact, approver? }
      var t0 = Date.now();
      var s = kernel.getProjectState();
      var a = assets(s).find(function (x) { return x.id === req.asset_id; });
      if (!a) return { ok: false, stage: 'lookup', reason: 'unknown asset: ' + req.asset_id };

      // 1. schema check (Rule 12 structural requirement)
      if (!req.reason) return { ok: false, stage: 'schema', reason: 'decision reason required (Rule 12: no silent promotion)' };
      if (!req.actor)  return { ok: false, stage: 'schema', reason: 'actor required' };

      // 2. commit-time rule re-run (never trust a stale UI evaluation)
      var evalResult = kernel.evaluateRules({ asset: a, promotion: req, project: s });
      if (!evalResult.ok) return { ok: false, stage: 'rules', findings: evalResult.findings };

      // 3. GOV-2 gate: high-impact promotions need a second approver
      var needsGov2 = evalResult.findings.some(function (f) { return f.rule === 'GOV-2'; });
      if (needsGov2 && !req.approver) {
        return { ok: false, stage: 'gov2', reason: 'impact threshold met — approver required', findings: evalResult.findings };
      }

      // 4. decision record (Rule 7) — before mutation, atomic with it
      kernel.recordDecision({
        kind: 'promotion', asset_id: a.id, actor: req.actor,
        approver: req.approver || null, reason: req.reason,
        impact: req.impact || 'low', findings: evalResult.findings,
        ts: new Date().toISOString()
      });

      // 5. promotion log + lock, single persist (atomic)
      s.promotion_log = s.promotion_log || [];
      s.promotion_log.push({ asset_id: a.id, actor: req.actor, ts: new Date().toISOString() });
      a.locked = true;
      a.locked_at = new Date().toISOString();
      a.promoted = true;
      await _p2Persist(s);

      notify({ type: 'promoteAsset', asset: a });
      return { ok: true, asset: a, elapsed_ms: Date.now() - t0 }; // design law: clean path < 10s
    };

    /* ---------------- UFDM export / validate / import ------------------ */
    kernel.exportUFDM = function () {
      var s = kernel.getProjectState();
      return {
        ufdm_version: '1.0.0',
        exported_at: new Date().toISOString(),
        kernel_version: kernel.version || '1.x',
        ext_version: EXT_VERSION,
        project: s,
        stages: pipelineDef.stages,
        agents: rosterDef.agents,
        assets: (s.assets || []),
        decision_log: (s.decisions || s.decision_log || []),
        // RESOLVED(kernel-src): kernel pipeline ledger is `decisions`; P2 ledger is `decision_log`. Dual-read correct.
        budget: kernel.getBudgetSummary()
      };
    };

    kernel.validateUFDM = function (doc) {
      var problems = []; // validate-all-report-all (v1.0 contract)
      if (!doc || typeof doc !== 'object') return { ok: false, problems: ['not an object'] };
      if (doc.ufdm_version !== '1.0.0') problems.push('unsupported ufdm_version: ' + doc.ufdm_version);
      if (!doc.project || !doc.project.id) problems.push('project.id missing');
      if (!Array.isArray(doc.stages) || doc.stages.length < 2) problems.push('stages invalid (<2)');
      var canonStages = pipelineDef.stages.map(function (st) { return st.id; }).join(',');
      var docStages = (doc.stages || []).map(function (st) { return st.id; }).join(',');
      if (canonStages !== docStages) problems.push('stage sequence differs from canonical pipeline');
      var agentIds = {};
      rosterDef.agents.forEach(function (ag) { agentIds[ag.id || ag.name] = true; });
      (doc.decision_log || []).forEach(function (d, i) {
        if (d.actor && !agentIds[d.actor] && d.actor !== 'human') {
          problems.push('decision_log[' + i + '].actor not in canonical roster: ' + d.actor);
        }
      });
      (doc.assets || []).forEach(function (a, i) {
        if (!a.id) problems.push('assets[' + i + '].id missing');
      });
      return { ok: problems.length === 0, problems: problems };
    };

    kernel.importUFDM = async function (doc) {
      var v = kernel.validateUFDM(doc);
      if (!v.ok) return { ok: false, problems: v.problems };
      // atomic single-persist reconstruct (v1.0 contract)
      await _p2Persist(doc.project);
      notify({ type: 'importUFDM', project_id: doc.project.id });
      return { ok: true, project_id: doc.project.id };
    };

    /* ---- serializer wrap (chaos immunity 2026-07-19, see enqueue above) --
     * Applied LAST so it covers kernel mutators AND every ext method that
     * persists or replaces in-memory state. Anything in this list must not
     * call anything else in this list (deadlock — see the enqueue note). */
    ['loadProjects', 'createProject', 'advance', 'stepBack', 'saveNotes',
     'deleteProject', 'updateBudget', 'registerAsset', 'lockAsset',
     'unlockAsset', 'promoteAsset', 'importUFDM'].forEach(function (m) {
      if (typeof kernel[m] === 'function' && !kernel[m].__p2queued) {
        var orig = kernel[m].bind(kernel);
        kernel[m] = function () {
          var args = arguments;
          return enqueue(function () { return orig.apply(null, args); });
        };
        kernel[m].__p2queued = true;
      }
    });

    return kernel;
  }

  return { install: install, EXT_VERSION: EXT_VERSION };
}));
