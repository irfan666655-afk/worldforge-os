#!/usr/bin/env python3
"""
gen_rules.py — WorldForge OS rules compiler (v1.0)

Compiles the PROMOTION-RELEVANT subset of lint_worldforge.py's rule table
into rules.v1.json, consumed by the JS rule evaluator in
wfkernel-p2-ext.v1.1.js. Same canonical-source discipline as gen_guilds.py:
derived artifacts are generated, never hand-edited, and carry a source
hash so CI can prove freshness.

    python gen_rules.py                 # emit rules.v1.json next to this file
    python gen_rules.py --out path.json
    python gen_rules.py --check         # CI freshness guard: exit 1 if
                                        # rules.v1.json is stale vs source

SOURCE RESOLUTION (in order):
  1. `from lint_worldforge import PROMOTION_RULES`  (preferred seam)
  2. `from lint_worldforge import RULES` filtered by tag 'promotion'
  3. BOOTSTRAP_TABLE below — used ONLY when lint_worldforge.py is not
     importable. Output is stamped "source": "bootstrap"; the JS
     evaluator surfaces a RULES-PROVENANCE warning on every evaluation
     until a linter-derived rules.v1.json replaces it. This keeps the
     platform unblocked today without silently violating principle 1.

RECONCILE(lint-src): once lint_worldforge.py is uploaded, confirm the
rule-table symbol name and per-rule field names in _adapt_linter_rule(),
then delete BOOTSTRAP_TABLE. Two marked functions, ~15 minutes.

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

RULES_VERSION = "1.0.0"
OUT_DEFAULT = Path(__file__).with_name("rules.v1.json")

# --------------------------------------------------------------------------
# Bootstrap table — promotion-relevant governance rules known from doctrine
# v5.2 (Rules 7 and 12) and asset-library-schema v3.1 minimums. Provisional:
# delete once the linter table imports (see module docstring).
# --------------------------------------------------------------------------
BOOTSTRAP_TABLE = [
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


# --------------------------------------------------------------------------
# Source resolution
# --------------------------------------------------------------------------
def _adapt_linter_rule(raw: dict) -> dict:
    """Map one lint_worldforge rule row into the DSL shape.

    RECONCILE(lint-src): adjust the key names below to the real rule-table
    row shape once lint_worldforge.py is available. Fail loudly on any row
    that cannot be mapped — a partial compile is worse than no compile.
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
    """Return (rules, source_label)."""
    try:
        import lint_worldforge  # noqa: F401
    except ImportError:
        return BOOTSTRAP_TABLE, "bootstrap"

    table = getattr(lint_worldforge, "PROMOTION_RULES", None)
    if table is None:
        table = getattr(lint_worldforge, "RULES", None)
        if table is None:
            raise SystemExit(
                "gen_rules: lint_worldforge imported but exposes neither "
                "PROMOTION_RULES nor RULES — add the seam or update this resolver."
            )
        table = [r for r in table if "promotion" in (r.get("tags") or [])]

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
    if current.get("source") == "bootstrap" and fresh["source"] != "bootstrap":
        print("gen_rules --check: rules.v1.json is bootstrap-sourced but "
              "lint_worldforge.py is present — regenerate.", file=sys.stderr)
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
    if doc["source"] == "bootstrap":
        print("gen_rules: NOTE — bootstrap-sourced. The JS evaluator will flag "
              "RULES-PROVENANCE until regenerated from lint_worldforge.py.")
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
