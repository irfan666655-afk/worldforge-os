/*!
 * app.js — WorldForge OS P4 entry point (UMD)
 * The ONLY place that decides between 3D and fallback modes; components
 * never probe capabilities. One degradation path, two triggers:
 * WebGL missing OR CDN failed -> text roster.
 *
 * Boot order: storage adapter -> kernel (via KernelAdapter, the sole
 * kernel-global seam) -> mode decision -> component mounts.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.app = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";

  var GATE_AFTER = {
    4: { title: "Previz gate — Rule 3",
         text: "Scene Simulation is done. Before committing generation budget: has a cheap draft/previz been produced and explicitly approved?" },
    5: { title: "Budget & routing gate — Rules 3 & 11",
         text: "Confirm the running budget covers this batch, and that the routed model(s) were verified current — not deprecated — before pacing is compiled." },
    8: { title: "Validation gate — Rule 4",
         text: "Confirm every shot passed tiered validation and the fingerprint diff against locked canon. A failure gets targeted re-generation, not a blanket pass." }
  };

  // window.storage (artifact persistence API) behind an injected-adapter
  // seam; in-memory shim keeps file:// double-click functional when the
  // API is absent (data is then session-only — surfaced in console).
  function makeStorageAdapter() {
    if (typeof window !== "undefined" && window.storage) return window.storage;
    console.warn("[wf] window.storage unavailable — using in-memory session store (nothing persists)");
    var mem = {};
    return {
      get: async function (k) { return (k in mem) ? { key: k, value: mem[k] } : null; },
      set: async function (k, v) { mem[k] = v; return { key: k, value: v }; },
      delete: async function (k) { delete mem[k]; return { key: k, deleted: true }; },
      list: async function (prefix) {
        return { keys: Object.keys(mem).filter(function (k) { return k.indexOf(prefix || "") === 0; }) };
      }
    };
  }

  var state = { viz: null, forge: null, ufdm: null, actorName: "" };

  async function boot() {
    var VendorLoader = WF.VendorLoader, Data = WF.Data;

    var storageAdapter = makeStorageAdapter(); // ONE instance — kernel and ext must share it
    var adapter = WF.KernelAdapter.create({
      storage: storageAdapter,
      pipeline: {
        stages: Data.STAGES,
        gates: GATE_AFTER,
        storage: { projectPrefix: "wfproj:", legacyKey: "worldforge-projects-v1", profileKey: "worldforge-profile-v1" }
      },
      actor: function () { return state.actorName || "A Forger"; }
    });

    state.actorName = await adapter.loadProfile();

    /* ---- P2 extension install (slot per dec_p4_p2_slot_deferred, now filled) ---- */
    var g = typeof self !== "undefined" ? self : globalThis;
    var p2kernel = null;
    if (g.WFKernelP2Ext) {
      // MARKER PIPE-1: canonical pipeline.v1.json not yet in project knowledge.
      // Interim canonical object derived from bundled STAGES; swaps to the
      // real file with zero code changes when it lands (injection seam).
      var pipelineCanon = {
        provenance: "interim-pending-PIPE-1",
        stages: Data.STAGES.map(function (label, i) { return { id: "st" + i, label: label }; }),
        storage: { projectPrefix: "wfproj:", legacyKey: "worldforge-projects-v1" },
        budget: { currency: "USD" }
      };
      var rosterCanon = {
        rosterVersion: "5.2.0",
        agents: Data.GUILDS.reduce(function (acc, gd) {
          gd.agents.forEach(function (a) { acc.push({ name: a.name, guild: gd.name }); });
          return acc;
        }, [])
      };
      p2kernel = adapter.installP2(g.WFKernelP2Ext, {
        pipeline: pipelineCanon, roster: rosterCanon, storage: storageAdapter
      });
    }

    /* ---- mode decision (sole decider) ---- */
    var canWebGL = VendorLoader.webglAvailable();
    var three = canWebGL ? await VendorLoader.loadThree() : null;

    if (three) {
      state.viz = WF.EscalationViz.mount(document.getElementById("stage"), three, {
        GUILDS: Data.GUILDS, STAGES: Data.STAGES
      });
    } else {
      enterFallbackMode(canWebGL ? "cdn" : "webgl");
    }

    /* ---- forge UI mounts regardless of mode (DOM-only) ---- */
    state.forge = WF.Forge.mount(adapter, {
      onStageChange: function (idx) { if (state.viz) state.viz.updateStationColors(idx); },
      onActorChange: function (name) { state.actorName = name; },
      onProjectSelect: function (id) {
        adapter.bindProject(id);
        /* P2 visual surface: mounted only while a project is bound —
         * the ext read seams throw loudly on an unbound kernel, by design. */
        if (!p2kernel || !g.WFUFDMVisual) return;
        if (id) {
          if (!state.ufdm) {
            var surf = document.getElementById("ufdm-surface");
            if (surf) state.ufdm = new g.WFUFDMVisual(p2kernel, { mount: surf, projectId: id }).mount();
          } else {
            state.ufdm.projectId = id;
            state.ufdm.update();
          }
        } else if (state.ufdm) {
          state.ufdm.destroy();
          state.ufdm = null;
        }
      },
      /* P4-UI1: only offered when the ext seam and the component shipped.
       * The forge never sees the kernel — it gets back a record or null. */
      onGateOverride: (p2kernel && g.WFGateOverride) ? function (projectId, stageId) {
        return new Promise(function (resolve) {
          var backdrop = document.getElementById("override-backdrop");
          var mountEl = document.getElementById("gate-override-mount");
          if (!backdrop || !mountEl) { resolve(null); return; }
          backdrop.classList.add("visible");
          var seam = {
            // ACT-1: the modal's actor field wins — the kernel actor seam
            // reads state.actorName at record time, so set it pre-write.
            recordGateOverride: function (pid, rec) {
              if (rec && rec.actor) {
                state.actorName = rec.actor;
                if (state.forge) state.forge.setActor(rec.actor);
              }
              return p2kernel.recordGateOverride(pid, rec);
            }
          };
          new g.WFGateOverride(seam, {
            mount: mountEl, projectId: projectId, stageId: stageId,
            actor: state.actorName || "human",
            onDone: function (rec) {
              backdrop.classList.remove("visible");
              resolve(rec);
            }
          }).mount();
        });
      } : null
    });

    /* ---- P2 surface: UFDM export on the forge detail panel ---- */
    if (p2kernel && WF && g.WFUFDM) {
      var detail = document.getElementById("forge-detail");
      if (detail && !document.getElementById("ufdm-export-btn")) {
        var btn = document.createElement("button");
        btn.id = "ufdm-export-btn";
        btn.textContent = "Export UFDM";
        btn.style.cssText = "margin-top:10px;width:100%;";
        btn.onclick = function () {
          try {
            var exp = new g.WFUFDM.UFDMExport(p2kernel, { mount: detail });
            exp.download();
          } catch (e) { console.error("[wf] UFDM export failed", e); }
        };
        detail.appendChild(btn);
      }
    }
    state.forge.setActor(state.actorName);

    /* ---- mode buttons (DOM toggles here; scene toggles in viz) ---- */
    function setMode(mode) {
      if (state.viz) state.viz.setMode(mode);
      document.getElementById("mode-explore").classList.toggle("active", mode === "explore");
      document.getElementById("mode-forge").classList.toggle("active", mode === "forge");
      document.getElementById("forge-floor").classList.toggle("visible", mode === "forge");
      document.getElementById("forge-detail").classList.toggle("visible", mode === "forge" && state.forge.hasActive());
      document.getElementById("hint").textContent = mode === "explore"
        ? "drag to rotate · scroll to zoom · click a node to inspect"
        : "drag to rotate · scroll to zoom · pick a project from the floor";
    }
    document.getElementById("mode-explore").onclick = function () { setMode("explore"); };
    document.getElementById("mode-forge").onclick = function () { setMode("forge"); state.forge.refresh(); };
  }

  function enterFallbackMode(reason) {
    var stage = document.getElementById("stage");
    if (stage) stage.setAttribute("hidden", "");
    var mountEl = document.getElementById("roster-mount");
    if (!mountEl) {
      mountEl = document.createElement("div");
      mountEl.id = "roster-mount";
      document.body.appendChild(mountEl);
    }
    mountEl.removeAttribute("hidden");
    var TR = WF.TextRoster;
    new TR.TextRoster(mountEl, TR.toMinimalRoster(WF.Data.GUILDS)).mount();
    console.info("[wf] fallback mode (" + reason + "): text roster active");
  }

  // Belt-and-braces: vendor-loader fires this if the CDN dies after boot decided.
  if (typeof document !== "undefined") {
    document.addEventListener("wf:vendor-fallback", function () {
      var m = document.getElementById("roster-mount");
      if (!m || !m.hasChildNodes()) enterFallbackMode("cdn-late");
    });
  }

  return { boot: boot, _internals: { makeStorageAdapter: makeStorageAdapter, GATE_AFTER: GATE_AFTER } };
});
