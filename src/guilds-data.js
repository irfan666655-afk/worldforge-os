/*!
 * guilds-data.js — WorldForge OS P4 (UMD)
 * GENERATED DATA carried verbatim from monolith block 01 lines 1-72.
 * GUILDS is generated from agent-roster.v5.2.json by gen_guilds.py —
 * do not edit by hand; edit the canonical roster and regenerate.
 * lint_worldforge.py enforces consistency.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.Data = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";
const GUILDS = [
  { key:'core', name:'Core Production', color:0xc1652b, radius:5.0, tilt:0.05, agents:[
    {name:'Creative Director', resp:'Narrow tie-breaker across all Guilds; final call only when two leads genuinely conflict.', auth:'Final say on conflicts only — does not pre-empt domain leads.', esc:'None (top of the chain).', mem:'decisionRecords'},
    {name:'Screenwriter / Story Lead', resp:'Stages 1–2: Film Bible, beats, causality, want/need, arcs.', auth:'Owns story/theme.', esc:'Creative Director on theme conflicts.', mem:'Project Memory'},
    {name:'Cinematographer', resp:'Stage 3: camera, lens, lighting, color, blocking, depth; asset-fingerprint sign-off on visual canon.', auth:'Owns visual language.', esc:'Creative Director on doctrine conflicts.', mem:'Asset fingerprint records'},
    {name:'Producer', resp:'Stage 4 + Budget Guild oversight; feasibility sanity-check at Stage 1.', auth:'Owns scope/budget gating.', esc:'Creative Director on scope-vs-ambition conflicts.', mem:'Budget ledger, validationLedger'},
    {name:'Model Router', resp:'Stage 5: picks model per shot, runs test generations, watches deprecation.', auth:'Owns model selection.', esc:'Cinematographer if routing compromises visual doctrine.', mem:'model-router.md, decision records'},
    {name:'QA / Continuity Supervisor', resp:'Stage 8: validation, targeted repair, fingerprint diffing against canon.', auth:'Owns validation gate.', esc:'Producer if a failure is Film-Bible-level.', mem:'validationLedger'},
  ]},
  { key:'crosscut', name:'Cross-Cutting Guilds', color:0xc1652b, radius:6.2, tilt:0.6, agents:[
    {name:'Budget Guild Lead', resp:'Running cost ledger, per-shot estimation, reconciling estimate vs. actual.', auth:'Owns the number behind Rule 3\'s gate.', esc:'Producer on go/no-go.', mem:'Budget ledger in validationLedger'},
    {name:'Asset Librarian', resp:'Studio-level memory: promotion/demotion between Project Memory and the Asset Library.', auth:'Owns promotion criteria, not the promotion decision itself.', esc:'Creative Director on any promotion (never silent, per Rule 12).', mem:'assets/asset-library-schema.json'},
    {name:'Brand Guardian', resp:'Cross-Guild consistency watchdog against locked brand doctrine, regardless of producing Guild.', auth:'Can block release, cannot override doctrine itself.', esc:'Brand & Identity Guild Lead on doctrine ambiguity.', mem:'Asset Library doctrine object'},
  ]},
  { key:'creative-plus', name:'Creative+ Guilds', color:0xf2c879, radius:7.4, tilt:1.15, agents:[
    {name:'Film Director', resp:'Scene-level directing beneath macro story — blocking intent, performance beats within a scene.', auth:'Owns in-scene interpretation.', esc:'Screenwriter on story-level conflicts.', mem:'Project Memory'},
    {name:'Storyboard Artist', resp:'Cheap-draft visual sequencing before Stage 4.5 simulation.', auth:'Owns draft sequencing.', esc:'Cinematographer on visual-doctrine conflicts.', mem:'Project Memory'},
    {name:'Environment Designer', resp:'Locks environment appearance once, early.', auth:'Owns environment canon.', esc:'Cinematographer.', mem:'Asset fingerprint records'},
    {name:'Character Designer', resp:'Locks character appearance once, early.', auth:'Owns character canon.', esc:'Cinematographer / Screenwriter.', mem:'Asset fingerprint records'},
    {name:'Graphic Designer', resp:'Print, packaging, static visual deliverables.', auth:'Owns execution within locked doctrine.', esc:'Brand & Identity Guild Lead on doctrine questions.', mem:'Asset Library'},
    {name:'Motion Designer', resp:'Titles, lower-thirds, kinetic type, transitions.', auth:'Owns motion execution.', esc:'Cinematographer on visual-doctrine fit.', mem:'Project Memory'},
    {name:'Thumbnail Intelligence Agent', resp:'Designs and tests thumbnail/cover options against genre and platform conventions.', auth:'Owns thumbnail proposals.', esc:'Marketing Director on platform strategy conflicts.', mem:'Project Memory'},
    {name:'Music Composer', resp:'Score/music direction consistent with Film Bible tone.', auth:'Owns musical doctrine.', esc:'Creative Director on tone conflicts.', mem:'Project Memory'},
    {name:'Sound Designer', resp:'Diegetic/ambient sound design, distinct from dialogue.', auth:'Owns sound palette.', esc:'Cinematographer on scene-fit.', mem:'Project Memory'},
    {name:'Voice Director', resp:'Dialogue/VO direction, casting-equivalent decisions for AI voice.', auth:'Owns voice casting.', esc:'Screenwriter on character-voice fit.', mem:'Project Memory'},
    {name:'Game Design Lead', resp:'Mechanics, systems, playable-sim design when the project is a game.', auth:'Owns game systems design.', esc:'Creative Director on narrative-vs-mechanics conflicts.', mem:'Project Memory (game variant)'},
  ]},
  { key:'marketing', name:'Marketing & Growth', color:0xf2c879, radius:8.4, tilt:-0.7, agents:[
    {name:'Marketing Director', resp:'Owns overall marketing strategy for a deliverable/launch.', auth:'Owns channel strategy.', esc:'Creative Director on brand-tone conflicts.', mem:'Asset Library doctrine'},
    {name:'Social Media Manager', resp:'Platform-specific content adaptation and posting cadence.', auth:'Owns platform execution.', esc:'Marketing Director.', mem:'Project Memory'},
    {name:'SEO Specialist', resp:'Discoverability — metadata, titles, on-page/on-platform optimization.', auth:'Owns SEO tactics.', esc:'Marketing Director.', mem:'Project Memory'},
    {name:'Growth Strategist', resp:'Funnel/retention/distribution strategy beyond a single launch.', auth:'Owns growth tactics.', esc:'Marketing Director on strategy conflicts.', mem:'Analytics data'},
    {name:'Launch Manager', resp:'Coordinates a launch across every Guild that touches it.', auth:'Owns launch sequencing.', esc:'Producer on scope/timeline conflicts.', mem:'validationLedger'},
    {name:'Community Manager', resp:'Ongoing audience relationship management post-launch.', auth:'Owns community tactics.', esc:'Marketing Director.', mem:'Project Memory'},
    {name:'Analytics Agent', resp:'Defines what to track and reports back findings.', auth:'Owns measurement methodology.', esc:'Growth Strategist on what to prioritize.', mem:'Feeds Lab lessons-learned'},
  ]},
  { key:'web3d', name:'Web/Interactive, UI & 3D Studio', color:0xf2c879, radius:6.7, tilt:1.9, agents:[
    {name:'Website Architect', resp:'Site structure, information architecture, page-level continuity.', auth:'Owns structural decisions.', esc:'Brand & Identity Guild Lead on doctrine fit.', mem:'Project Memory'},
    {name:'UI Designer', resp:'Interface-level design system, components, interaction patterns.', auth:'Owns UI execution.', esc:'Website Architect.', mem:'Asset Library (if promoted)'},
    {name:'3D Engineer', resp:'Three.js / React / Spline pipeline — 3D web builds, interactive scenes.', auth:'Owns technical feasibility calls for 3D web.', esc:'Website Architect on scope and doctrine fit.', mem:'Project Memory'},
  ]},
  { key:'bizops', name:'Business Operations', color:0x8a94a6, radius:7.7, tilt:-1.4, agents:[
    {name:'Business Operations Lead', resp:'Studio-level operational concerns — process, not creative content.', auth:'Owns process, not creative calls.', esc:'Creative Director if process conflicts with creative discipline.', mem:'Asset Library lessons-learned'},
    {name:'Client Manager', resp:'Client-facing communication and expectation-setting.', auth:'Owns client relationship framing.', esc:'Producer on scope commitments made to a client.', mem:'Project Memory'},
    {name:'Knowledge Librarian', resp:'Studio SOPs — process documentation, distinct from creative canon.', auth:'Owns documentation structure.', esc:'Business Operations Lead.', mem:'Separate store — process knowledge, not creative canon'},
    {name:'Plugin/Integration Engineer', resp:'External API integration, plugin architecture.', auth:'Owns technical integration decisions.', esc:'Business Operations Lead on overlap disputes.', mem:'asset-library-schema.json integrations object'},
  ]},
  { key:'research', name:'Research & Automation Lab', color:0x8a94a6, radius:5.7, tilt:-2.3, agents:[
    {name:'Research Agent', resp:'Verifies claims about model capability or market landscape before they\'re assumed elsewhere.', auth:'Owns fact-finding, not the decision made from it.', esc:'Business Operations Lead on disputed findings; Model Router advisory on model-capability questions. Findings return to the requester as output, not escalation.', mem:'Feeds Asset Library lessons-learned'},
    {name:'Automation Engineer', resp:'Identifies and removes repetitive manual work across Guilds.', auth:'Owns automation implementation, not process changes affecting creative discipline.', esc:'Business Operations Lead.', mem:'N/A'},
    {name:'Innovation Lab Lead', resp:'3–5 year horizon thinking, modular-architecture proposals.', auth:'Owns exploration, never implementation authority.', esc:'Creative Director before anything speculative gets adopted.', mem:'architectural-principles.md'},
    {name:'Prompt Engineer', resp:'Stage 6: turns a locked UFDM shot into a model-specific prompt.', auth:'Owns compilation technique.', esc:'Model Router on capability-vs-compilation mismatch; Producer if unresolved.', mem:'prompt-compiler.md'},
    {name:'Asset Manager', resp:'Day-to-day within-project asset handling (fingerprinting, locking).', auth:'Owns within-project asset discipline.', esc:'Asset Librarian on cross-project promotion.', mem:'Asset fingerprint records (project-level)'},
  ]},
  { key:'brand', name:'Brand & Identity Guild', color:0xc1652b, radius:9.2, tilt:0.35, agents:[
    {name:'Brand & Identity Guild Lead', resp:'Owns brand doctrine — the color/type/tone canon in the Asset Library doctrine object — and its interpretation when a deliverable is ambiguous against it.', auth:'Owns brand doctrine and doctrine interpretation; cannot override locked project-level creative canon.', esc:'Creative Director on doctrine conflicts.', mem:'Asset Library doctrine object'},
  ]},
];

const STAGES = [
  'Ideation → Film Bible','Story & Character','Cinematography Design','Production Planning',
  'Scene Simulation','Model Routing & Budget Check','Prompt Compilation',
  'Model-Specific Generation','Validation & Repair','Learning'
];

  return { GUILDS: GUILDS, STAGES: STAGES };
});
