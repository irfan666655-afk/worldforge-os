/*!
 * vendor-loader.js — WorldForge OS P4 (UMD)
 * Loads Three.js r128 from CDN with timeout; on failure fires the same
 * degradation path as WebGL-unavailable. One fallback, two triggers.
 * WebGL probe is deliberately Three-free (bare canvas.getContext) so it
 * works when the CDN never loaded.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.VendorLoader = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";

  var THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  var TIMEOUT_MS = 8000;
  var _threePromise = null;

  function loadThree(opts) {
    opts = opts || {};
    var url = opts.url || THREE_CDN;
    var timeout = opts.timeout || TIMEOUT_MS;
    if (_threePromise) return _threePromise; // idempotent
    if (typeof window !== "undefined" && window.THREE)
      return (_threePromise = Promise.resolve(window.THREE));

    _threePromise = new Promise(function (resolve) {
      var s = document.createElement("script");
      var settled = false;
      var timer = setTimeout(function () { settle(null, "timeout"); }, timeout);
      function settle(val, reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!val) {
          s.remove();
          document.dispatchEvent(new CustomEvent("wf:vendor-fallback", {
            detail: { vendor: "three", reason: reason }
          }));
        }
        resolve(val);
      }
      s.src = url;
      s.async = true; // never block rendering
      s.onload = function () { settle(window.THREE || null, "loaded-but-missing-global"); };
      s.onerror = function () { settle(null, "network"); };
      document.head.appendChild(s);
    });
    return _threePromise;
  }

  function webglAvailable() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) {
      return false;
    }
  }

  return { loadThree: loadThree, webglAvailable: webglAvailable };
});
