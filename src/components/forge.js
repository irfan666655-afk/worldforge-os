/*!
 * components/forge.js — WorldForge OS P4 (UMD)
 * The forge floor UI carried from monolith block 01: project list, detail
 * rail, decision record render, gate modal, new-project modal, toast.
 * ALL kernel access goes through the injected adapter — this file contains
 * zero storage calls and zero direct kernel references. Gate copy text
 * lives in the pipeline (app.js), not here: the UI renders gates, the
 * kernel enforces them.
 *
 * Contract: WF.Forge.mount(adapter, { onStageChange(idx|null) })
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.Forge = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";

  function mount(adapter, hooks) {
    hooks = hooks || {};
    var onStageChange = hooks.onStageChange || function () {};
    var STAGES = adapter.stages;
    var activeProjectId = null;
    var myName = "";

    var $ = function (id) { return document.getElementById(id); };

    function toast(msg) {
      var el = $("toast");
      el.textContent = msg; el.classList.add("show");
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
    }

    function escapeHtml(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

    /* ---- render ---- */
    function renderProjectList() {
      var projects = adapter.getProjects();
      var list = $("project-list");
      var empty = $("floor-empty");
      list.innerHTML = "";
      if (projects.length === 0) { empty.style.display = "block"; return; }
      empty.style.display = "none";
      projects.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (p) {
        var card = document.createElement("div");
        card.className = "project-card" + (p.id === activeProjectId ? " selected" : "");
        var pct = Math.round((p.stage / (STAGES.length - 1)) * 100);
        card.innerHTML =
          '<div class="pname">' + escapeHtml(p.name) + '</div>' +
          '<div class="pmeta">' + escapeHtml(p.type) + ' · forged by ' + escapeHtml(p.createdBy) + '</div>' +
          '<div class="pmeta" style="margin-top:4px;">Stage ' + (p.stage + 1) + '/' + STAGES.length + ' — ' + escapeHtml(STAGES[p.stage]) + '</div>' +
          '<div class="pbar"><div style="width:' + pct + '%"></div></div>';
        card.onclick = function () { activeProjectId = p.id; renderProjectList(); renderDetail(p); $("forge-detail").classList.add("visible"); };
        list.appendChild(card);
      });
    }

    function renderDetail(p) {
      hooks.onProjectSelect && hooks.onProjectSelect(p.id);
      $("fd-name").textContent = p.name;
      $("fd-meta").textContent = p.type + " · forged by " + p.createdBy + " · last touched by " + p.lastTouchedBy;
      var rail = $("fd-rail");
      rail.innerHTML = "";
      STAGES.forEach(function (label, i) {
        var row = document.createElement("div");
        row.className = "rail-station" + (i < p.stage ? " done" : i === p.stage ? " current" : "");
        row.innerHTML = '<div class="num mono">' + (i < p.stage ? "✓" : i + 1) + '</div><div class="label">' + label + (adapter.gateFor(i) ? ' <span style="color:var(--spark);opacity:.7;">⛨</span>' : "") + '</div>';
        rail.appendChild(row);
      });
      var btn = $("advance-btn");
      if (p.stage >= STAGES.length - 1) { btn.disabled = true; btn.textContent = "Learning complete — forged"; }
      else {
        btn.disabled = false;
        btn.textContent = adapter.gateFor(p.stage)
          ? 'Pass gate → "' + STAGES[p.stage + 1] + '"'
          : 'Advance to "' + STAGES[p.stage + 1] + '"';
      }
      $("stepback-btn").disabled = (p.stage === 0);
      $("notes-box").value = p.notes || "";
      renderDecisions(p);
      onStageChange(p.stage);
    }

    function renderDecisions(p) {
      var box = $("fd-decisions");
      box.innerHTML = "";
      var ds = (p.decisions || []).slice().sort(function (a, b) { return b.ts - a.ts; });
      if (ds.length === 0) {
        box.innerHTML = '<div class="d-empty">Nothing on the record yet. Gate confirmations and step-backs land here — a decision with real weight gets recorded, not just decided (Rule 7).</div>';
        return;
      }
      ds.forEach(function (d) {
        var row = document.createElement("div");
        row.className = "d-row";
        var when = new Date(d.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        var kindLabel = d.kind === "step-back" ? "reversal" : d.kind === "gate-override" ? "override" : "gate passed";
        row.innerHTML =
          '<div class="d-meta"><span class="d-kind-' + escapeHtml(d.kind) + '">' + kindLabel + '</span> · ' + escapeHtml(d.by) + ' · ' + when + '</div>' +
          '<div class="d-label">' + escapeHtml(d.label) + '</div>' +
          (d.note ? '<div class="d-note">' + escapeHtml(d.note) + '</div>' : '');
        box.appendChild(row);
      });
    }

    /* ---- gate modal (window.confirm is unreliable in sandboxed frames) ---- */
    var gateResolve = null;
    function askGate(opts) {
      return new Promise(function (resolve) {
        gateResolve = resolve;
        $("gate-title").textContent = opts.title;
        $("gate-text").textContent = opts.text;
        var rl = $("gate-reason-label");
        var rb = $("gate-reason");
        rb.value = "";
        rl.style.display = opts.requireReason ? "block" : "none";
        rb.style.display = opts.requireReason ? "block" : "none";
        $("gate-override-btn").hidden = !opts.allowOverride;
        $("gate-backdrop").classList.add("visible");
        if (opts.requireReason) rb.focus();
      });
    }
    function closeGate(result) {
      $("gate-backdrop").classList.remove("visible");
      if (gateResolve) { var r = gateResolve; gateResolve = null; r(result); }
    }
    $("gate-cancel").onclick = function () { closeGate(null); };
    $("gate-override-btn").onclick = function () { closeGate({ override: true }); };
    $("gate-confirm").onclick = function () {
      var rb = $("gate-reason");
      var requireReason = rb.style.display !== "none";
      var reason = rb.value.trim();
      if (requireReason && !reason) { toast("A recorded reason is required."); return; }
      closeGate({ reason: reason });
    };

    /* ---- actions (mutation semantics live in the kernel) ---- */
    $("advance-btn").onclick = async function () {
      if (!activeProjectId) return;
      var attempt = await adapter.advance(activeProjectId, null);
      if (!attempt.ok && attempt.reason === "gate") {
        var res = await askGate({
          title: attempt.gate.title, text: attempt.gate.text, requireReason: false,
          allowOverride: !!hooks.onGateOverride
        });
        if (!res) return; // not yet — nothing advances
        if (res.override) {
          // P4-UI1: ceremony, record, and stage move all live behind the
          // seam (UI1-K1: kernel advance {override:true} is atomic). A null
          // rec means cancelled — nothing was recorded, nothing advanced.
          var rec = await hooks.onGateOverride(activeProjectId, attempt.project.stage);
          if (!rec) return;
          var fresh = await adapter.freshen(activeProjectId);
          renderProjectList();
          if (fresh) renderDetail(fresh);
          toast("Gate overridden — on the record.");
          return;
        }
        attempt = await adapter.advance(activeProjectId, { gatePassed: true, reason: res.reason });
      }
      if (attempt.ok) {
        renderProjectList(); renderDetail(attempt.project);
        toast('Advanced to "' + STAGES[attempt.project.stage] + '"');
      } else if (attempt.reason === "complete") {
        renderProjectList(); renderDetail(attempt.project);
      }
    };

    $("stepback-btn").onclick = async function () {
      if (!activeProjectId) return;
      var p = adapter.getProject(activeProjectId);
      if (!p || p.stage === 0) { if (p) renderDetail(p); return; }
      var res = await askGate({
        title: "Step back a stage",
        text: 'Return "' + p.name + '" from "' + STAGES[p.stage] + '" to "' + STAGES[p.stage - 1] + '". A reversal is a decision — it goes on the record (Rule 7).',
        requireReason: true
      });
      if (!res) return;
      var out = await adapter.stepBack(activeProjectId, res.reason);
      if (out.ok) {
        renderProjectList(); renderDetail(out.project);
        toast('Stepped back to "' + STAGES[out.project.stage] + '"');
      }
    };

    $("save-notes").onclick = async function () {
      if (!activeProjectId) return;
      try {
        await adapter.saveNotes(activeProjectId, $("notes-box").value);
        toast("Notes saved.");
      } catch (e) { toast("Save failed — try again."); }
    };

    $("delete-project").onclick = async function () {
      var id = activeProjectId;
      if (!id) return;
      var p = adapter.getProject(id);
      var res = await askGate({
        title: "Strike from the floor",
        text: 'Remove "' + (p ? p.name : "this project") + '" for everyone on the floor. This can\'t be undone.',
        requireReason: false
      });
      if (!res) return;
      activeProjectId = null;
      hooks.onProjectSelect && hooks.onProjectSelect(null);
      $("forge-detail").classList.remove("visible");
      try { await adapter.deleteProject(id); }
      catch (e) { toast("Delete may not have synced — reload the floor."); }
      renderProjectList();
      onStageChange(null);
      toast("Struck from the floor.");
    };

    /* ---- new project modal ---- */
    var backdrop = $("modal-backdrop");
    $("start-forging").onclick = function () {
      $("in-forgername").value = myName;
      backdrop.classList.add("visible");
    };
    $("modal-cancel").onclick = function () { backdrop.classList.remove("visible"); };
    $("modal-confirm").onclick = async function () {
      var name = $("in-forgername").value.trim();
      var pname = $("in-projectname").value.trim();
      var ptype = $("in-type").value;
      if (!name || !pname) { toast("Name and project both needed to forge."); return; }
      myName = name;
      await adapter.saveProfile(name);
      hooks.onActorChange && hooks.onActorChange(name);
      try {
        var proj = await adapter.createProject({ name: pname, type: ptype });
        activeProjectId = proj.id;
        backdrop.classList.remove("visible");
        renderProjectList(); renderDetail(proj);
        $("forge-detail").classList.add("visible");
        toast('"' + pname + '" is on the floor.');
      } catch (e) { toast("Save failed — the floor may be out of sync."); }
    };

    /* ---- public handle ---- */
    return {
      refresh: async function () {
        await adapter.loadProjects();
        renderProjectList();
        if (activeProjectId) {
          var p = adapter.getProject(activeProjectId);
          if (p) renderDetail(p);
          else { activeProjectId = null; $("forge-detail").classList.remove("visible"); onStageChange(null); }
        }
      },
      setActor: function (name) { myName = name; },
      hideDetail: function () { $("forge-detail").classList.remove("visible"); },
      hasActive: function () { return !!activeProjectId; }
    };
  }

  return { mount: mount };
});
