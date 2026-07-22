/*!
 * kernel-adapter.js — WorldForge OS P4 (UMD)
 * The ONLY module allowed to touch window.WFKernel. Modularization is not
 * "move code into files" — it is "reduce global access to exactly one seam."
 * build.mjs --gate enforces this mechanically.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF, null);
  } else {
    root.WF.KernelAdapter = factory(root.WF, root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF, browserRoot) {
  "use strict";

  function create(config) {
    var kernelNS = browserRoot ? browserRoot.WFKernel : (config && config.kernelNS);
    if (!kernelNS || typeof kernelNS.createKernel !== "function")
      throw new Error("WFKernel not loaded — check bootstrap order (kernel script must precede bundle)");

    var kernel = kernelNS.createKernel({
      storage: config.storage,
      pipeline: config.pipeline,
      actor: config.actor
    });

    return {
      version: kernel.version,
      stages: kernel.stages,
      gateFor: function (i) { return kernel.gateFor(i); },
      loadProjects: function () { return kernel.loadProjects(); },
      getProjects: function () { return kernel.getProjects(); },
      getProject: function (id) { return kernel.getProject(id); },
      freshen: function (id) { return kernel.freshen(id); },
      loadProfile: function () { return kernel.loadProfile(); },
      saveProfile: function (n) { return kernel.saveProfile(n); },
      createProject: function (f) { return kernel.createProject(f); },
      advance: function (id, g) { return kernel.advance(id, g); },
      stepBack: function (id, r) { return kernel.stepBack(id, r); },
      saveNotes: function (id, t) { return kernel.saveNotes(id, t); },
      deleteProject: function (id) { return kernel.deleteProject(id); },
      subscribe: function (fn) { return kernel.subscribe(fn); },
      // P2 extension installs on the raw kernel INSIDE the adapter seam;
      // callers receive the extended instance for P2 component contracts
      // (components take a kernel instance — no global access involved).
      installP2: function (P2ExtNS, opts) {
        P2ExtNS.install(kernel, opts);
        return kernel;
      },
      bindProject: function (id) { if (kernel.bindProject) kernel.bindProject(id); }
    };
  }

  return { create: create };
});
