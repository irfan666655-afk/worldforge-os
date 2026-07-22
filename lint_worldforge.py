#!/usr/bin/env python3
"""
lint_worldforge.py — governance-as-code for COS / WorldForge v5.1

Turns three of the system's own written rules into executable checks:

  1. Rule 13 (escalation): every agent's escalation path must resolve,
     in at most two hops, to an authority role (a Guild lead, Creative
     Director, or Producer) — never sideways, never to a non-role.
  2. The v5.1 class-2 bug ("referenced but undefined"): every escalation
     target must be a defined roster agent or a declared external role.
  3. Schema hygiene for assets/asset-library-schema.json: fields pinned
     with `const` but absent from `required` (a promotion without
     `promotedBy` currently validates), unvalidated semver, and basic
     JSON Schema compilability.

Plus a drift check: extracts the hand-copied GUILDS array embedded in
each HTML visualizer and diffs its escalation/authority text against the
canonical roster JSON — the check that would have caught the foundry
visualizer still shipping the pre-v5.1 sideways escalation.

Usage:
  python3 lint_worldforge.py --roster agent-roster.v5.1.json \
      --schema asset-library-schema.json \
      --html foundry-visualizer.html worldforge-os.html
Exit code 1 if any ERROR-level finding.
"""

import argparse, json, re, sys

ERR, WARN, OK = "ERROR", "WARN", "ok"
findings = []

def report(level, area, msg):
    findings.append((level, area, msg))

# ==================================================================== M2
# PROMOTION_RULES — canonical promotion-rule table (single source of truth)
#
# gen_rules.py imports this symbol and compiles it to rules.v1.json for the
# JS evaluator in wfkernel-p2-ext (DSL lockstep: predicates here must exist
# in the ext's PREDICATES map). The linter itself consumes this table in
# lint_promotions() below — the table is ACTIVE here, not just exported.
#
# Row shape (frozen for gen_rules._adapt_linter_rule):
#   id, doctrine, predicate, params, severity ('error'|'warn'), message, tags
#
# RECONCILE(lint-src) — RESOLVED 2026-07-18: real linter source verified to
# claim no prior rule IDs; GOV-1..3 / SCHEMA-1..2 land here as canonical,
# red-team candidates GOV-4..8 collide with nothing. Marker closed.
#
# Kernel alignment (verified against worldforge-kernel v1.1 / ext v1.2):
#   - ledger entry shape is FROZEN {stage_id, actor, action, cost, ts} —
#     'cost', never 'amount' (P2-integration bug class, 2026-07-17).
#   - actor: kernel tier accepts free text (ACT-1); GOV-1b checks presence
#     only. Roster-id-or-'human' enforcement stays at the export/ext tier.
#   - 'impact' is an ext-tier promotion-event field, not a stored asset
#     field: impact_gte does NOT fire when impact is absent from state-tier
#     contexts (the event tier owns that check).
# ====================================================================
PROMOTION_RULES = [
    {
        "id": "GOV-1",
        "doctrine": "Rule 12 / Rule 7",
        "predicate": "missing_field",
        "params": {"path": "promotion.reason"},
        "severity": "error",
        "message": "No silent promotion: a decision reason is required (Rule 12).",
        "tags": ["promotion"],
    },
    {
        "id": "GOV-1b",
        "doctrine": "Rule 7",
        "predicate": "missing_field",
        "params": {"path": "promotion.actor"},
        "severity": "error",
        "message": "Decision records require an actor (Rule 7).",
        "tags": ["promotion"],
    },
    {
        "id": "GOV-2",
        "doctrine": "Rule 7 (impact escalation)",
        "predicate": "impact_gte",
        "params": {"threshold": "high"},
        "severity": "warn",  # warn = triggers the GOV-2 approver gate, does not hard-fail
        "message": "High-impact promotion: second approver required before commit.",
        "tags": ["promotion"],
    },
    {
        "id": "GOV-3",
        "doctrine": "Rule 12 (structural)",
        "predicate": "missing_field",
        "params": {"path": "asset.fingerprint"},
        "severity": "warn",
        "message": "Asset has no recorded fingerprint; promoted asset cannot be diffed against canon (Rule 4).",
        "tags": ["promotion"],
    },
    {
        "id": "SCHEMA-1",
        "doctrine": "asset-library-schema v3.1",
        "predicate": "missing_field",
        "params": {"path": "asset.type"},
        "severity": "error",
        "message": "Asset record missing required field: type.",
        "tags": ["promotion", "schema"],
    },
    {
        "id": "SCHEMA-2",
        "doctrine": "asset-library-schema v3.1",
        "predicate": "missing_field",
        "params": {"path": "asset.name"},
        "severity": "error",
        "message": "Asset record missing required field: name.",
        "tags": ["promotion", "schema"],
    },
]

_IMPACT_ORDER = ["low", "medium", "high", "critical"]

def _ctx_get(ctx, path):
    """Resolve 'promotion.reason'-style paths; '' / None / missing → None."""
    cur = ctx
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    if cur is None or (isinstance(cur, str) and not cur.strip()):
        return None
    return cur

# Predicate implementations — MUST stay in lockstep with the JS PREDICATES
# map in wfkernel-p2-ext (gen_rules.py docstring contract).
PREDICATES = {
    "missing_field": lambda ctx, p: _ctx_get(ctx, p["path"]) is None,
    "impact_gte": lambda ctx, p: (
        _ctx_get(ctx, "promotion.impact") is not None
        and _IMPACT_ORDER.index(str(_ctx_get(ctx, "promotion.impact")).lower())
            >= _IMPACT_ORDER.index(p["threshold"])
        if str(_ctx_get(ctx, "promotion.impact") or "").lower() in _IMPACT_ORDER
        else False
    ),
    "asset_unlocked_promotion": lambda ctx, p: (
        _ctx_get(ctx, "asset.locked") is not True
        and _ctx_get(ctx, "promotion") is not None
    ),
}

def evaluate_promotion(ctx):
    """Evaluate one promotion context against PROMOTION_RULES.
    Returns list of (severity, rule_id, message). Unknown predicates
    fail closed as errors — a rule that cannot run must not silently pass."""
    out = []
    for rule in PROMOTION_RULES:
        fn = PREDICATES.get(rule["predicate"])
        if fn is None:
            out.append(("error", rule["id"],
                        f"predicate '{rule['predicate']}' not implemented — fail-closed."))
            continue
        if fn(ctx, rule["params"]):
            out.append((rule["severity"], rule["id"], rule["message"]))
    return out

def lint_promotions(instance):
    """State-tier promotion pass over a live Asset Library instance:
    reconstruct a promotion context for every promoted asset and run the
    canonical rule table over it. The ext runs the same table (via
    rules.v1.json) at event time; this is the CI-side backstop."""
    ledger = {d.get("id"): d for d in instance.get("decisionLedger", [])}
    n = 0
    def contexts():
        for section in ("characters", "environments", "uiSystems"):
            for a in instance.get(section) or []:
                if not a.get("promotedBy") and not a.get("decisionRecordId"):
                    continue  # never promoted — event tier hasn't run
                rec = ledger.get(a.get("decisionRecordId")) or {}
                yield section, a, {
                    "asset": a,
                    "promotion": {
                        "actor": a.get("promotedBy"),
                        "reason": rec.get("resolution") or rec.get("reason"),
                        "impact": rec.get("impact"),
                    },
                }
    for section, a, ctx in contexts():
        n += 1
        for severity, rule_id, message in evaluate_promotion(ctx):
            report(ERR if severity == "error" else WARN, "Promotion",
                   f"[{rule_id}] {section} '{a.get('id', '?')}': {message}")
    if n and not any(f[1] == "Promotion" and f[0] == ERR for f in findings):
        report(OK, "Promotion",
               f"{n} promoted asset(s) evaluated against PROMOTION_RULES "
               f"({len(PROMOTION_RULES)} rows): clean.")

# ---------------------------------------------------------------- Rule 13
def lint_escalation(roster):
    agents = {}
    for g in roster["guilds"]:
        for a in g["agents"]:
            agents[a["name"]] = a
    authorities = set(roster["authorityRoles"]["roles"])
    externals = {e["name"]: e["definedIn"] for e in roster["externalRoles"]["roles"]}

    # referenced-but-undefined + non-role targets
    for name, a in agents.items():
        for target in a["escalatesTo"]:
            if target in agents or target in externals:
                continue
            report(ERR, "Rule 13",
                   f"{name} escalates to '{target}', which is neither a roster agent "
                   f"nor a declared external role — indeterminate escalation target.")
    for ext, where in externals.items():
        refs = [n for n, a in agents.items() if ext in a["escalatesTo"]]
        if refs and ext not in agents:
            report(WARN, "Roster",
                   f"'{ext}' is the escalation target of {len(refs)} agents "
                   f"({', '.join(refs)}) but has no row in agent-roster.md — "
                   f"defined only in {where}. Same class of gap as the v5.1 schema bug.")

    # hop-depth: must reach an authority within 2 hops
    def min_hops_to_authority(name, depth=0, seen=None):
        seen = seen or set()
        if name in seen:
            return None  # cycle
        seen = seen | {name}
        a = agents.get(name)
        if a is None:
            return 1 if name in authorities else None
        best = None
        for target in a["escalatesTo"]:
            if target in authorities:
                cand = depth + 1
            else:
                nxt = min_hops_to_authority(target, depth + 1, seen)
                cand = nxt if nxt is not None else None
            if cand is not None and (best is None or cand < best):
                best = cand
        return best

    for name, a in agents.items():
        if name in authorities or not a["escalatesTo"]:
            continue
        hops = min_hops_to_authority(name)
        if hops is None:
            report(ERR, "Rule 13", f"{name}: no escalation path reaches any authority role.")
        elif hops > 2:
            chain = name
            report(WARN, "Rule 13",
                   f"{name}: shortest path to an authority role is {hops} hops "
                   f"(Rule 13 allows at most two). Via: {' → '.join(trace_chain(agents, authorities, name))}")

    # prose clauses that name a judgment rather than a role
    for name, a in agents.items():
        note = a.get("escalationNote", "")
        if "judgment" in note.lower() or "equivalent" in note.lower():
            report(WARN, "Rule 13",
                   f"{name}: escalation prose cites a judgment/equivalence "
                   f"('{note[:80]}…') rather than a role — not resolvable by inspection.")

def trace_chain(agents, authorities, start):
    chain, cur, seen = [start], start, set()
    while cur in agents and cur not in seen:
        seen.add(cur)
        targets = agents[cur]["escalatesTo"]
        if not targets:
            break
        # prefer a target that is a known agent or authority over an unknown string
        known = [t for t in targets if t in agents or t in authorities]
        cur = (known or targets)[0]
        chain.append(cur)
        if cur in authorities:
            break
    return chain

# ------------------------------------------------------------- schema audit
def lint_schema(schema):
    try:
        import jsonschema
        jsonschema.Draft202012Validator.check_schema(schema)
        report(OK, "Schema", "asset-library-schema compiles as valid JSON Schema draft 2020-12.")
    except ImportError:
        report(WARN, "Schema", "jsonschema not installed — compile check skipped.")
    except Exception as e:
        report(ERR, "Schema", f"schema does not compile: {e}")

    def walk(node, path):
        if isinstance(node, dict):
            props = node.get("properties")
            if isinstance(props, dict):
                required = set(node.get("required", []))
                for pname, pdef in props.items():
                    if isinstance(pdef, dict) and "const" in pdef and pname not in required:
                        report(ERR, "Schema",
                               f"{path}.{pname} is pinned with const "
                               f"('{pdef['const']}') but not in `required` — an object "
                               f"omitting it validates, defeating the pin. "
                               f"(e.g. a promotion with no promotedBy passes.)")
            for k, v in node.items():
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
    walk(schema, "$")

    lv = schema.get("properties", {}).get("libraryVersion", {})
    if lv and "pattern" not in lv:
        report(WARN, "Schema",
               "libraryVersion is described as semver but has no `pattern` — "
               "'banana' is a valid library version.")

# ------------------------------------------------------- library instance
def lint_library(instance, schema):
    """Validate a live Asset Library file: schema conformance plus the
    referential-integrity guarantee JSON Schema cannot express — every
    promotedAsset.decisionRecordId must resolve into decisionLedger."""
    try:
        import jsonschema
        errors = list(jsonschema.Draft202012Validator(schema).iter_errors(instance))
        if errors:
            for e in errors[:10]:
                report(ERR, "Library", f"schema violation at {'/'.join(map(str, e.path))}: {e.message}")
        else:
            report(OK, "Library", "instance validates against asset-library schema.")
    except ImportError:
        report(WARN, "Library", "jsonschema not installed — instance validation skipped.")

    ledger_ids = {d.get("id") for d in instance.get("decisionLedger", [])}
    def check_assets(assets, where):
        for a in assets or []:
            drid = a.get("decisionRecordId")
            if drid and drid not in ledger_ids:
                report(ERR, "Library",
                       f"{where} '{a.get('id','?')}' cites decisionRecordId '{drid}' "
                       f"with no matching decisionLedger entry — an untraceable promotion (Rule 12).")
    check_assets(instance.get("characters"), "characters")
    check_assets(instance.get("environments"), "environments")
    check_assets(instance.get("uiSystems"), "uiSystems")
    check_assets((instance.get("doctrine") or {}).get("voiceCanon"), "doctrine.voiceCanon")
    if not any(f[0] == ERR and f[1] == "Library" for f in findings):
        report(OK, "Library", f"referential integrity holds: {len(ledger_ids)} ledger record(s), all asset citations resolve.")

# ---------------------------------------------------------------- drift check
def extract_guilds_from_html(path):
    """Extract the embedded GUILDS array by evaluating it with Node —
    robust to apostrophes, escapes, and formatting, unlike regex-to-JSON."""
    import subprocess, tempfile, os
    src = open(path, encoding="utf-8", errors="replace").read()
    marker = "const GUILDS = ["
    i = src.find(marker)
    if i < 0:
        report(WARN, "Drift", f"{path}: no embedded GUILDS block found — nothing to diff.")
        return None
    # balanced-bracket scan from the opening '[' (skipping string literals)
    j = i + len(marker) - 1
    depth, k, in_str, esc = 0, j, None, False
    while k < len(src):
        ch = src[k]
        if in_str:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == in_str: in_str = None
        else:
            if ch in ("'", '"', "`"): in_str = ch
            elif ch == "[": depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0: break
        k += 1
    block = src[i:k+1]
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(block + ";\nconsole.log(JSON.stringify(GUILDS));\n")
        tmp = f.name
    try:
        out = subprocess.run(["node", tmp], capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            report(WARN, "Drift", f"{path}: embedded GUILDS did not evaluate ({out.stderr.strip()[:120]}); manual diff needed.")
            return None
        return json.loads(out.stdout)
    finally:
        os.unlink(tmp)

def lint_drift(roster, html_paths):
    canon = {}
    for g in roster["guilds"]:
        for a in g["agents"]:
            canon[normalize(a["name"])] = a
    for path in html_paths:
        data = extract_guilds_from_html(path)
        if data is None:
            continue
        n_drift = 0
        for g in data:
            for a in g.get("agents", []):
                key = normalize(a["name"])
                c = canon.get(key)
                if c is None:
                    report(WARN, "Drift", f"{path}: agent '{a['name']}' not in canonical roster (renamed or stale).")
                    n_drift += 1
                    continue
                emb_esc = a.get("esc", "")
                canon_targets = c["escalatesTo"]
                stale = [t for t in extract_role_mentions(emb_esc, roster)
                         if t not in canon_targets]
                # a mention of the escalating agent's own name is not a target
                stale = [t for t in stale if normalize(t) != key]
                if stale:
                    report(ERR, "Drift",
                           f"{path}: '{a['name']}' escalation text names {stale} — "
                           f"canon (v5.1) says {canon_targets or ['(top of chain)']}. "
                           f"Embedded copy contradicts current doctrine.")
                    n_drift += 1
        if n_drift == 0:
            report(OK, "Drift", f"{path}: embedded roster consistent with canon.")

def normalize(name):
    n = name.lower().replace("agent", "").strip()
    return re.sub(r"\s+", " ", n)

def extract_role_mentions(text, roster):
    """Return canonical roster names mentioned in prose; short aliases
    ('Screenwriter') resolve to the full roster name ('Screenwriter / Story Lead')."""
    alias_to_canon = {}
    for g in roster["guilds"]:
        for a in g["agents"]:
            alias_to_canon[a["name"]] = a["name"]
            for part in a["name"].split(" / "):
                alias_to_canon.setdefault(part.strip(), a["name"])
    for e in roster["externalRoles"]["roles"]:
        alias_to_canon[e["name"]] = e["name"]
    hits, consumed = set(), text
    for alias in sorted(alias_to_canon, key=len, reverse=True):
        if alias in consumed:
            hits.add(alias_to_canon[alias])
            consumed = consumed.replace(alias, "\u0000" * len(alias))
    return sorted(hits)

# ------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", required=True)
    ap.add_argument("--schema")
    ap.add_argument("--library", help="live asset-library instance to validate (requires --schema)")
    ap.add_argument("--html", nargs="*", default=[])
    args = ap.parse_args()

    roster = json.load(open(args.roster))
    lint_escalation(roster)
    if args.schema:
        schema = json.load(open(args.schema))
        lint_schema(schema)
        if args.library:
            instance = json.load(open(args.library))
            lint_library(instance, schema)
            lint_promotions(instance)
    if args.html:
        lint_drift(roster, args.html)

    width = max(len(a) for _, a, _ in findings) if findings else 0
    n_err = sum(1 for l, _, _ in findings if l == ERR)
    n_warn = sum(1 for l, _, _ in findings if l == WARN)
    for level, area, msg in findings:
        print(f"[{level:5}] {area:<{width}}  {msg}")
    print(f"\n{n_err} error(s), {n_warn} warning(s).")
    sys.exit(1 if n_err else 0)

if __name__ == "__main__":
    main()
