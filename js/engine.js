/* DAYSHIFT financial engines — SafeSpend · RentGap · Buffer · Peers · Pipeline */
(function () {

const CAD = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return "$—";
	const s = Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	return v < 0 ? `−$${s}` : `$${s}`;
};
const CAD2 = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return "$—";
	const s = Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return v < 0 ? `−$${s}` : `$${s}`;
};

function parseDay(d) {
	return new Date(d.includes("T") ? d : d + "T23:59:59");
}

function daysUntil(from, to) {
	return Math.ceil((parseDay(to) - parseDay(from)) / 86400000);
}

function clamp(n, a, b) {
	return Math.max(a, Math.min(b, n));
}

function noteId(notes, key) {
	if (!notes) return null;
	const m = String(notes).match(new RegExp(key + "=([^\\s,;]+)"));
	return m ? m[1] : null;
}

function meanShiftHours(detail) {
	const hs = detail.earnings.map((e) => Number(e.hours)).filter((h) => h > 0);
	return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 8;
}

function advancesAsOf(detail, asOf) {
	const end = parseDay(asOf);
	return detail.advances.filter((a) => {
		if (parseDay(a.at) > end) return false;
		if (a.status === "cancelled") return false;
		if (a.status === "outstanding") return true;
		if (a.status === "repaid" && a.repaid_at && parseDay(a.repaid_at) > end) return true; // still owed as-of
		return false;
	});
}

function paidObligationIds(detail, asOf, y, m) {
	const end = parseDay(asOf);
	const ids = new Set();
	for (const t of detail.transactions) {
		const ts = parseDay(t.ts);
		if (ts > end || t.dir !== "debit") continue;
		if (ts.getFullYear() !== y || ts.getMonth() !== m) continue;
		const oid = noteId(t.notes, "obligation_id");
		if (oid) ids.add(oid);
	}
	return ids;
}

function depositedEarnings(detail, asOf) {
	const end = parseDay(asOf);
	const ids = new Set();
	for (const t of detail.transactions) {
		if (parseDay(t.ts) > end || t.dir !== "credit") continue;
		const eid = noteId(t.notes, "linked_earnings_id");
		if (eid) ids.add(eid);
	}
	return ids;
}

/** Variable essential burn — excludes obligation categories already reserved separately */
function essentialBurn(detail, asOf, lookback = 28) {
	const end = parseDay(asOf);
	const start = new Date(end);
	start.setDate(start.getDate() - lookback);
	const skip = new Set(["housing", "utilities", "phone", "debt_payment", "childcare", "insurance"]);
	let sum = 0;
	let first = null;
	let last = null;
	for (const t of detail.transactions) {
		const ts = parseDay(t.ts);
		if (ts < start || ts > end) continue;
		if (t.dir !== "debit" || !t.essential) continue;
		if (skip.has(t.category) || noteId(t.notes, "obligation_id")) continue;
		sum += t.amount;
		if (!first || ts < first) first = ts;
		if (!last || ts > last) last = ts;
	}
	if (!first) return 0;
	const covered = Math.max(1, Math.ceil((last - first) / 86400000) + 1);
	const days = Math.min(lookback, covered);
	return sum / days;
}

/** True running balance from last txn at/before asOf; weekly ending only as completed-week check */
function latestBalance(detail, asOf) {
	const end = parseDay(asOf);
	let lastBal = null;
	for (const t of detail.transactions) {
		const ts = parseDay(t.ts);
		if (ts > end) continue;
		if (t.balance != null && Number.isFinite(Number(t.balance))) lastBal = Number(t.balance);
	}
	if (lastBal != null) return lastBal;
	// completed week only: week_start + 6d <= asOf
	let weekBal = null;
	let best = -Infinity;
	for (const w of detail.weeks) {
		const start = parseDay(w.week);
		const endWeek = new Date(start);
		endWeek.setDate(endWeek.getDate() + 6);
		if (endWeek > end) continue;
		if (start.getTime() > best && w.balance != null) {
			best = start.getTime();
			weekBal = w.balance;
		}
	}
	return weekBal != null ? weekBal : 0;
}

function upcomingObligations(detail, asOf, horizonDays = 21) {
	const base = parseDay(asOf);
	const y = base.getFullYear();
	const m = base.getMonth();
	const paid = paidObligationIds(detail, asOf, y, m);
	const out = [];
	for (const o of detail.obligations) {
		const steps = o.freq === "biweekly" ? 3 : 2;
		for (let i = 0; i < steps; i++) {
			let due;
			if (o.freq === "biweekly") {
				due = new Date(y, m, Math.min(o.due_day, 28), 12);
				due.setDate(due.getDate() + i * 14);
			} else {
				due = new Date(y, m + i, Math.min(o.due_day, 28), 12);
			}
			const delta = Math.ceil((due - base) / 86400000);
			if (delta < 0 || delta >= horizonDays) continue; // exclusive upper bound — avoid double rent
			const oid = o.obligation_id || o.name;
			if (delta === 0 && (paid.has(oid) || [...paid].some((id) => String(o.name).toLowerCase().includes("rent") && noteMatchesRent(detail, asOf, o)))) continue;
			out.push({ ...o, dueDate: due.toISOString().slice(0, 10), days: delta });
		}
	}
	// de-dupe same category+amount in window (prefer sooner)
	const seen = new Set();
	const deduped = [];
	for (const o of out.sort((a, b) => a.days - b.days)) {
		const k = `${o.category}|${o.amount}|${o.due_day}`;
		if (seen.has(k)) continue;
		seen.add(k);
		deduped.push(o);
	}
	return deduped;
}

function noteMatchesRent(detail, asOf, o) {
	const end = parseDay(asOf);
	const y = end.getFullYear();
	const m = end.getMonth();
	for (const t of detail.transactions) {
		const ts = parseDay(t.ts);
		if (ts > end || t.dir !== "debit") continue;
		if (ts.getFullYear() !== y || ts.getMonth() !== m) continue;
		if (t.category === o.category && Math.abs(t.amount - o.amount) < 0.02) return true;
	}
	return false;
}

function projectedIncome(detail, asOf, days) {
	const end = parseDay(asOf);
	const start = new Date(end);
	start.setDate(start.getDate() - 42);
	const nets = detail.earnings.filter((e) => {
		const d = parseDay(e.date);
		return d >= start && d <= end;
	}).map((e) => e.net);
	const mean = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : Number(detail.profile.typical_daily_net_cad || 150);
	const spanDays = Math.max(7, Math.min(42, Math.ceil((end - start) / 86400000)));
	const weeks = spanDays / 7;
	const workDaysPerWeek = nets.length ? clamp(nets.length / weeks, 1.5, 6) : 0;
	const dailyExpect = (mean * workDaysPerWeek) / 7;
	return { meanShift: mean, dailyExpect, projected: dailyExpect * days, workDaysPerWeek };
}

function pendingPay(detail, asOf) {
	const end = parseDay(asOf);
	const deposited = depositedEarnings(detail, asOf);
	// also match by amount+date when notes lack id
	const landed = new Set();
	for (const t of detail.transactions) {
		if (parseDay(t.ts) > end || t.dir !== "credit") continue;
		landed.add(`${t.ts.slice(0, 10)}|${Number(t.amount).toFixed(2)}`);
	}
	let pending = 0;
	for (const e of detail.earnings) {
		if (e.same_day) continue;
		const d = parseDay(e.date);
		const lag = Math.ceil((end - d) / 86400000);
		if (lag < 0 || lag > 3) continue;
		const eid = e.earnings_id || e.id;
		if (eid && deposited.has(eid)) continue;
		// heuristic: deposit already present with same net within lag window
		let found = false;
		for (let k = 0; k <= lag + 1; k++) {
			const day = new Date(d);
			day.setDate(day.getDate() + k);
			const key = `${day.toISOString().slice(0, 10)}|${Number(e.net).toFixed(2)}`;
			if (landed.has(key)) { found = true; break; }
		}
		if (found) continue;
		pending += e.net * (lag === 0 ? 0.85 : lag === 1 ? 0.55 : 0.25);
	}
	return pending;
}

/**
 * SafeSpend: spendable today after reserves + volatility buffer.
 */
function computeSafeSpend(detail, card, asOf) {
	const thin = !detail.transactions.length && !detail.earnings.length;
	if (thin) {
		return {
			safe: 0, bal: 0, burn: 0, reserved: 0, volBuf: 0, pending: 0, outstanding: 0,
			bufferDays: 0, tone: "unknown", thin: true, obs: upcomingObligations(detail, asOf, 14),
			breakdown: [{ label: "No ledger for this worker", value: 0 }],
			raw: 0,
		};
	}
	const bal = latestBalance(detail, asOf);
	const burn = essentialBurn(detail, asOf);
	const obs = upcomingObligations(detail, asOf, 14);
	// skip obligations already paid today/this morning
	const unpaid = obs.filter((o) => {
		if (o.days > 0) return true;
		return !noteMatchesRent(detail, asOf, o);
	});
	const reserved = unpaid.filter((o) => o.essential).reduce((s, o) => {
		const weight = o.days <= 1 ? 1 : o.days <= 4 ? 0.92 : o.days <= 7 ? 0.78 : 0.5;
		return s + o.amount * weight;
	}, 0);
	const vol = Number(card.volatility || detail.profile.income_volatility || 0.35);
	const daily = Number(card.typical_daily_net || detail.profile.typical_daily_net_cad || 150);
	const volBuf = daily * (1.2 + vol * 2.5);
	const pending = pendingPay(detail, asOf);
	const rentBurden = detail.profile.rent_burden_band || card.rent_burden;
	const burdenMul = rentBurden === "severe" ? 1.15 : rentBurden === "high" ? 1.08 : 1;
	const owed = detail.advances.filter((a) => a.status === "outstanding" && parseDay(a.at) <= parseDay(asOf)).reduce((s, a) => s + a.amount + a.fee, 0);
	const raw = bal + pending - reserved * burdenMul - volBuf - owed;
	const capped = Math.min(raw, daily * 3); // don't call multi-week savings "safe to spend today"
	const safe = Math.max(0, Math.floor(capped));
	const bufferDays = burn > 1 ? Math.max(0, Math.min(90, (bal - reserved * 0.5) / burn)) : (bal > reserved ? 30 : 0);
	let tone = "ok";
	if (safe < 25 || bufferDays < 3 || raw < 0) tone = "danger";
	else if (safe < 80 || bufferDays < 8) tone = "amber";
	const breakdown = [
		{ label: "Ledger balance", value: bal },
		{ label: "Pending / lagging pay", value: pending },
		{ label: "Reserved obligations (14d)", value: -reserved * burdenMul },
		{ label: "Volatility buffer", value: -volBuf },
		{ label: "Outstanding advances", value: -owed },
	];
	if (raw < 0) breakdown.push({ label: "Shortfall (hidden by $0 floor)", value: raw });
	return { safe, bal, burn, reserved, volBuf, pending, outstanding: owed, bufferDays, tone, obs: unpaid, breakdown, raw, thin: false };
}

function checkPurchase(safe, amount, essential) {
	const a = Number(amount);
	if (!(a > 0)) return { tone: "amber", message: "Enter an amount." };
	if (safe <= 0) return { tone: "danger", message: `RED — SafeSpend is $0. Earn or wait before spending ${CAD2(a)}.` };
	if (essential) {
		if (a <= safe) return { tone: "ok", message: `GREEN — essential ${CAD2(a)} fits inside SafeSpend.` };
		if (a <= safe * 1.25) return { tone: "amber", message: `YELLOW — essential, but stretches past SafeSpend. Prefer a short shift first.` };
		return { tone: "danger", message: `RED — ${CAD2(a)} blows runway. Look at Rent Gap before advancing.` };
	}
	if (a <= safe * 0.55) return { tone: "ok", message: `GREEN — discretionary ${CAD2(a)} is inside today's SafeSpend.` };
	if (a <= safe) return { tone: "amber", message: `YELLOW — spends most of today's SafeSpend (${CAD(safe)}).` };
	return { tone: "danger", message: `RED — ${CAD2(a)} exceeds SafeSpend ${CAD(safe)}. Skip or earn first.` };
}

function rentGap(detail, card, asOf, acc = null) {
	const bal = (acc && acc.p3 && acc.p3.bal != null) ? acc.p3.bal : latestBalance(detail, asOf);
	const obsFull = upcomingObligations(detail, asOf, 30);
	const rent = obsFull.find((o) => o.category === "housing") || detail.obligations.find((o) => o.category === "housing");
	const days = rent && rent.days != null ? rent.days : rent ? daysUntil(asOf, nextDue(asOf, rent.due_day)) : 15;
	const earnDays = Math.max(days, 0);
	// compare apples-to-apples: essentials due by rent day vs income until then
	const obs = obsFull.filter((o) => o.days <= earnDays);
	const proj = (acc && acc.p1 && earnDays === 14) ? { ...acc.p1, projected: acc.p1.dailyExpect * earnDays } : projectedIncome(detail, asOf, earnDays);
	const essentials = obs.filter((o) => o.essential).reduce((s, o) => s + o.amount, 0);
	const usableIncome = earnDays === 0 ? 0 : proj.projected * (earnDays <= 3 ? 0.65 : 0.9);
	const available = bal + usableIncome;
	const gap = essentials - available;
	const shiftsNeeded = gap > 0 ? Math.ceil(gap / (proj.meanShift || 150)) : 0;
	let tone = "ok";
	if (gap > 200 || (rent && days <= 5 && gap > 0)) tone = "danger";
	else if (gap > 0 || (rent && days <= 10)) tone = "amber";
	return { rent, days, gap, available, essentials, proj, shiftsNeeded, tone, obs: obsFull, bal };
}

function nextDue(asOf, dueDay) {
	const b = parseDay(asOf);
	let d = new Date(b.getFullYear(), b.getMonth(), Math.min(dueDay, 28), 12);
	if (d < b) d = new Date(b.getFullYear(), b.getMonth() + 1, Math.min(dueDay, 28), 12);
	return d.toISOString().slice(0, 10);
}

function bufferSimulate(safePack, detail, card, { extraShifts = 0, skipAdv = true, cutPct = 0 }, asOf) {
	const mean = card.mean_net || card.typical_daily_net || 150;
	const burn = Math.max(0.01, safePack.burn * (1 - cutPct / 100));
	let bal = safePack.bal + extraShifts * mean;
	if (skipAdv) {
		const fees = detail.advances.filter((a) => a.status === "outstanding" && (!asOf || parseDay(a.at) <= parseDay(asOf))).reduce((s, a) => s + a.fee, 0);
		if (fees > 0) bal += fees; // only credit real avoided fees
	}
	const reserved = safePack.reserved * 0.5;
	const days = burn > 1 ? (bal - reserved) / burn : (bal > reserved ? 30 : 0);
	return { days: Math.max(0, Math.min(90, days)), bal, burn };
}

function shiftROI(detail, asOf) {
	const end = parseDay(asOf);
	const rows = [];
	for (const e of detail.earnings) {
		const d = parseDay(e.date);
		if (d > end) continue;
		const day = e.date;
		let burn = 0;
		for (const t of detail.transactions) {
			if (t.dir !== "debit") continue;
			if (!t.ts.startsWith(day)) continue;
			if (noteId(t.notes, "obligation_id")) continue; // monthly bills aren't "shift burn"
			if (["transit", "food_out", "groceries"].includes(t.category)) burn += t.amount;
		}
		const cappedBurn = Math.min(burn, e.net * 0.85); // don't paint a whole childcare bill as one shift
		rows.push({ date: e.date, shift: e.shift, net: e.net, burn: cappedBurn, allIn: e.net - cappedBurn, method: e.method, employer: e.employer });
	}
	return rows.slice(-18).reverse();
}

function advanceAdvice(detail, card, asOf) {
	const end = asOf ? parseDay(asOf) : null;
	const hrs = meanShiftHours(detail);
	const mean = card.mean_net || card.typical_daily_net || 150;
	return detail.advances
		.filter((a) => !end || parseDay(a.at) <= end)
		.slice()
		.reverse()
		.slice(0, 6)
		.map((a) => {
			const shifts = Math.ceil((a.amount + a.fee) / mean);
			const feeShifts = a.fee / mean;
			const feeMin = feeShifts * hrs * 60;
			let apr = null;
			if (a.repaid_at && a.amount > 0) {
				const days = Math.max(0.5, (parseDay(a.repaid_at) - parseDay(a.at)) / 86400000);
				apr = (a.fee / a.amount) * (365 / days) * 100;
			}
			const aprLine = apr != null ? ` · ~${Math.round(apr)}% APR` : "";
			return {
				...a,
				shiftsEquiv: shifts,
				feeAsShiftFraction: feeShifts,
				apr,
				alt: a.fee > 0
					? `Fee ${CAD2(a.fee)} ≈ ${feeMin.toFixed(0)} min of your average ${hrs.toFixed(1)}h shift${aprLine}. Wait for same-day pay or one ${card.occupation?.split(" ")[0] || "extra"} shift.`
					: `Zero-fee advance — still ${shifts} shift-equivalent liquidity.`,
			};
		});
}

function peerCompare(card, peerStats) {
	const key = `${card.occupation}|${card.rent_burden}|${card.pay_type}`;
	const pool = peerStats[key];
	if (!pool || pool.n < 3) {
		return { key, pool: pool || { n: 0, buffer_median: null, advances_mean: 0, fees_mean: 0, typical_net_mean: card.typical_daily_net }, bufDelta: 0, feeDelta: 0, thin: true };
	}
	const bufDelta = (card.buffer_median ?? pool.buffer_median) - pool.buffer_median;
	const feeDelta = (card.advance_fees || 0) - (pool.fees_mean || 0);
	return { key, pool, bufDelta, feeDelta, thin: false };
}

function pocketSplit(detail, asOf) {
	const end = parseDay(asOf);
	const pots = { cash: 0, payroll_card: 0, etransfer: 0, direct_deposit: 0, prepaid: 0, debit: 0 };
	let last = latestBalance(detail, asOf);
	const flows = { cash: 0, payroll_card: 0, etransfer: 0, direct_deposit: 0, prepaid: 0, debit: 0 };
	for (const t of detail.transactions) {
		if (parseDay(t.ts) > end) continue;
		const ch = t.channel || "debit";
		if (t.dir === "credit") flows[ch] = (flows[ch] || 0) + t.amount;
		else flows[ch] = (flows[ch] || 0) + t.amount; // show absolute debit flow per channel
	}
	Object.assign(pots, flows);
	const total = Object.values(pots).reduce((a, b) => a + Math.max(0, b), 0) || 1;
	const spendable = Math.max(0, last);
	return { pots, last, spendable, total };
}

async function runPipeline(ctx, onPass) {
	const passes = [
		{ id: 1, title: "Income forecast", run: () => projectedIncome(ctx.detail, ctx.asOf, 14) },
		{ id: 2, title: "Obligation schedule", run: () => upcomingObligations(ctx.detail, ctx.asOf, 21) },
		{ id: 3, title: "SafeSpend core", run: (acc) => {
			const pack = computeSafeSpend(ctx.detail, ctx.card, ctx.asOf);
			// feed pass-2 schedule into pack when available
			if (acc.p2) pack.obsFromPass2 = acc.p2;
			if (acc.p1) pack.forecast = acc.p1;
			return pack;
		} },
		{ id: 4, title: "Rent Gap radar", run: (acc) => rentGap(ctx.detail, ctx.card, ctx.asOf, acc) },
		{ id: 5, title: "Peer pool compare", run: (acc) => {
			const cmp = peerCompare(ctx.card, ctx.peerStats);
			cmp.safeTone = acc.p3?.tone;
			cmp.gap = acc.p4?.gap;
			return cmp;
		} },
		{ id: 6, title: "Spoken briefing", run: (acc) => synthesizeBriefing(ctx, acc) },
	];
	const acc = {};
	for (const p of passes) {
		await onPass(p, "active", null);
		await sleep(420);
		const result = p.run(acc);
		acc[`p${p.id}`] = result;
		await onPass(p, "done", result);
	}
	return acc;
}

function synthesizeBriefing(ctx, acc) {
	const s = acc.p3;
	const g = acc.p4;
	const peer = acc.p5;
	if (!s || !g || !peer) return { text: "Pipeline incomplete — re-run analysis." };
	const name = ctx.card.occupation;
	const city = ctx.card.city;
	const gapLine = g.gap > 0
		? `Rent gap radar sees you short ${CAD(g.gap)} before the next housing hit — about ${g.shiftsNeeded} shifts at your mean net.`
		: `Rent gap radar is clear — projected income covers essentials in the next window.`;
	const peerLine = peer.thin
		? `Peer pool is too thin for a fair compare (n=${peer.pool.n}).`
		: peer.bufDelta >= 0
			? `You hold ${peer.bufDelta.toFixed(1)} more buffer days than peers in ${name} with ${ctx.card.rent_burden} rent burden.`
			: `Peers like you average ${((-peer.bufDelta).toFixed(1))} more buffer days — tighten discretionary or add a shift.`;
	const buf = Number.isFinite(s.bufferDays) ? s.bufferDays.toFixed(1) : "0";
	return {
		text: `${city} ${name}: SafeSpend today is ${CAD(s.safe)}. ${gapLine} ${peerLine} Buffer runway ≈ ${buf} days at essential burn.`,
		workerId: ctx.card.id,
		asOf: ctx.asOf,
	};
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

window.DSEngine = {
	CAD, CAD2, parseDay, advancesAsOf, essentialBurn, latestBalance, upcomingObligations,
	projectedIncome, pendingPay, computeSafeSpend, checkPurchase, rentGap, bufferSimulate,
	shiftROI, advanceAdvice, peerCompare, pocketSplit, runPipeline,
};
})();
