#!/usr/bin/env python3
"""Dry-run: map consolidated harvest -> live gap leases. No writes.
Decisions applied: Orgill=Sikeston (Dexter stale), Hickory=Active,
Ridge=one property, Bartlett/Conley=hold, keep lease rent, exclude SJPI."""
import json, re, sys

live_leases = json.load(open('/tmp/live_leases.json'))
live_props  = json.load(open('/tmp/live_props.json'))
cons        = json.load(open('imports/housing-import-consolidated.json'))
fixes       = json.load(open('imports/lease-fixes-from-sources.json'))

# --- decision flags ---
HOLD_PROPS = {'prop-bartlett-el-paso'}          # El Paso Bartlett + Conley -> hold
STALE_PROPS = {'prop-beau-chateau-dexter'}      # Orgill=Sikeston => Dexter stale, don't fill

def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())
def normunit(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

prop_by_id = {p['id']: p for p in live_props}

# map consolidated property -> live prop id by name+city
def match_prop(cp):
    cn, cc, cs = norm(cp.get('name')), norm(cp.get('city')), (cp.get('state') or '').upper()
    best=None
    for p in live_props:
        ln, lc, ls = norm(p['name']), norm(p.get('city')), (p.get('state') or '').upper()
        score=0
        # name token overlap
        if cn and (cn in ln or ln in cn): score+=3
        else:
            a=set(re.findall(r'[a-z0-9]+',(cp.get('name') or '').lower()))
            b=set(re.findall(r'[a-z0-9]+',(p['name'] or '').lower()))
            if a and b: score+= 3*len(a&b)/max(len(a),len(b))
        if cc and cc==lc: score+=2
        if cs and cs==ls: score+=1
        if best is None or score>best[1]: best=(p,score)
    return best if best and best[1]>=2.5 else None

# gap leases = missing rent or startDate
gaps = [l for l in live_leases if (l.get('monthlyRent') in (0,None)) or not l.get('startDate')]

patches=[]; skips=[]; unmatched=[]
for l in gaps:
    pid=l.get('propertyId'); unit=l.get('unit')
    if pid in HOLD_PROPS: skips.append((l,'HOLD (pending lease)')); continue
    if pid in STALE_PROPS: skips.append((l,'STALE (Orgill=Sikeston)')); continue
    p=prop_by_id.get(pid)
    # find consolidated property that maps to this live pid
    cand=None
    for cp in cons['properties']:
        m=match_prop(cp)
        if m and m[0]['id']==pid: cand=cp; break
    if not cand: unmatched.append((l,'no consolidated property match')); continue
    # find unit
    cu=None
    for u in cand.get('leases',[]):
        if normunit(u.get('unit'))==normunit(unit): cu=u; break
    if not cu and len(cand.get('leases',[]))==1: cu=cand['leases'][0]
    if not cu: unmatched.append((l,f'prop matched ({cand.get("name")}) but no unit match for {unit!r}')); continue
    new={}
    for fld in ('monthlyRent','startDate','endDate'):
        nv=cu.get(fld)
        ov=l.get(fld)
        if nv in (None,'',0): continue
        if str(ov or '')!=str(nv or ''): new[fld]=nv
    if not new: skips.append((l,'consolidated has nothing better')); continue
    patches.append((l, cand.get('name'), new, cu.get('status')))

# lease-fixes remnant (PATCH by id where change exists)
by_id={l['id']:l for l in live_leases}
fix_patches=[]
for f in fixes:
    cur=by_id.get(f.get('leaseId'))
    if not cur: continue
    new={}
    for fld in ('monthlyRent','startDate','endDate'):
        nv=f.get(fld)
        if nv in (None,'') : continue
        if str(cur.get(fld) or '')!=str(nv or ''): new[fld]=nv
    if new: fix_patches.append((cur, f.get('propertyName'), new))

print('='*70)
print(f'LEASE-FIXES remnant PATCHes: {len(fix_patches)}')
for cur,pn,new in fix_patches:
    print(f'  PATCH {cur["id"]:34} [{pn[:28]}] {new}')
print()
print(f'CONSOLIDATED -> gap-lease PATCHes: {len(patches)}')
for l,pn,new,st in patches:
    print(f'  PATCH {l["id"]:34} u={str(l.get("unit"))[:10]:10} [{pn[:26]:26}] {new}')
print()
print(f'SKIPPED (by decision / nothing better): {len(skips)}')
for l,why in skips:
    print(f'  skip  {l["id"]:34} u={str(l.get("unit"))[:10]:10} {why}')
print()
print(f'UNMATCHED (need eyes): {len(unmatched)}')
for l,why in unmatched:
    print(f'  ????  {l["id"]:34} prop={l.get("propertyId"):38} u={str(l.get("unit"))[:10]:10} {why}')

json.dump({'fix_patches':[(c['id'],n) for c,_,n in fix_patches],
           'patches':[(l['id'],n) for l,_,n,_ in patches]},
          open('/tmp/apply_plan.json','w'))
