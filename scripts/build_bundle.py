#!/usr/bin/env python3
"""Regenerate data/bundle.json from hackathon CSVs. Edit SPOTLIGHT / ROOT below as needed."""
from pathlib import Path
ROOT = str(Path(__file__).resolve().parents[1])
OUT = f"{ROOT}/data/bundle.json"
SPOTLIGHT = ["W-0001", "W-0002", "W-0009", "W-0015", "W-0019", "W-0031", "W-0086", "W-0126", "W-0156", "W-0210"]

import csv, json, statistics
from collections import defaultdict
from datetime import datetime

def load(name):
	with open(f"{ROOT}/{name}", newline="", encoding="utf-8") as f:
		return list(csv.DictReader(f))

def fnum(x):
	try: return float(x) if x not in (None, "") else None
	except: return None

print("Loading CSVs…")
workers, earnings, txns = load("workers.csv"), load("daily_earnings.csv"), load("transactions.csv")
obs, adv, weeks = load("recurring_obligations.csv"), load("earned_wage_advances.csv"), load("weekly_cashflow_summary.csv")
earn_by, txn_by, obs_by, adv_by, week_by = map(defaultdict, [list] * 5)
for r in earnings: earn_by[r["worker_id"]].append(r)
for r in txns: txn_by[r["worker_id"]].append(r)
for r in obs: obs_by[r["worker_id"]].append(r)
for r in adv:
	if r.get("status") == "cancelled": continue  # don't inflate peer fee stats
	adv_by[r["worker_id"]].append(r)
for r in weeks: week_by[r["worker_id"]].append(r)

cards = []
for w in workers:
	wid = w["worker_id"]
	ew, ww, aa = earn_by[wid], week_by[wid], adv_by[wid]
	nets = [fnum(e["net_pay_cad"]) for e in ew if fnum(e["net_pay_cad"]) is not None]
	bufs = [fnum(x["buffer_days_estimate"]) for x in ww if fnum(x["buffer_days_estimate"]) is not None and fnum(x["buffer_days_estimate"]) < 500]
	fees = sum(fnum(a["fee_cad"]) or 0 for a in aa)
	last_bal = fnum(sorted(ww, key=lambda x: x["week_start"])[-1]["ending_balance_cad"]) if ww else None
	typ = fnum(w["typical_daily_net_cad"]) or 0
	cards.append({"id": wid, "city": w["city"], "occupation": w["occupation"], "pay_type": w["pay_type"], "typical_daily_net": typ, "volatility": fnum(w["income_volatility"]), "tip_share": fnum(w["tip_share"]), "household_size": int(w["household_size"]), "dependents": int(w["dependents"]), "rent_burden": w["rent_burden_band"], "commute": w["commute_mode"], "has_bank": w["has_bank_account"] == "1", "prepaid": w["uses_prepaid_card"] == "1", "side_gig": w["has_side_gig"] == "1", "shifts": len(ew), "mean_net": round(statistics.mean(nets), 2) if nets else None, "advances": len(aa), "advance_fees": round(fees, 2), "buffer_median": round(statistics.median(bufs), 2) if bufs else None, "last_balance": last_bal, "rent": next((fnum(o["amount_cad"]) for o in obs_by[wid] if o["category"] == "housing"), None)})
	print(f"\r  cards {len(cards)}/{len(workers)}", end="", flush=True)
print()

def pack(wid):
	w = next(x for x in workers if x["worker_id"] == wid)
	return {
		"profile": dict(w),
		"earnings": [{"date": e["work_date"], "employer": e["employer_id"], "shift": e["shift_type"], "hours": fnum(e["hours_worked"]), "gross": fnum(e["gross_pay_cad"]), "tips": fnum(e["tips_cad"]), "deductions": fnum(e["deductions_cad"]), "net": fnum(e["net_pay_cad"]), "same_day": e["paid_same_day"] == "1", "method": e["pay_method"], "earnings_id": e["earnings_id"]} for e in sorted(earn_by[wid], key=lambda x: x["work_date"])],
		"transactions": [{"ts": t["txn_ts"], "dir": t["direction"], "amount": fnum(t["amount_cad"]), "category": t["category"], "merchant": t["merchant_type"], "channel": t["channel"], "essential": t["is_essential"] == "1", "balance": fnum(t["running_balance_cad"]), "notes": t["notes"]} for t in sorted(txn_by[wid], key=lambda x: x["txn_ts"])],
		"obligations": [{"name": o["name"], "category": o["category"], "amount": fnum(o["amount_cad"]), "freq": o["frequency"], "due_day": int(o["due_day_of_month"]), "autopay": o["autopay"] == "1", "essential": o["essential"] == "1", "obligation_id": o["obligation_id"]} for o in obs_by[wid]],
		"advances": [{"at": a["requested_at"], "amount": fnum(a["amount_cad"]), "fee": fnum(a["fee_cad"]), "status": a["status"], "repaid_at": a["repaid_at"] or None, "source": a["repayment_source"], "reason": a["reason_code"]} for a in sorted(adv_by[wid], key=lambda x: x["requested_at"])],
		"weeks": [{"week": x["week_start"], "income": fnum(x["income_cad"]), "expense": fnum(x["expense_cad"]), "essential": fnum(x["essential_expense_cad"]), "net": fnum(x["net_cashflow_cad"]), "adv_n": int(x["advances_count"]), "adv_amt": fnum(x["advances_amount_cad"]), "fees": fnum(x["advance_fees_cad"]), "balance": fnum(x["ending_balance_cad"]), "buffer": fnum(x["buffer_days_estimate"]), "neg": x["negative_balance_flag"] == "1"} for x in sorted(week_by[wid], key=lambda x: x["week_start"])],
	}

print("Packing spotlight…")
detail = {wid: pack(wid) for wid in SPOTLIGHT}
peers = defaultdict(list)
for c in cards: peers[f"{c['occupation']}|{c['rent_burden']}|{c['pay_type']}"].append(c)
peer_stats = {}
for k, arr in peers.items():
	bufs = [x["buffer_median"] for x in arr if x["buffer_median"] is not None]
	nets = [x["typical_daily_net"] for x in arr if x["typical_daily_net"] is not None]
	peer_stats[k] = {"n": len(arr), "buffer_median": round(statistics.median(bufs), 2) if bufs else None, "advances_mean": round(statistics.mean([x["advances"] for x in arr]), 2), "fees_mean": round(statistics.mean([x["advance_fees"] for x in arr]), 2), "typical_net_mean": round(statistics.mean(nets), 2) if nets else None}
out = {"meta": {"generated": datetime.now().isoformat(), "workers": len(workers), "spotlight": SPOTLIGHT, "as_of": "2026-06-30"}, "cards": cards, "detail": detail, "peer_stats": peer_stats}
Path(OUT).parent.mkdir(parents=True, exist_ok=True)
Path(OUT).write_text(json.dumps(out, separators=(",", ":")))
js_out = Path(OUT).with_suffix(".js")
js_out.write_text("window.__DAYSHIFT_BUNDLE__=" + json.dumps(out, separators=(",", ":")) + ";\n")
print(f"Wrote {OUT} ({Path(OUT).stat().st_size // 1024} KB)")
print(f"Wrote {js_out} ({js_out.stat().st_size // 1024} KB)")
