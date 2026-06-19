# KFI Staffing Housing — Operator Guide

*A plain-English guide to what this app tells you and how to ask it for things. No technical knowledge needed.*

---

## The one question this app answers

**Are we recovering the rent we pay out from the staff we house?**

We pay landlords for housing. We charge our people a housing deduction in payroll. This app's whole job is to make sure those two numbers line up — and to show you, in dollars, wherever they don't.

The number to watch is the **recovery gap**: what we pay for housing **minus** what we actually collect back in deductions. A gap means money is leaking. The app shows the gap per property and per customer, biggest leaks first.

Money leaks in three ways, and the app separates them so you know what to fix:
- **Empty beds** (vacancy loss) — we're paying for beds nobody's in.
- **Under-charging** (collection loss) — the deduction is less than the rent.
- **Charged but not placed** — someone's paying a housing deduction but isn't assigned to a bed. This is the one to chase first; it's usually a quick fix.

---

## Just talk to it — the assistant is the front door

You don't have to learn menus. Tap **"Ask me anything"** (bottom-right, on every page) and type what you want in normal words. The assistant does the digging and the math.

It's built so you **never need to know an ID or a database term.** Use real names — "Penda," "Schuette," a person's name — and it figures out the rest.

### Good things to ask

- *"Are we losing money on any client's housing?"*
- *"Who's paying a housing deduction but isn't in a bed?"*
- *"What needs my attention today?"*
- *"Show me the recovery gap for Schuette."*
- *"Why is that number so high?"* (it'll break the gap into empty beds vs under-charging vs unplaced)
- *"Place Maria Lopez in an open bed at Hickory Haven."*
- *"Set the rent on the three Greenock leases to $1,200."*
- *"Is my housing data trustworthy?"*

If a request is fuzzy, the assistant asks you **one** quick question with tap-to-pick options instead of guessing.

---

## The three things you'll do most

**1. Place someone who's charged but not placed.**
Ask *"who's charged but not in a bed?"* → the assistant lists them → say *"place [name] at [property]"* → it shows you a plain confirm card → tap **Confirm**.

**2. Check a client's recovery gap.**
Ask *"how's [customer]'s housing doing?"* → it leads with the dollar gap and a plain verdict (e.g. *"Schuette housing is $1,240/wk underwater — you're paying for 4 empty beds"*).

**3. Fix a lease's rent.**
Ask *"fix the rent on [property]"* → it shows the current value and the change → **Confirm**.

---

## What "today" looks like

When you open the assistant, it gives you a **"Here's what needs you today"** briefing — ranked by dollars at risk:
- the biggest recovery gaps,
- anyone **charged but not placed** (amber — chase these),
- leases expiring soon,
- people who look like they've moved out.

Tap any line to act on it.

---

## You're always safe

- **Every change shows a plain-English confirm card first** — "This will move Maria Lopez from Bed 3 at Greenock Manor to Bed 1 at Hickory Haven" — so you see exactly what happens before it happens.
- **Anything can be undone in one tap.** If you change your mind, hit Undo.
- Before anything that deletes or affects many records, the assistant spells out exactly what it'll touch and waits for your OK.

---

## Trusting the numbers

Every dollar figure the assistant gives you comes from the live data — it never makes a number up. If it doesn't know yet, it says *"let me pull that"* and looks it up first.

If you want to tidy the data, just ask:
- *"Let's clear my review queue"* — walks you through leases whose rent still needs confirming (often from scanned PDFs).
- *"Show me the rent anomalies"* — flags any rent that looks wrong (over $10,000).
- *"Which properties are missing insurance?"* — and you can upload the certificate right in the chat (tap the paperclip).
- *"Reconcile occupancy"* — compares who we're housing vs who we're charging, and offers to fix the mismatches.

---

## If something looks stale

You're always looking at the **published** site (`kfi-housing.replit.app`). After new work ships, you may see a small **"new version — Reload"** banner — tap it. If a change you expected isn't there yet, it usually just means the latest update hasn't been redeployed.

---

*That's it. When in doubt, open the assistant and ask in plain words — it's faster than hunting through screens, and it can both explain and do.*
