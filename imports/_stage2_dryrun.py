#!/usr/bin/env python3
"""Stage 2 occupant-backfill DRY RUN (read-only).

Reconciles the 102 "missing from app" associates (missing_from_app.csv /
Appendix A) against the LIVE app (occupants/properties/beds) so we never
repeat the 2026-06-23 duplicate-occupant bug. Produces a routing + conflict
report. WRITES NOTHING.
"""
import csv, json, re, sys
from pathlib import Path

HERE = Path(__file__).parent
DL = Path.home() / "Downloads"

def norm(name: str):
    """Normalize a person name -> (full, first_last) for dup detection."""
    s = name.lower().strip()
    s = re.sub(r"[.,]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    toks = [t for t in s.split(" ") if t]
    # drop suffixes
    toks = [t for t in toks if t not in {"jr", "sr", "ii", "iii", "iv"}]
    # drop single-letter middle initials
    core = [t for t in toks if len(t) > 1]
    full = " ".join(core)
    first_last = (core[0] + " " + core[-1]) if len(core) >= 2 else full
    return full, first_last

def load_rows(path):
    d = json.load(open(path))
    return d if isinstance(d, list) else d.get("items", d.get("data", []))

# --- live data ---
occs = load_rows(HERE / "_live_occupants.json")
props = load_rows(HERE / "_live_properties.json")

# index live occupants by normalized name
live_full = {}
live_fl = {}
for o in occs:
    nm = o.get("fullName") or o.get("name") or ""
    if not nm:
        continue
    f, fl = norm(nm)
    live_full.setdefault(f, []).append(o)
    live_fl.setdefault(fl, []).append(o)

pid_set = {p.get("id") for p in props}
def has(pid):
    return pid in pid_set

# Classify by source_tab -> (category, target). Categories:
#   single   = one live property, safe to place (still needs a vacant bed)
#   cluster  = spans multiple live properties; needs the master tab's per-person
#              unit to pick the bed (don't guess)
#   missing  = the routed property does NOT exist live yet (seed it first)
#   decision = blocked on a human decision from the brief's open list
TAB_ROUTING = {
    "Adient": ("missing", "Econo Lodge Jefferson City — NOT live (memory: superseded by seed-adient)"),
    "Burnett.Siren.Hinkley.": ("cluster", ["prop-burnett-siren-7666-south-shore", "prop-burnett-webster-7112-zielsdorf", "prop-burnett-hinckley-7th-st-se"]),
    "El Paso, TX": ("decision", "prop-bartlett-el-paso — brief decision was HOLD/empty stub; Appendix A lists 4 to import (conflict)"),
    "Greystone": ("missing", "Chateau Knoll, Bettendorf IA — NOT live (no matching property)"),
    "Orgill...Sikeston,MO": ("decision", "Beau Chateau Dexter vs TB Rentals Sikeston — open decision #4"),
    "WILSON - Burnett": ("single", "prop-burnett-menomonie-houses"),
    "InterWire.Rome,NY": ("single", "prop-iwg-bloomfield-st"),
    "WB Man.Gilman,WI": ("cluster", ["prop-sunset-place-neillsville", "prop-hickory-haven-gilman"]),
    "Schuette.Wausau,WI": ("cluster", ["prop-schuette-1331-s-8th-apt-200", "prop-schuette-1341-s-8th-apt-108"]),
    "Delallo.Jeannette,PA": ("cluster", ["prop-delallo-yellow-house", "prop-delallo-autozone"]),
    "Shusters.Greenock.": ("single", "prop-shusters-900-seneca-mckeesport"),
    "Landscape.Plymounth, MN": ("single", "prop-park-place-plymouth"),
    "P2.P5-Portage,WI": ("single", "prop-1779300519785-1whm"),
}

rows = list(csv.DictReader(open(DL / "missing_from_app.csv")))

dups = []
buckets = {"single": [], "cluster": [], "missing": [], "decision": [], "unknown": []}
for r in rows:
    nm = r["name"].strip()
    f, fl = norm(nm)
    existing = live_full.get(f) or live_fl.get(fl)
    if existing:
        dups.append((nm, [e.get("id") for e in existing]))
        continue
    tab = r.get("source_tab", "").strip()
    cat, target = TAB_ROUTING.get(tab, ("unknown", tab))
    if cat == "single" and isinstance(target, str) and not has(target):
        cat = "missing"
        target = f"{target} — NOT live"
    buckets[cat].append((nm, target, tab))

net_new = buckets["single"]
unroutable = buckets["missing"] + buckets["decision"] + buckets["unknown"] + buckets["cluster"]

# --- report ---
from collections import defaultdict
out = []
out.append("# Stage 2 — Occupant Backfill DRY RUN (read-only, no writes)\n")
out.append("_Guards against the 2026-06-23 duplicate-occupant bug: every name is checked "
           "against the 130 live occupants before it is ever a create candidate._\n")
out.append(f"- Missing associates in CSV: **{len(rows)}**")
out.append(f"- Live occupants compared against: **{len(occs)}**")
out.append(f"- Live properties available to route to: **{len(props)}**\n")
out.append("## Disposition")
out.append(f"- ✅ **single-property, safe to create** (still needs a vacant bed): **{len(buckets['single'])}**")
out.append(f"- 🧩 **multi-property cluster** (needs the master tab's per-person unit — don't guess the bed): **{len(buckets['cluster'])}**")
out.append(f"- 🏗️ **property not live yet** (seed the property first): **{len(buckets['missing'])}**")
out.append(f"- ⚖️ **blocked on a human decision**: **{len(buckets['decision'])}**")
out.append(f"- ❓ unknown source tab: **{len(buckets['unknown'])}**")
out.append(f"- ⚠️ **already in app by name (DUP — skip)**: **{len(dups)}**\n")

def dump(title, items):
    out.append(f"### {title} ({len(items)})")
    byt = defaultdict(list)
    for nm, target, tab in items:
        key = target if isinstance(target, str) else " / ".join(target)
        byt[(tab, key)].append(nm)
    for (tab, key), names in sorted(byt.items()):
        out.append(f"- **{tab}** → `{key}` — {len(names)}")
        for n in names:
            out.append(f"    - {n}")
    out.append("")

if dups:
    out.append("### ⚠️ Duplicates — already live, DO NOT recreate")
    for nm, ids in dups:
        out.append(f"- {nm} → existing {', '.join(ids)}")
    out.append("")
dump("✅ Single-property — safe to create (assign a vacant bed)", buckets["single"])
dump("🧩 Cluster — route to a building unit from the master tab first", buckets["cluster"])
dump("🏗️ Property not live — seed it before importing these people", buckets["missing"])
dump("⚖️ Blocked on a human decision", buckets["decision"])
if buckets["unknown"]:
    dump("❓ Unknown source tab", buckets["unknown"])

report = "\n".join(out)
(HERE / "stage2-backfill-dryrun.md").write_text(report)
print(report[:1600])
print("\n... full report -> imports/stage2-backfill-dryrun.md")
print(f"SUMMARY single={len(buckets['single'])} cluster={len(buckets['cluster'])} "
      f"missing={len(buckets['missing'])} decision={len(buckets['decision'])} "
      f"unknown={len(buckets['unknown'])} dups={len(dups)}")
