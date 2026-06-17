#!/usr/bin/env python3
"""Generate a polished single-file HTML dashboard from housing-import-consolidated.json."""
import json, html, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "housing-import-consolidated.json")))
OUT = os.path.expanduser("~/Desktop/KFI-Housing-Portfolio.html")

props = DATA["properties"]
pending = DATA.get("pending_or_application_stage", [])
billing = DATA.get("billing_unmapped", {})
excluded = DATA.get("excluded_not_housing", [])

def money(v):
    if v is None: return ""
    try: return "${:,.0f}".format(v) if float(v) == int(v) else "${:,.2f}".format(v)
    except Exception: return html.escape(str(v))

def esc(v): return html.escape(str(v)) if v is not None else ""

# tallies
n_props = len(props)
n_units = sum(len(p.get("leases", [])) for p in props)
n_rent = sum(1 for p in props for l in p.get("leases", []) if l.get("monthlyRent") or l.get("nightlyRate"))
n_motel = sum(1 for p in props if p.get("propertyType") == "Motel")
n_review = sum(1 for p in props for l in p.get("leases", []) if l.get("needsReview"))
states = sorted({p.get("state") for p in props if p.get("state")})

TYPE_COLORS = {"Apartment": "#2563eb", "Motel": "#9333ea", "Town house": "#0d9488"}

def badge(text, color, soft=False):
    if soft:
        return f'<span class="badge" style="color:{color};background:{color}1a;">{esc(text)}</span>'
    return f'<span class="badge" style="color:#fff;background:{color};">{esc(text)}</span>'

def status_badge(s):
    s = s or "Active"
    c = {"Active": "#16a34a", "Vacating": "#dc2626", "Pending": "#d97706",
         "Returned": "#6b7280", "Inactive": "#6b7280"}.get(s, "#16a34a")
    return badge(s, c, soft=True)

def lease_rows(leases):
    rows = []
    for l in leases:
        rent = money(l.get("monthlyRent")) or (money(l.get("nightlyRate")) + "/nt" if l.get("nightlyRate") else "")
        dates = ""
        if l.get("startDate") or l.get("endDate"):
            dates = f'{esc(l.get("startDate") or "?")} → {esc(l.get("endDate") or "?")}'
        flag = '<span class="rev">review</span>' if l.get("needsReview") else ''
        note = esc(l.get("notes", ""))
        cls = ' class="needs"' if l.get("needsReview") else ''
        rows.append(
            f'<tr{cls}><td class="u">{esc(l.get("unit"))} {flag}</td>'
            f'<td class="r">{rent or "—"}</td>'
            f'<td>{money(l.get("securityDeposit")) or "—"}</td>'
            f'<td class="d">{dates or "—"}</td>'
            f'<td>{status_badge(l.get("status"))}</td>'
            f'<td class="nt">{note}</td></tr>'
        )
    return "".join(rows)

def prop_card(p):
    t = p.get("propertyType") or "—"
    tcolor = TYPE_COLORS.get(t, "#475569")
    head_badges = [badge(t, tcolor)]
    if p.get("alreadyInApp"):
        head_badges.append(badge("already in app", "#16a34a", soft=True))
    if p.get("costPerWeek"):
        head_badges.append(badge(f'${p["costPerWeek"]}/wk', "#0891b2", soft=True))
    head_badges.append(status_badge(p.get("status")))
    loc = ", ".join(x for x in [p.get("address"), p.get("city"), p.get("state"), p.get("zip")] if x)
    meta = []
    if p.get("client"): meta.append(f'<b>Client:</b> {esc(p["client"])}')
    if p.get("vendor"): meta.append(f'<b>Vendor:</b> {esc(p["vendor"])}')
    if p.get("landlordName"): meta.append(f'<b>Landlord:</b> {esc(p["landlordName"])}')
    if p.get("landlordPhone"): meta.append(esc(p["landlordPhone"]))
    if p.get("landlordEmail"): meta.append(esc(p["landlordEmail"]))
    bills = ""
    if p.get("bills"):
        items = "".join(
            f'<li>{esc(b.get("invoiceNumber",""))} {money(b.get("amount")) } '
            f'<span class="muted">{esc(b.get("description",""))}</span>'
            f'{" · due "+esc(b.get("dueDate")) if b.get("dueDate") else ""}'
            f'{" · "+badge(b["status"],"#dc2626",soft=True) if b.get("status") else ""}</li>'
            for b in p["bills"])
        bills = f'<div class="bills"><span class="lbl">Bills</span><ul>{items}</ul></div>'
    utils = ""
    if p.get("utilities"):
        u = ", ".join(f'{esc(x.get("type",""))}{" ("+esc(x.get("company"))+")" if x.get("company") else ""}' for x in p["utilities"])
        utils = f'<div class="util"><span class="lbl">Utilities</span> {u}</div>'
    note = f'<div class="pnote">{esc(p["notes"])}</div>' if p.get("notes") else ""
    search = esc(" ".join(str(x) for x in [p.get("name"), p.get("client"), p.get("city"), p.get("state"), t]))
    return f'''
    <article class="card" data-type="{esc(t)}" data-state="{esc(p.get("state") or "")}" data-search="{search.lower()}">
      <div class="chead">
        <h3>{esc(p.get("name"))}</h3>
        <div class="badges">{"".join(head_badges)}</div>
      </div>
      <div class="loc">📍 {esc(loc) or "address TBD"}</div>
      <div class="metaline">{" · ".join(meta)}</div>
      <table class="leases"><thead><tr><th>Unit / Room</th><th>Rent</th><th>Deposit</th><th>Term</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>{lease_rows(p.get("leases", []))}</tbody></table>
      {utils}{bills}{note}
    </article>'''

cards = "\n".join(prop_card(p) for p in props)

# decisions
decisions = [
    "<b>Bill.com vs lease rent</b> — invoice amounts (e.g. Prairie Hill $1,970.59) run higher than lease base ($1,675) because they bundle fees + Lanyard markup. Lease figure kept; invoice noted. Don't double-count.",
    "<b>Past-due / disputed invoices</b> — 1110-1286 (Prairie Hill) & 1110-1292 (Sunset Place) past due; Hickory Haven 1110-1241 ($4,647) disputed. Pay or hold?",
    "<b>Hickory Haven</b> vacated ~6/6 (safety). Mark property Inactive?",
    "<b>Orgill = Dexter or Sikeston, MO?</b> Email says Dexter (501 W Fannetta); SharePoint folders say Sikeston.",
    "<b>Two “Ridge” motels</b> — Portage (active roster) vs a Madison folder (scanned). Same property or two?",
    "<b>Split-out addresses</b> — Greenock Apt 45 (918 Zimmer Hill Rd) and Beau Chateau Grant A3 (15974 Co Rd 612) have their own street address.",
    "<b>SJPI</b> excluded as KFI's own office lease, not housing. Agree?",
    "<b>Pending</b> — Conley GA (#3QRIW1) and El Paso Bartlett (#9V4DOO) have no executed lease yet. Import as Upcoming or hold?",
]
dec_html = "".join(f"<li>{d}</li>" for d in decisions)

pending_html = "".join(
    f'<li><b>{esc(p.get("name"))}</b> ({esc(p.get("housingRequestId",""))}) — {esc(p.get("city"))}, {esc(p.get("state"))}. {esc(p.get("notes",""))}</li>'
    for p in pending)

inv_rows = "".join(
    f'<tr><td>{esc(i.get("invoiceNumber"))}</td><td>{money(i.get("amount")) or "in PDF"}</td>'
    f'<td>{esc(i.get("dueDate",""))}</td><td>{status_badge(i.get("status")) if i.get("status") else ""}</td>'
    f'<td>{esc(i.get("mapsTo",""))}</td></tr>'
    for i in billing.get("invoices", []))

excl_html = "".join(f'<li><b>{esc(e.get("name"))}</b> — {esc(e.get("type",""))}. {esc(e.get("notes",""))}</li>' for e in excluded)

state_opts = "".join(f'<option value="{s}">{s}</option>' for s in states)

HTMLDOC = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KFI Housing Portfolio</title>
<style>
:root{{--bg:#0f172a;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb;--soft:#f1f5f9;}}
*{{box-sizing:border-box;}}
body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#f8fafc;}}
header.top{{background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;padding:34px 28px 26px;}}
header.top h1{{margin:0 0 4px;font-size:26px;letter-spacing:-.4px;}}
header.top .sub{{color:#cbd5e1;font-size:13px;}}
.stats{{display:flex;flex-wrap:wrap;gap:14px;margin-top:20px;}}
.stat{{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:12px 16px;min-width:120px;}}
.stat .n{{font-size:26px;font-weight:700;}}
.stat .l{{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#cbd5e1;margin-top:2px;}}
.wrap{{max-width:1180px;margin:0 auto;padding:24px 20px 80px;}}
.callout{{background:#fffbeb;border:1px solid #fde68a;border-left:5px solid #f59e0b;border-radius:12px;padding:16px 20px;margin:22px 0;}}
.callout h2{{margin:0 0 8px;font-size:16px;color:#92400e;}}
.callout ol{{margin:0;padding-left:20px;}} .callout li{{margin:6px 0;font-size:13.5px;line-height:1.5;}}
.toolbar{{position:sticky;top:0;z-index:5;background:#f8fafc;padding:14px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);margin-bottom:18px;}}
.toolbar input,.toolbar select{{padding:9px 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;background:#fff;}}
.toolbar input{{flex:1;min-width:200px;}}
.chip{{padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px;}}
.chip.on{{background:var(--accent);color:#fff;border-color:var(--accent);}}
.sec{{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:30px 0 12px;font-weight:700;}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:18px;}}
@media(max-width:600px){{.grid{{grid-template-columns:1fr;}}}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(15,23,42,.05);}}
.chead{{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}}
.chead h3{{margin:0;font-size:17px;letter-spacing:-.2px;}}
.badges{{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}}
.badge{{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;}}
.loc{{color:var(--muted);font-size:13px;margin:8px 0 4px;}}
.metaline{{font-size:12.5px;color:#334155;margin-bottom:12px;line-height:1.6;}}
table.leases{{width:100%;border-collapse:collapse;font-size:12.5px;}}
table.leases th{{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--line);padding:6px 8px;}}
table.leases td{{padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top;}}
table.leases td.r{{font-weight:700;color:#0f172a;white-space:nowrap;}}
table.leases td.u{{font-weight:600;}}
table.leases td.d{{white-space:nowrap;color:#475569;}}
table.leases td.nt{{color:var(--muted);font-size:11.5px;max-width:220px;}}
tr.needs{{background:#fef9f3;}}
.rev{{font-size:9.5px;background:#fde68a;color:#92400e;border-radius:4px;padding:1px 5px;text-transform:uppercase;letter-spacing:.3px;vertical-align:middle;}}
.bills,.util{{margin-top:10px;font-size:12.5px;}} .bills ul{{margin:4px 0 0;padding-left:18px;}} .bills li{{margin:3px 0;}}
.lbl{{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;}}
.muted{{color:var(--muted);}}
.pnote{{margin-top:11px;font-size:12px;color:#475569;background:var(--soft);border-radius:8px;padding:9px 11px;line-height:1.5;}}
.panel{{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;}}
.panel ul{{margin:6px 0 0;padding-left:20px;}} .panel li{{margin:6px 0;font-size:13.5px;}}
table.inv{{width:100%;border-collapse:collapse;font-size:13px;}} table.inv th,table.inv td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);}}
.foot{{color:var(--muted);font-size:12px;margin-top:40px;text-align:center;}}
</style></head>
<body>
<header class="top">
  <h1>🏠 KFI Housing Portfolio</h1>
  <div class="sub">Consolidated from June 2026 email · SharePoint masters · {len(props)} signed-lease folders &nbsp;·&nbsp; generated {datetime.date.today().isoformat()} &nbsp;·&nbsp; <i>not yet imported — review draft</i></div>
  <div class="stats">
    <div class="stat"><div class="n">{n_props}</div><div class="l">Properties</div></div>
    <div class="stat"><div class="n">{n_units}</div><div class="l">Units / Rooms</div></div>
    <div class="stat"><div class="n">{n_rent}</div><div class="l">Rent confirmed</div></div>
    <div class="stat"><div class="n">{n_motel}</div><div class="l">Hotels / Motels</div></div>
    <div class="stat"><div class="n">{n_review}</div><div class="l">Need review</div></div>
    <div class="stat"><div class="n">{len(states)}</div><div class="l">States</div></div>
  </div>
</header>
<div class="wrap">
  <div class="callout">
    <h2>⚠️ Decisions for you before import</h2>
    <ol>{dec_html}</ol>
  </div>

  <div class="toolbar">
    <input id="q" placeholder="Search property, client, city…" oninput="flt()">
    <select id="st" onchange="flt()"><option value="">All states</option>{state_opts}</select>
    <span class="chip on" data-t="" onclick="setType(this,'')">All types</span>
    <span class="chip" data-t="Apartment" onclick="setType(this,'Apartment')">Apartments</span>
    <span class="chip" data-t="Motel" onclick="setType(this,'Motel')">Motels</span>
    <span class="chip" data-t="Town house" onclick="setType(this,'Town house')">Townhouses</span>
  </div>

  <div class="sec">Properties</div>
  <div class="grid" id="grid">
  {cards}
  </div>

  <div class="sec">Pending / application stage</div>
  <div class="panel"><ul>{pending_html or "<li>None</li>"}</ul></div>

  <div class="sec">Lanyard Bill.com invoices to reconcile</div>
  <div class="panel">
    <p class="muted" style="margin-top:0;font-size:13px;">{esc(billing.get("notes",""))}</p>
    <table class="inv"><thead><tr><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th>Maps to</th></tr></thead><tbody>{inv_rows}</tbody></table>
  </div>

  <div class="sec">Excluded (not worker housing)</div>
  <div class="panel"><ul>{excl_html or "<li>None</li>"}</ul></div>

  <div class="foot">Source files: imports/housing-import-consolidated.json · email-harvest-2026-06.json · sharepoint-harvest.json</div>
</div>
<script>
var TYPE="";
function setType(el,t){{TYPE=t;document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));el.classList.add('on');flt();}}
function flt(){{
  var q=document.getElementById('q').value.toLowerCase().trim();
  var st=document.getElementById('st').value;
  document.querySelectorAll('#grid .card').forEach(function(c){{
    var ok=(!TYPE||c.dataset.type===TYPE)&&(!st||c.dataset.state===st)&&(!q||c.dataset.search.indexOf(q)>-1);
    c.style.display=ok?'':'none';
  }});
}}
</script>
</body></html>"""

open(OUT, "w").write(HTMLDOC)
print("Wrote", OUT, f"({len(HTMLDOC):,} bytes)")
