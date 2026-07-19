/*!
 * worldforge-kernel.v1.1.js — WorldForge OS governed project kernel (UMD)
 *
 * Extracted from worldforge-os_4.html block 01 (KERNEL_ACCESS regions per
 * work/blocks/manifest.json) and bound to the recovered public contract in
 * fragment-inventory_v1.md:
 *   - UMD: module.exports / root.WFKernel
 *   - createKernel({ storage, pipeline, actor }) — storage required (throws),
 *     pipeline required (>=2 stages)
 *   - PREFIX from pipeline.storage.projectPrefix (default 'wfproj:'),
 *     LEGACY from pipeline.storage.legacyKey (default 'worldforge-projects-v1')
 *   - Gate semantics: gate-on-LEAVING-stage; passes logged as 'gate-pass',
 *     overrides as 'gate-override'; step-back requires a recorded reason (Rule 7)
 *
 * EXTRACT-DIVERGENCE log (differences from the inline original, all deliberate):
 *   ED-1 storage injection   — window.storage replaced by injected async adapter
 *                              { get(k,shared), set(k,v,shared), delete(k,shared),
 *                                list(prefix,shared) }; kernel throws without it.
 *   ED-2 constant derivation — PREFIX/LEGACY/PROFILE keys derived from pipeline
 *                              config instead of file-scope literals.
 *   ED-3 gate semantics      — gates carried on pipeline.gates (index -> def);
 *                              kernel refuses ungated advance past a gated stage
 *                              unless caller passes {gatePassed:true}; soft
 *                              override supported via {override:true, reason}
 *                              logged as 'gate-override'.
 *   ED-4 actor seam          — actor is a string or () => string; replaces the
 *                              inline myName global. Free-text still allowed at
 *                              kernel tier; export validation enforces roster-id
 *                              or 'human' (MARKER ACT-1 unchanged, owned by ext).
 *   ED-5 pipeline injection  — STAGES no longer a file-scope constant; stages
 *                              come from pipeline.stages.
 *   ED-6 versioning          — KERNEL_VERSION '1.1.0', PROJECT_SCHEMA_VERSION 2;
 *                              projects persisted with schemaVersion stamp,
 *                              legacy (unstamped) records upgraded on migrate.
 *
 * Single-persist discipline: every mutation is freshen -> mutate -> ONE
 * storage.set. Decision records append-only, capped at 100 (frozen decision).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WFKernel = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var KERNEL_VERSION = "1.1.1"; // 1.1.1: loud corrupt-entry skip on load (chaos immunity 2026-07-19)
  var PROJECT_SCHEMA_VERSION = 2;

  function createKernel(opts) {
    opts = opts || {};
    var storage = opts.storage;
    var pipeline = opts.pipeline;
    var actorOpt = opts.actor;

    if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function")
      throw new Error("WFKernel: storage adapter is required (get/set/delete/list)");
    if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length < 2)
      throw new Error("WFKernel: pipeline with >=2 stages is required");

    var st = pipeline.storage || {};
    var PREFIX = st.projectPrefix || "wfproj:";
    var LEGACY = st.legacyKey || "worldforge-projects-v1";
    var PROFILE_KEY = st.profileKey || "worldforge-profile-v1";
    var STAGES = pipeline.stages;
    var GATES = pipeline.gates || {};
    var DECISION_CAP = 100;

    var actor = typeof actorOpt === "function" ? actorOpt : function () { return actorOpt || "A Forger"; };

    var projects = [];
    var listeners = [];

    function emit(evt) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](evt); } catch (e) { /* listener errors never break the kernel */ }
      }
    }

    function record(p, kind, label, note) {
      if (!p.decisions) p.decisions = [];
      p.decisions.push({ ts: Date.now(), by: actor(), kind: kind, label: label, note: note || "" });
      if (p.decisions.length > DECISION_CAP) p.decisions = p.decisions.slice(-DECISION_CAP);
    }

    function stamp(p) {
      p.schemaVersion = PROJECT_SCHEMA_VERSION;
      p.lastTouchedBy = actor();
      p.updatedAt = Date.now();
      return p;
    }

    async function persist(p) {
      var ok = await storage.set(PREFIX + p.id, JSON.stringify(p), true);
      if (!ok) throw new Error("persist-failed");
      return p;
    }

    /* ---- hydration + one-time legacy migration (frozen decision) ---- */
    async function migrateLegacy() {
      try {
        var r = await storage.get(LEGACY, true);
        if (r && r.value) {
          var old = JSON.parse(r.value);
          for (var i = 0; i < old.length; i++) {
            var p = old[i];
            if (!p.decisions) p.decisions = [];
            p.schemaVersion = PROJECT_SCHEMA_VERSION; // ED-6 upgrade stamp
            try { await storage.set(PREFIX + p.id, JSON.stringify(p), true); } catch (e) { /* per-project best effort */ }
          }
          if (old.length) emit({ type: "migrated", count: old.length });
          return old;
        }
      } catch (e) { /* no legacy floor */ }
      return [];
    }

    async function loadProjects() {
      var loaded = [];
      var corrupt = 0;
      try {
        var listing = await storage.list(PREFIX, true);
        var keys = (listing && listing.keys) ? listing.keys : [];
        if (keys.length) {
          var results = await Promise.allSettled(keys.map(function (k) { return storage.get(k, true); }));
          results.forEach(function (r, i) {
            if (r.status === "fulfilled" && r.value && r.value.value) {
              try { loaded.push(JSON.parse(r.value.value)); }
              catch (e) {
                // Chaos immunity 2026-07-19: a corrupt entry used to vanish
                // silently — a project disappearing with no trace. Skip is
                // still the right recovery (one bad row must not take the
                // floor down), but it is LOUD now: console + event payload.
                corrupt++;
                if (typeof console !== "undefined") console.error("[wf-kernel] corrupt project entry skipped: " + keys[i], e);
                emit({ type: "corrupt-entry", key: keys[i] });
              }
            }
          });
        } else {
          loaded = await migrateLegacy();
        }
      } catch (e) {
        try { loaded = await migrateLegacy(); } catch (e2) { loaded = []; }
      }
      projects = loaded;
      emit({ type: "loaded", count: projects.length, corrupt: corrupt });
      return projects.slice();
    }

    // Re-read right before mutating: stale local copies never clobber
    // someone else's newer stage/notes/decisions.
    async function freshen(id) {
      try {
        var r = await storage.get(PREFIX + id, true);
        if (r && r.value) {
          var fresh = JSON.parse(r.value);
          var i = projects.findIndex(function (x) { return x.id === id; });
          if (i >= 0) projects[i] = fresh; else projects.push(fresh);
          return fresh;
        }
      } catch (e) { /* fall through to local copy */ }
      return projects.find(function (x) { return x.id === id; });
    }

    /* ---- profile (actor persistence) ---- */
    async function loadProfile() {
      try {
        var r = await storage.get(PROFILE_KEY, false);
        if (r && r.value) return (JSON.parse(r.value).name || "");
      } catch (e) { /* no profile yet */ }
      return "";
    }
    async function saveProfile(name) {
      try { await storage.set(PROFILE_KEY, JSON.stringify({ name: name }), false); } catch (e) { /* non-fatal */ }
    }

    /* ---- mutations (freshen -> mutate -> single persist) ---- */
    async function createProject(fields) {
      if (!fields || !fields.name) throw new Error("createProject: name required");
      var by = actor();
      var proj = stamp({
        id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name: fields.name, type: fields.type || "film",
        stage: 0, notes: "", decisions: [],
        createdBy: by, createdAt: Date.now()
      });
      projects.push(proj);
      await persist(proj);
      emit({ type: "created", id: proj.id });
      return proj;
    }

    function gateFor(stageIndex) { return GATES[stageIndex] || null; }

    async function advance(id, gateResult) {
      var p = await freshen(id);
      if (!p) throw new Error("advance: unknown project " + id);
      if (p.stage >= STAGES.length - 1) return { ok: false, reason: "complete", project: p };
      var gate = gateFor(p.stage); // gate fires on LEAVING the stage (frozen semantics)
      if (gate) {
        if (!gateResult || (!gateResult.gatePassed && !gateResult.override))
          return { ok: false, reason: "gate", gate: gate, project: p };
        if (gateResult.override) {
          if (!gateResult.reason) throw new Error("gate-override requires a recorded reason");
          record(p, "gate-override", gate.title, gateResult.reason);
        } else {
          record(p, "gate-pass", gate.title, gateResult.reason || "");
        }
      }
      p.stage += 1;
      stamp(p);
      await persist(p);
      emit({ type: "advanced", id: id, stage: p.stage });
      return { ok: true, project: p };
    }

    async function stepBack(id, reason) {
      if (!reason || !String(reason).trim())
        throw new Error("stepBack: a recorded reason is required (Rule 7)");
      var p = await freshen(id);
      if (!p) throw new Error("stepBack: unknown project " + id);
      if (p.stage === 0) return { ok: false, reason: "at-start", project: p };
      record(p, "step-back", 'Back to "' + STAGES[p.stage - 1] + '"', reason);
      p.stage -= 1;
      stamp(p);
      await persist(p);
      emit({ type: "stepped-back", id: id, stage: p.stage });
      return { ok: true, project: p };
    }

    async function saveNotes(id, text) {
      var p = await freshen(id);
      if (!p) throw new Error("saveNotes: unknown project " + id);
      p.notes = text;
      stamp(p);
      await persist(p);
      emit({ type: "notes-saved", id: id });
      return p;
    }

    async function deleteProject(id) {
      projects = projects.filter(function (x) { return x.id !== id; });
      try { await storage.delete(PREFIX + id, true); }
      catch (e) { emit({ type: "delete-unsynced", id: id }); throw e; }
      emit({ type: "deleted", id: id });
    }

    return {
      version: KERNEL_VERSION,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      stages: STAGES.slice(),
      gateFor: gateFor,
      loadProjects: loadProjects,
      getProjects: function () { return projects.slice(); },
      getProject: function (id) { return projects.find(function (x) { return x.id === id; }); },
      freshen: freshen,
      loadProfile: loadProfile,
      saveProfile: saveProfile,
      createProject: createProject,
      advance: advance,
      stepBack: stepBack,
      saveNotes: saveNotes,
      deleteProject: deleteProject,
      subscribe: function (fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      }
    };
  }

  return {
    KERNEL_VERSION: KERNEL_VERSION,
    PROJECT_SCHEMA_VERSION: PROJECT_SCHEMA_VERSION,
    createKernel: createKernel
  };
});
