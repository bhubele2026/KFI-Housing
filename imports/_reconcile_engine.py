#!/usr/bin/env python3
"""Reconcile SharePoint master occupancy vs app beds vs active roster.
Reads:
  _app_occupants.json, _app_beds.json, _app_properties.json, _app_roster.json
  _master_occupancy.json  (hand-assembled from per-property master sheets)
Writes:
  bed-occupancy-reconcile.json, bed-occupancy-reconcile.md
"""
import json, re, os
D=os.path.dirname(os.path.abspath(__file__))
def L(f): return json.load(open(os.path.join(D,f)))

occ=L('_app_occupants.json')
beds=L('_app_beds.json')
props={p['id']:p['name'] for p in L('_app_properties.json')}
roster=L('_app_roster.json')['people']
master=L('_master_occupancy.json')   # {propertyId: {"appPropertyId":..,"name":..,"units":[{"unit":..,"bed":..,"masterName":..}], "totalBeds":N}}

SUFFIX={'JR','SR','II','III','IV'}
NOISE={'T','TBD','KFI','SUP','SUP.','BASEMENT','CHOFER','LAST','NAME','T4','T5','T6','T7','P6','P5','P7','VACANT','EMPTY','OPEN','AVAILABLE','NA','N'}
def norm(n):
    if not n: return []
    n=n.upper()
    n=re.sub(r'\([^)]*\)',' ',n)
    n=n.split(' - ')[0]
    n=re.sub(r'[^A-Z ]',' ',n)
    return [t for t in n.split() if t not in SUFFIX and t not in NOISE and len(t)>1]

roster_idx=[(r['personId'],r['name'],set(norm(r['name']))) for r in roster]
roster_by_id={r['personId']:r['name'] for r in roster}

def first_last(name):
    t=norm(name)
    return (t[0],t[-1]) if len(t)>=2 else (None,None)

def match_roster(name):
    toks=set(norm(name))
    if not toks: return None,[]
    qfl=first_last(name)
    scored=[]
    for pid,rn,rtoks in roster_idx:
        if not rtoks: continue
        inter=toks & rtoks
        if not inter: continue
        cover=len(inter)/len(toks)
        jac=len(inter)/len(toks|rtoks)
        # first+last name agreement (handles middle-name/initial expansion either way)
        rfl=first_last(rn)
        fl_match=(qfl[0] and qfl==rfl)
        scored.append((cover,jac,fl_match,pid,rn))
    scored.sort(key=lambda x:(x[2],x[0],x[1]),reverse=True)
    cands=[{'personId':p,'name':r,'cover':round(c,2),'jaccard':round(j,2)} for c,j,fl,p,r in scored[:3]]
    if scored:
        c,j,fl,p,r=scored[0]
        # confident: all query tokens covered & decent jaccard, OR exact first+last match
        if (c>=0.999 and j>=0.5) or fl:
            return {'personId':p,'name':r},cands
    return None,cands

# app occupant name match against another name (master) — same token approach
def names_equal(a,b):
    return set(norm(a))==set(norm(b)) and bool(norm(a))
def names_similar(a,b):
    ta,tb=set(norm(a)),set(norm(b))
    if not ta or not tb: return False
    inter=ta&tb
    return len(inter)/min(len(ta),len(tb))>=0.5

bedmap={b['id']:b for b in beds}
# index app occupants per property (active+former)
from collections import defaultdict
app_by_prop=defaultdict(list)
for o in occ:
    app_by_prop[o['propertyId']].append(o)
app_bedcount=defaultdict(int)
for b in beds: app_bedcount[b['propertyId']]+=1

out={}
summary=defaultdict(int)
needs_match=[]   # (property, masterName, candidates)
bedcount_mismatch=[]

for apid,pdata in master.items():
    pname=props.get(apid,pdata.get('name',apid))
    app_occ=app_by_prop.get(apid,[])
    app_active=[o for o in app_occ if o['status']=='Active']
    rows=[]
    used_app=set()
    for u in pdata['units']:
        mname=u.get('masterName')
        if not mname or not norm(mname):
            continue  # vacant/blank master cell
        summary['masterOccupied']+=1
        # find app occupant at this property matching this name
        appmatch=None
        for o in app_active:
            if id(o) in used_app: continue
            if names_equal(o['name'],mname):
                appmatch=o; break
        if not appmatch:
            for o in app_active:
                if id(o) in used_app: continue
                if names_similar(o['name'],mname):
                    appmatch=o; break
        roster_m,cands=match_roster(mname)
        if not roster_m:
            needs_match.append((pname,mname,cands))
            summary['noRosterMatch']+=1
        if appmatch:
            used_app.add(id(appmatch))
            status='match' if names_equal(appmatch['name'],mname) else 'name-diff'
            summary[status]+=1
            rows.append({'unit':u.get('unit'),'bed':u.get('bed'),'masterName':mname,
                'appName':appmatch['name'],'appBedId':appmatch['bedId'],
                'matchToRoster':roster_m,'rosterCandidates':None if roster_m else cands,
                'status':status})
        else:
            summary['appMissing']+=1
            rows.append({'unit':u.get('unit'),'bed':u.get('bed'),'masterName':mname,
                'appName':None,'appBedId':None,
                'matchToRoster':roster_m,'rosterCandidates':None if roster_m else cands,
                'status':'app-missing'})
    # app occupants NOT covered by master => master-missing
    for o in app_active:
        if id(o) in used_app: continue
        summary['masterMissing']+=1
        rm=roster_by_id.get(o.get('employeeId'))
        if rm:
            rmatch={'personId':o['employeeId'],'name':rm}; rcands=None
        else:
            rmatch,rcands=match_roster(o['name'])
        rows.append({'unit':None,'bed':bedmap.get(o['bedId'],{}).get('bedNumber'),'masterName':None,
            'appName':o['name'],'appBedId':o['bedId'],
            'matchToRoster':rmatch,
            'rosterCandidates':None if rmatch else rcands,
            'status':'master-missing'})
    # bed count comparison
    mtotal=pdata.get('totalBeds')
    atotal=app_bedcount.get(apid)
    if mtotal is not None and atotal is not None and mtotal!=atotal:
        bedcount_mismatch.append((pname,mtotal,atotal))
    out[apid]={'property':pname,'masterTotalBeds':mtotal,'appTotalBeds':atotal,'rows':rows}

json.dump({'generatedFrom':'SharePoint per-property master occupancy sheets vs kfi-housing.replit.app',
    'summary':dict(summary),'properties':out},
    open(os.path.join(D,'bed-occupancy-reconcile.json'),'w'),indent=2)

# markdown
ml=[]
ml.append('# Bed Occupancy Reconciliation')
ml.append('')
ml.append('SharePoint Housing Master (per-property occupancy sheets) vs app `/api/occupants`+`/api/beds` vs `/api/roster/active`.')
ml.append('')
ml.append('## Summary')
for k in ['masterOccupied','match','name-diff','appMissing','masterMissing','noRosterMatch']:
    ml.append(f'- **{k}**: {summary.get(k,0)}')
ml.append('')
STAT={'match':'OK','name-diff':'NAME DIFF','app-missing':'APP MISSING','master-missing':'MASTER MISSING'}
for apid,pd in out.items():
    ml.append(f"## {pd['property']}")
    ml.append(f"_master beds={pd['masterTotalBeds']} · app beds={pd['appTotalBeds']}_")
    ml.append('')
    ml.append('| Unit | Bed | Master name | App name | Status | Roster match |')
    ml.append('|---|---|---|---|---|---|')
    for r in pd['rows']:
        rm=r['matchToRoster']
        rmtxt=f"{rm['name']} ({rm['personId']})" if rm else ('NO MATCH' if r['masterName'] else '—')
        ml.append(f"| {r.get('unit') or ''} | {r.get('bed') or ''} | {r.get('masterName') or ''} | {r.get('appName') or ''} | {STAT.get(r['status'],r['status'])} | {rmtxt} |")
    ml.append('')
ml.append('## Needs matching (master names with no confident active-roster match)')
ml.append('')
if needs_match:
    ml.append('| Property | Master name | Closest roster candidates |')
    ml.append('|---|---|---|')
    for pname,mname,cands in needs_match:
        c='; '.join(f"{x['name']} ({x['personId']}, cov {x['cover']})" for x in cands) or 'none'
        ml.append(f"| {pname} | {mname} | {c} |")
else:
    ml.append('_none_')
ml.append('')
ml.append('## Bed count mismatches (master total vs app total)')
ml.append('')
if bedcount_mismatch:
    ml.append('| Property | Master beds | App beds |')
    ml.append('|---|---|---|')
    for pname,m,a in bedcount_mismatch:
        ml.append(f"| {pname} | {m} | {a} |")
else:
    ml.append('_none reported_')
ml.append('')
open(os.path.join(D,'bed-occupancy-reconcile.md'),'w').write('\n'.join(ml))
print('WROTE reconcile files')
print('summary',dict(summary))
print('needs_match',len(needs_match),'bedcount_mismatch',bedcount_mismatch)
