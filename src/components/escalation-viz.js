/*!
 * components/escalation-viz.js — WorldForge OS P4 (UMD)
 * The 3D explore + forge scene, carried verbatim from monolith block 01
 * lines 73-257 and wrapped in a mount factory. Deps (vendor-loader's THREE,
 * guilds data) are INJECTED — this module never probes capabilities and
 * never loads Three itself (app.js is the sole mode-decider).
 *
 * Contract: WF.EscalationViz.mount(stageEl, THREE, { GUILDS, STAGES })
 *   -> { setMode(mode), updateStationColors(idx|null), destroy() }
 * DOM it touches beyond stageEl: agent panel ids (ap-*), #agent-panel,
 * #agent-close — same as legacy.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.EscalationViz = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";

  function mount(stageEl, THREE, data) {
    var GUILDS = data.GUILDS, STAGES = data.STAGES;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0a0d, 0.026);

    var camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 4, 23);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    stageEl.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x33394a, 1.1));
    var key = new THREE.PointLight(0xc1652b, 2.2, 45);
    scene.add(key);
    var rim = new THREE.PointLight(0xf2c879, 0.8, 60);
    rim.position.set(-10, 12, -10);
    scene.add(rim);

    var starGeo = new THREE.BufferGeometry();
    var starCount = 800;
    var starPos = new Float32Array(starCount * 3);
    for (var si = 0; si < starCount; si++) {
      var r = 40 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      starPos[si * 3] = r * Math.sin(ph) * Math.cos(th); starPos[si * 3 + 1] = r * Math.sin(ph) * Math.sin(th); starPos[si * 3 + 2] = r * Math.cos(ph);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x39404e, size: 0.06 })));

    /* ---- EXPLORE group ---- */
    var exploreGroup = new THREE.Group();
    scene.add(exploreGroup);
    var core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2), new THREE.MeshStandardMaterial({ color: 0xc1652b, emissive: 0xc1652b, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.4 }));
    exploreGroup.add(core);
    var coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.32, 1), new THREE.MeshBasicMaterial({ color: 0xc1652b, wireframe: true, transparent: true, opacity: 0.25 }));
    exploreGroup.add(coreWire);

    var clickableAgents = [];
    GUILDS.forEach(function (guild) {
      var ringGroup = new THREE.Group();
      ringGroup.rotation.x = guild.tilt; ringGroup.rotation.y = guild.tilt * 0.6;
      exploreGroup.add(ringGroup);
      var curve = new THREE.EllipseCurve(0, 0, guild.radius, guild.radius, 0, Math.PI * 2, false, 0);
      var pts = curve.getPoints(96).map(function (p) { return new THREE.Vector3(p.x, 0, p.y); });
      ringGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: guild.color, transparent: true, opacity: 0.28 })));
      var n = guild.agents.length;
      guild.agents.forEach(function (agent, i) {
        var angle = (i / n) * Math.PI * 2, x = Math.cos(angle) * guild.radius, z = Math.sin(angle) * guild.radius;
        var node = new THREE.Mesh(new THREE.SphereGeometry(guild.key === "core" ? 0.2 : 0.14, 20, 20), new THREE.MeshStandardMaterial({ color: guild.color, emissive: guild.color, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 }));
        node.position.set(x, 0, z);
        node.userData = { guildName: guild.name, agent: agent };
        ringGroup.add(node);
        clickableAgents.push(node);
        var spokeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 0, z)]);
        ringGroup.add(new THREE.Line(spokeGeo, new THREE.LineBasicMaterial({ color: guild.color, transparent: true, opacity: 0.1 })));
      });
    });

    /* ---- FORGE group: spiral stage rail + project markers ---- */
    var forgeGroup = new THREE.Group();
    forgeGroup.visible = false;
    scene.add(forgeGroup);

    var stationPositions = [];
    var stationCount = STAGES.length;
    for (var i = 0; i < stationCount; i++) {
      var t2 = i / (stationCount - 1);
      var angle2 = t2 * Math.PI * 2.4;
      var radius2 = 3.5 + t2 * 4.2;
      var y2 = -3 + t2 * 6;
      stationPositions.push(new THREE.Vector3(Math.cos(angle2) * radius2, y2, Math.sin(angle2) * radius2));
    }
    var railCurve = new THREE.CatmullRomCurve3(stationPositions);
    forgeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve, 200, 0.035, 8, false), new THREE.MeshBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.5 })));

    var stationMeshes = stationPositions.map(function (pos) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 20), new THREE.MeshStandardMaterial({ color: 0x4a5568, emissive: 0x4a5568, emissiveIntensity: 0.3, roughness: 0.5 }));
      m.position.copy(pos);
      forgeGroup.add(m);
      return m;
    });

    var marker = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), new THREE.MeshStandardMaterial({ color: 0xf2c879, emissive: 0xf2c879, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.5 }));
    marker.visible = false;
    forgeGroup.add(marker);
    var markerGlow = new THREE.PointLight(0xf2c879, 0, 8);
    forgeGroup.add(markerGlow);

    function updateStationColors(currentStageIdx) {
      stationMeshes.forEach(function (m, idx) {
        var done = currentStageIdx !== null && idx <= currentStageIdx;
        var c = done ? 0xc1652b : 0x4a5568;
        m.material.color.setHex(c); m.material.emissive.setHex(c);
        m.material.emissiveIntensity = done ? 0.7 : 0.3;
      });
      if (currentStageIdx !== null) {
        marker.visible = true; markerGlow.intensity = 1.6;
        marker.position.copy(stationPositions[currentStageIdx]);
        markerGlow.position.copy(stationPositions[currentStageIdx]);
      } else {
        marker.visible = false; markerGlow.intensity = 0;
      }
    }
    updateStationColors(null);

    /* ---- camera drag-orbit ---- */
    var isDragging = false, prevX = 0, prevY = 0, dragDist = 0, rotY = 0.4, rotX = 0.15, autoRotate = true;
    var currentMode = "explore";

    function onPointerDown(e) { isDragging = true; dragDist = 0; prevX = e.clientX; prevY = e.clientY; stageEl.classList.add("dragging"); autoRotate = false; }
    function onPointerMove(e) {
      if (!isDragging) return;
      var dx = e.clientX - prevX, dy = e.clientY - prevY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      rotY += dx * 0.005; rotX += dy * 0.003; rotX = Math.max(-1.1, Math.min(1.1, rotX));
      prevX = e.clientX; prevY = e.clientY;
    }
    function onPointerUp(e) {
      isDragging = false; stageEl.classList.remove("dragging");
      if (dragDist < 5) handleClick(e);
    }
    function onWheel(e) { e.preventDefault(); camera.position.z += e.deltaY * 0.01; camera.position.z = Math.max(8, Math.min(40, camera.position.z)); }
    function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }

    stageEl.addEventListener("pointerdown", onPointerDown);
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    stageEl.addEventListener("wheel", onWheel, { passive: false });
    addEventListener("resize", onResize);

    /* ---- raycaster + agent panel ---- */
    var raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    function handleClick(e) {
      if (currentMode !== "explore") return;
      pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = -(e.clientY / innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(clickableAgents);
      if (hits.length) openAgentPanel(hits[0].object.userData);
    }

    var selectedAgentNode = null;
    function openAgentPanel(data2) {
      if (selectedAgentNode) selectedAgentNode.scale.setScalar(1);
      selectedAgentNode = clickableAgents.find(function (nd) { return nd.userData.agent === data2.agent; });
      if (selectedAgentNode) selectedAgentNode.scale.setScalar(1.8);
      document.getElementById("ap-guild").textContent = data2.guildName;
      document.getElementById("ap-name").textContent = data2.agent.name;
      document.getElementById("ap-resp").textContent = data2.agent.resp;
      document.getElementById("ap-auth").textContent = data2.agent.auth;
      document.getElementById("ap-esc").textContent = data2.agent.esc;
      document.getElementById("ap-mem").textContent = data2.agent.mem;
      document.getElementById("agent-panel").classList.add("open");
      document.getElementById("agent-close").style.display = "block";
    }
    function onAgentClose() {
      document.getElementById("agent-panel").classList.remove("open");
      document.getElementById("agent-close").style.display = "none";
      if (selectedAgentNode) { selectedAgentNode.scale.setScalar(1); selectedAgentNode = null; }
    }
    document.getElementById("agent-close").onclick = onAgentClose;

    /* ---- animate loop ---- */
    var t = 0, rafId = 0, destroyed = false;
    function animate() {
      if (destroyed) return;
      rafId = requestAnimationFrame(animate);
      t += 0.01;
      if (autoRotate) rotY += 0.0009;
      var activeGroup = currentMode === "explore" ? exploreGroup : forgeGroup;
      activeGroup.rotation.y = rotY; activeGroup.rotation.x = rotX;
      core.rotation.y += 0.004; core.rotation.x += 0.002; coreWire.rotation.y -= 0.002;
      var pulse = 0.85 + Math.sin(t * 1.6) * 0.15;
      core.material.emissiveIntensity = 0.9 * pulse;
      key.intensity = 2.0 + Math.sin(t * 1.6) * 0.3;
      if (currentMode === "explore") {
        clickableAgents.forEach(function (nd, idx) { if (nd !== selectedAgentNode) { nd.scale.setScalar(1 + Math.sin(t * 2 + idx) * 0.04); } });
      } else if (marker.visible) {
        marker.position.y += Math.sin(t * 3) * 0.002;
      }
      renderer.render(scene, camera);
    }
    animate();

    /* ---- public handle ---- */
    return {
      setMode: function (mode) {
        currentMode = mode;
        exploreGroup.visible = (mode === "explore");
        forgeGroup.visible = (mode === "forge");
        if (mode === "explore") onAgentClose();
      },
      updateStationColors: updateStationColors,
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(rafId);
        stageEl.removeEventListener("pointerdown", onPointerDown);
        removeEventListener("pointermove", onPointerMove);
        removeEventListener("pointerup", onPointerUp);
        stageEl.removeEventListener("wheel", onWheel);
        removeEventListener("resize", onResize);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  return { mount: mount };
});
