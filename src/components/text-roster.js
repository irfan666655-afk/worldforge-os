/*!
 * components/text-roster.js — WorldForge OS P4 (UMD)
 * Text-only fallback for the 3D escalation visualization. Semantic list
 * markup, roving-tabindex keyboard nav (Arrow keys move, Enter/click
 * expands escalation chain, Escape collapses), visible focus.
 * Minimal roster shape: { id, name, guild, escalates_to }.
 */
(function (root, factory) {
  "use strict";
  root.WF = root.WF || {};
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root.WF);
  } else {
    root.WF.TextRoster = factory(root.WF);
  }
})(typeof self !== "undefined" ? self : globalThis, function (WF) {
  "use strict";

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var cssEsc = function (s) {
    return (window.CSS && window.CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
  };

  // ADAPTER SEAM — maps the in-app GUILDS shape (guilds-data.js) into the
  // minimal roster. escalates_to resolved from the prose `esc` field by
  // leading name match; unmatched prose stays null (renders as terminal).
  function toMinimalRoster(guilds) {
    var flat = [];
    (guilds || []).forEach(function (g) {
      (g.agents || []).forEach(function (a) {
        flat.push({ id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: a.name, guild: g.name, escProse: a.esc || "" });
      });
    });
    var byName = {};
    flat.forEach(function (a) { byName[a.name] = a; });
    flat.forEach(function (a) {
      a.escalates_to = null;
      for (var name in byName) {
        if (name !== a.name && a.escProse.indexOf(name) === 0) { a.escalates_to = byName[name].id; break; }
      }
      delete a.escProse;
    });
    return flat;
  }

  class TextRoster {
  constructor(mount, roster) {
    this.el = mount;
    this.roster = roster;                 // minimal shape
    this.byId = new Map(roster.map(a => [a.id, a]));
    this.expanded = new Set();
  }

  escalationChain(agent) {
    const chain = [];
    let cur = agent, guard = 0;
    while (cur?.escalates_to && guard++ < 16) {       // cycle guard
      cur = this.byId.get(cur.escalates_to);
      if (!cur || chain.includes(cur)) break;
      chain.push(cur);
    }
    return chain;
  }

  mount() {
    const byGuild = {};
    for (const a of this.roster) (byGuild[a.guild] ||= []).push(a);

    this.el.innerHTML = `
      <div class="tr-note" role="note">
        3D visualization unavailable — showing text roster.
      </div>
      ${Object.entries(byGuild).map(([guild, agents]) => `
        <section class="tr-guild" aria-label="Guild: ${esc(guild)}">
          <h3>${esc(guild)}</h3>
          <ul role="list">
            ${agents.map(a => `
              <li role="listitem">
                <button class="tr-agent" data-id="${esc(a.id)}"
                        aria-expanded="false"
                        aria-label="${esc(a.name)}, ${esc(guild)} guild. Enter to show escalation path.">
                  ${esc(a.name)}
                </button>
                <div class="tr-chain" id="chain-${esc(a.id)}" hidden></div>
              </li>`).join("")}
          </ul>
        </section>`).join("")}
      <div class="tr-legend" aria-label="Legend">
        <h3>Legend</h3>
        <dl>
          <dt>Indent</dt><dd>one escalation hop</dd>
          <dt>&#8594; terminal</dt><dd>end of escalation path (no further escalation)</dd>
        </dl>
      </div>`;

    // Roving tabindex + keyboard map
    const buttons = [...this.el.querySelectorAll(".tr-agent")];
    buttons.forEach((b, i) => (b.tabIndex = i === 0 ? 0 : -1));
    this.el.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
        buttons[i].tabIndex = -1; next.tabIndex = 0; next.focus();
      }
      if (e.key === "Escape") this.collapse(document.activeElement?.dataset?.id);
    });
    this.el.addEventListener("click", (e) => {
      const b = e.target.closest(".tr-agent");
      if (b) this.toggle(b.dataset.id);
    });
    return this;
  }

  toggle(id) { this.expanded.has(id) ? this.collapse(id) : this.expand(id); }

  expand(id) {
    const a = this.byId.get(id);
    if (!a) return;
    this.expanded.add(id);
    const chain = this.escalationChain(a);
    const box = this.el.querySelector(`#chain-${cssEsc(id)}`);
    const btn = this.el.querySelector(`.tr-agent[data-id="${cssEsc(id)}"]`);
    box.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
    box.innerHTML = chain.length
      ? `<ol class="tr-esc" aria-label="Escalation path for ${esc(a.name)}">
           ${chain.map((c, d) => `
             <li style="--depth:${d + 1}">
               ${esc(c.name)} <span class="tr-g">(${esc(c.guild)})</span>
               ${d === chain.length - 1 ? '<span class="tr-term">&#8594; terminal</span>' : ""}
             </li>`).join("")}
         </ol>`
      : `<p class="tr-esc-none">No escalation — terminal agent.</p>`;
  }

  collapse(id) {
    if (!id) return;
    this.expanded.delete(id);
    const box = this.el.querySelector(`#chain-${cssEsc(id)}`);
    const btn = this.el.querySelector(`.tr-agent[data-id="${cssEsc(id)}"]`);
    if (box) { box.hidden = true; box.innerHTML = ""; }
    btn?.setAttribute("aria-expanded", "false");
  }
}

  return { TextRoster: TextRoster, toMinimalRoster: toMinimalRoster };
});
