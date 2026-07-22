#!/usr/bin/env python3
"""
gen_rules.py — WorldForge OS rules compiler (v1.1)

Compiles the PROMOTION-RELEVANT subset of lint_worldforge.py's rule table
into rules.v1.json, consumed by the JS rule evaluator in
wfkernel-p2-ext.v1.1.js. Same canonical-source discipline as gen_guilds.py:
derived artifacts are generated, never hand-edited, and carry a source
hash so CI can prove freshness.

    python gen_rules.py                 # emit rules.v1.json next to this file
    python gen_rules.py --out path.json
    python gen_rules.py --check         # CI freshness guard: exit 1 if
                                        # rules.v1.json is stale vs source

SOURCE RESOLUTION:
  `from lint_worldforge import PROMOTION_RULES` — the ONLY source. The
  linter is the single authority for promotion rules (M2, re-derived
  2026-07-18 against the verified real linter). There is no bootstrap
  fallback: if the import fails, this tool exits loudly rather than
  emitting rules from a shadow table. RECONCILE(lint-src): RESOLVED —
  symbol name and row shape verified against real lint_worldforge.py;
  no rule-ID collisions.

Predicate DSL (must stay in lockstep with PREDICATES in the JS ext):
  missing_field            params: {path}        fires if ctx path empty
  impact_gte               params: {threshold}   fires if promotion impact >= threshold
  asset_unlocked_promotion params: {}            fires if promoting an unlocked asset
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

RULES_VERSION = "1.1.0"
OUT_DEFAULT = Path(__file__).with_name("rules.v1.json")

# --------------------------------------------------------------------------
# Source resolution
# --------------------------------------------------------------------------
def _adapt_linter_rule(raw: dict) -> dict:
    """Map one lint_worldforge rule row into the DSL shape.

    Row shape verified against the real linter's PROMOTION_RULES
    (RECONCILE(lint-src) resolved 2026-07-18) — this now acts as a shape
    validator. Fail loudly on any row that cannot be mapped.
    """
    required = ("id", "predicate", "severity", "message")
    missing = [k for k in required if k not in raw]
    if missing:
        raise KeyError(
            f"lint_worldforge rule {raw.get('id', '<no id>')!r} missing keys {missing}; "
            f"update _adapt_linter_rule() to map the real row shape"
        )
    return {
        "id": raw["id"],
        "doctrine": raw.get("doctrine", raw.get("rule_ref", "")),
        "predicate": raw["predicate"],
        "params": raw.get("params", {}),
        "severity": raw["severity"],
        "message": raw["message"],
        "tags": raw.get("tags", ["promotion"]),
    }


def load_rule_table() -> tuple[list[dict], str]:
    """Return (rules, source_label). Loud exit on any failure — the linter
    is the sole authority; a missing linter means a broken workspace, not
    a reason to invent rules."""
    try:
        import lint_worldforge
    except ImportError as e:
        raise SystemExit(
            "gen_rules: FATAL — lint_worldforge.py is not importable "
            f"({e}). The linter is the sole source of PROMOTION_RULES; "
            "there is no fallback. Fix the workspace, then rerun."
        )
    table = getattr(lint_worldforge, "PROMOTION_RULES", None)
    if table is None:
        raise SystemExit(
            "gen_rules: FATAL — lint_worldforge.py imported but does not "
            "expose PROMOTION_RULES. The M2 refactor is missing from this "
            "copy of the linter; restore it before generating rules."
        )
    return [_adapt_linter_rule(r) for r in table], "lint_worldforge.py"


# --------------------------------------------------------------------------
# Compile + freshness
# --------------------------------------------------------------------------
def source_hash(rules: list[dict]) -> str:
    """Deterministic hash of the rule table (the gen_guilds drift-guard
    pattern applied to the linter seam)."""
    canon = json.dumps(rules, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def compile_doc() -> dict:
    rules, source = load_rule_table()
    known_predicates = {"missing_field", "impact_gte", "asset_unlocked_promotion"}
    unknown = sorted({r["predicate"] for r in rules} - known_predicates)
    if unknown:
        print(
            f"gen_rules: WARNING — predicates {unknown} are not implemented in the "
            f"JS evaluator; they will fail-closed at runtime. Extend PREDICATES in "
            f"wfkernel-p2-ext before shipping.",
            file=sys.stderr,
        )
    return {
        "rules_version": RULES_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "gen_rules.py",
        "source": source,
        "source_hash": source_hash(rules),
        "rules": rules,
    }


def check_freshness(out_path: Path) -> int:
    """CI freshness guard. Exit 0 fresh, 1 stale/missing, 2 bootstrap-sourced
    while the linter is importable (i.e. someone forgot to regenerate)."""
    if not out_path.exists():
        print(f"gen_rules --check: {out_path} missing — run gen_rules.py", file=sys.stderr)
        return 1
    current = json.loads(out_path.read_text(encoding="utf-8"))
    fresh = compile_doc()
    if current.get("source") == "bootstrap":
        print("gen_rules --check: rules.v1.json is bootstrap-sourced — the "
              "bootstrap path was removed in v1.1; regenerate from the linter.",
              file=sys.stderr)
        return 2
    if current.get("source_hash") != fresh["source_hash"]:
        print("gen_rules --check: STALE — rule table changed since rules.v1.json "
              "was generated. Run gen_rules.py and commit the result.", file=sys.stderr)
        return 1
    print("gen_rules --check: fresh.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--check", action="store_true", help="CI freshness guard")
    args = ap.parse_args()

    if args.check:
        return check_freshness(args.out)

    doc = compile_doc()
    args.out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"gen_rules: wrote {args.out}  ({len(doc['rules'])} rules, source={doc['source']}, {doc['source_hash'][:19]}…)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# --------------------------------------------------------------------------
# CI snippet (add to the existing lint/CI workflow):
#
#   - name: rules.v1.json freshness (gen_guilds drift-guard pattern)
#     run: python gen_rules.py --check
#
# Exit 1 fails the build on a stale table; exit 2 fails it when the linter
# exists but rules.v1.json is still bootstrap-sourced.
# --------------------------------------------------------------------------
