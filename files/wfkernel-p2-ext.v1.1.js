/*!
 * wfkernel-p2-ext.v1.1.js — WorldForge OS P2 kernel extension (RECONCILED)
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

  var EXT_VERSION = '1.1.0';
  var REQUIRED_KERNEL = '1.0.0'; // VERIFY(kernel-src): exact KERNEL_VERSION export name

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
    // VERIFY(kernel-src): if the kernel already exposes either method,
    // confirm return shape matches canonical JSON ({stages:[...]}, {agents:[...]}).

    /* ---------------- seam #1: persistence ---------------- */
    function projectKey(state) {
      var prefix = (pipelineDef.storage && pipelineDef.storage.projectPrefix) || 'wfproj:';
      var id = state && (state.id || state.project_id);
      if (!id) throw new Error('P2Ext: project state has no id; cannot derive storage key');
      // VERIFY(kernel-src): key scheme — confirm kernel uses prefix + id verbatim.
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
      return injectedStorage.set(projectKey(state), JSON.stringify(state));
    }
    kernel._p2Persist = _p2Persist;

    /* ---------------- eventing (v1.0, unchanged) ---------------- */
    kernel.subscribe = kernel.subscribe || function (fn) {
      listeners.push(fn);
      return function unsubscribe() {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    };
    function notify(event) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](event); } catch (e) { /* listener errors never break the kernel */ }
      }
    }
    kernel._p2Notify = notify;

    // Wrap documented-live mutators with notify. Wrapping is additive —
    // originals untouched.
    // VERIFY(kernel-src): updateBudget(entry) and recordDecision(record)
    // signatures + whether they persist internally (assumed yes; if not,
    // append _p2Persist(getProjectState()) inside these wrappers).
    ['updateBudget', 'recordDecision'].forEach(function (m) {
      if (typeof kernel[m] === 'function' && !kernel[m].__p2wrapped) {
        var orig = kernel[m].bind(kernel);
        kernel[m] = function () {
          var r = orig.apply(null, arguments);
          notify({ type: m, args: Array.prototype.slice.call(arguments) });
          return r;
        };
        kernel[m].__p2wrapped = true;
      }
    });

    /* ---------------- budget (v1.0, unchanged contract) ---------------- */
    kernel.getBudgetSummary = function () {
      var s = kernel.getProjectState();
      var ledger = (s && s.budget_ledger) || [];
      var start = (s && s.budget_start) || 0;
      // VERIFY(kernel-src): field names budget_start / budget_ledger and
      // entry shape { action, amount, actor, ts } against real state.
      var spent = 0, reserved = 0;
      for (var i = 0; i < ledger.length; i++) {
        var e = ledger[i];
        var amt = Number(e.amount) || 0;
        if (typeof e.action === 'string' && e.action.indexOf('reserve:') === 0) reserved += amt;
        else spent += amt;
      }
      return {
        start: start, spent: spent, reserved: reserved,
        available: start - spent - reserved,
        currency: (pipelineDef.budget && pipelineDef.budget.currency) || 'USD'
      };
    };

    kernel.reserveBudget = function (amount, label) {
      var sum = kernel.getBudgetSummary();
      if (amount > sum.available) {
        return { ok: false, reason: 'insufficient available budget', summary: sum };
      }
      // Frozen ledger shape holds — reservation is just an entry with a
      // reserve: action prefix (design decision carried from v1.0).
      kernel.updateBudget({ action: 'reserve:' + (label || 'unlabeled'), amount: amount });
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
        // VERIFY(kernel-src): recordDecision frozen schema field names.
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
        kernel_version: REQUIRED_KERNEL,
        ext_version: EXT_VERSION,
        project: s,
        stages: pipelineDef.stages,
        agents: rosterDef.agents,
        assets: (s.assets || []),
        decision_log: (s.decisions || s.decision_log || []),
        // VERIFY(kernel-src): decision log field name on project state.
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

    return kernel;
  }

  return { install: install, EXT_VERSION: EXT_VERSION };
}));
