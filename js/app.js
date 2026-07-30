const E = window.DSEngine;
const C = window.DSCharts;
const CAD = E.CAD;
const CAD2 = E.CAD2;
const computeSafeSpend = E.computeSafeSpend;
const checkPurchase = E.checkPurchase;
const rentGap = E.rentGap;
const bufferSimulate = E.bufferSimulate;
const shiftROI = E.shiftROI;
const advanceAdvice = E.advanceAdvice;
const peerCompare = E.peerCompare;
const pocketSplit = E.pocketSplit;
const runPipeline = E.runPipeline;
const drawRing = C.drawRing;
const drawGauge = C.drawGauge;
const drawTimeline = C.drawTimeline;
const drawWeeks = C.drawWeeks;
const drawFees = C.drawFees;
const drawPeers = C.drawPeers;
// Three.js loads only over http(s) — file:// gets full 2D app without WebGL

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
	bundle: null,
	workerId: "W-0001",
	asOf: "2026-04-27",
	hero3d: null,
	flow3d: null,
	txnFilter: "all",
	createHeroScene: null,
	createFlowScene: null,
	_pipelineRunning: false,
	_demoRunning: false,
	_flowWorker: null,
	_bundleKB: null,
	_briefingMeta: null,
};

function setLoader(msg, isError = false) {
	const loader = $("#loader");
	const p = loader?.querySelector("[data-loader-msg]") || loader?.querySelector("p");
	if (p) p.textContent = msg;
	if (isError) {
		loader?.classList.add("error");
		window.__DAYSHIFT_BOOTED = true;
		const hint = $("#loaderHint");
		if (hint) {
			hint.innerHTML = location.protocol === "file:"
				? "Ensure <code>data/bundle.js</code> exists — run <code>python3 scripts/build_bundle.py</code>"
				: "Ensure <code>data/bundle.json</code> is next to <code>index.html</code>, then hard-refresh (Cmd+Shift+R).";
		}
	}
}

function hideLoader() {
	$("#loader")?.classList.add("hide");
	window.__DAYSHIFT_BOOTED = true;
}

function toast(msg) {
	const el = $("#toast");
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(toast._t);
	toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

let audioCtx = null;
function blip(kind = "ok") {
	try {
		audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
		if (audioCtx.state === "suspended") audioCtx.resume();
		const o = audioCtx.createOscillator();
		const g = audioCtx.createGain();
		o.type = "triangle";
		o.frequency.value = kind === "ok" ? 523 : kind === "amber" ? 392 : 220;
		g.gain.value = 0.04;
		o.connect(g);
		g.connect(audioCtx.destination);
		o.start();
		g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
		o.stop(audioCtx.currentTime + 0.2);
	} catch (_) {}
}

function animateCount(el, to, ms = 700) {
	if (!el) return;
	if (el._raf) cancelAnimationFrame(el._raf);
	const from = Number(String(el.textContent).replace(/[^0-9.-]/g, "")) || 0;
	const t0 = performance.now();
	const step = (t) => {
		const p = Math.min(1, (t - t0) / ms);
		const eased = 1 - Math.pow(1 - p, 3);
		el.textContent = CAD(Math.round(from + (to - from) * eased));
		if (p < 1) el._raf = requestAnimationFrame(step);
		else { el.textContent = CAD(to); el._raf = 0; }
	};
	el._raf = requestAnimationFrame(step);
}

async function loadBundle() {
	if (window.__DAYSHIFT_BUNDLE__) return window.__DAYSHIFT_BUNDLE__;
	if (location.protocol === "file:") {
		throw new Error("Missing data/bundle.js — run: python3 scripts/build_bundle.py");
	}
	const candidates = [
		new URL("data/bundle.json", document.baseURI).href,
		"data/bundle.json",
	];
	let lastErr = null;
	for (const url of candidates) {
		try {
			const res = await fetch(url, { cache: "no-store" });
			if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
			return await res.json();
		} catch (e) {
			lastErr = e;
		}
	}
	throw new Error(
		`Could not load data/bundle.json (${lastErr?.message || lastErr}). ` +
		"Check that data/bundle.json is deployed next to index.html (GitHub Pages root)."
	);
}

async function loadViz3d() {
	if (location.protocol === "file:") return false;
	try {
		const mod = await import("./viz3d.js");
		state.createHeroScene = mod.createHeroScene;
		state.createFlowScene = mod.createFlowScene;
		return true;
	} catch (e) {
		console.warn("3D unavailable (CDN/WebGL). UI still works.", e);
		return false;
	}
}

function cardOf(id) {
	return state.bundle.cards.find((c) => c.id === id);
}

function ensureDetail(id) {
	if (state.bundle.detail[id]) return state.bundle.detail[id];
	const c = cardOf(id);
	const synth = {
		profile: {
			worker_id: c.id, city: c.city, occupation: c.occupation, pay_type: c.pay_type,
			typical_daily_net_cad: String(c.typical_daily_net), income_volatility: String(c.volatility),
			tip_share: String(c.tip_share), household_size: String(c.household_size),
			dependents: String(c.dependents), rent_burden_band: c.rent_burden, commute_mode: c.commute,
		},
		earnings: [],
		transactions: [],
		obligations: c.rent
			? [{ name: "Rent", category: "housing", amount: c.rent, freq: "monthly", due_day: 1, autopay: false, essential: true }]
			: [],
		advances: [],
		weeks: [],
	};
	state.bundle.detail[id] = synth;
	return synth;
}

function fillWorkerSelect() {
	const sel = $("#workerSelect");
	const spotlight = new Set(state.bundle.meta.spotlight);
	const cards = [...state.bundle.cards].sort((a, b) => {
		const as = spotlight.has(a.id) ? 0 : 1;
		const bs = spotlight.has(b.id) ? 0 : 1;
		return as - bs || a.id.localeCompare(b.id);
	});
	const full = cards.filter((c) => spotlight.has(c.id));
	const thin = cards.filter((c) => !spotlight.has(c.id));
	sel.innerHTML =
		`<optgroup label="★ Full ledger">${full.map((c) => `<option value="${c.id}">★ ${c.id} · ${c.occupation} · ${c.city}</option>`).join("")}</optgroup>` +
		`<optgroup label="Summary only">${thin.map((c) => `<option value="${c.id}">${c.id} · ${c.occupation} · ${c.city}</option>`).join("")}</optgroup>`;
	sel.value = state.workerId;
	sel.addEventListener("change", () => {
		state.workerId = sel.value;
		renderAll();
		toast(`Switched to ${state.workerId}`);
	});
}

function renderStrip() {
	const cards = state.bundle.cards;
	$("#statWorkers").textContent = cards.length;
	$("#statShifts").textContent = cards.reduce((s, c) => s + c.shifts, 0).toLocaleString();
	$("#statAdvances").textContent = cards.reduce((s, c) => s + c.advances, 0).toLocaleString();
	$("#statFees").textContent = CAD(cards.reduce((s, c) => s + c.advance_fees, 0));
	const bufs = cards.map((c) => c.buffer_median).filter((x) => x != null);
	const med = bufs.sort((a, b) => a - b)[Math.floor(bufs.length / 2)];
	$("#statBuffer").textContent = med != null ? med.toFixed(1) : "—";
}

function renderCockpit() {
	const card = cardOf(state.workerId);
	const detail = ensureDetail(state.workerId);
	const pack = computeSafeSpend(detail, card, state.asOf);
	state._safe = pack;
	state._card = card;
	state._detail = detail;

	animateCount($("#safeAmount"), pack.safe);
	animateCount($("#heroSafeVal"), pack.safe);
	if (state._lastTone && state._lastTone !== pack.tone) blip(pack.tone === "unknown" ? "amber" : pack.tone);
	state._lastTone = pack.tone;
	$("#heroSafeSub").textContent = `${card.occupation} · ${card.city}`;
	$("#safeExplain").textContent = pack.thin
		? "Summary-only worker — pick a ★ spotlight persona for a full ledger."
		: pack.safe < 40
			? "Near-zero discretionary. Protect essentials and check Rent Gap."
			: `After locking bills + a ${Math.round(card.volatility * 100)}% volatility buffer, this is spendable today.`;
	const pill = $("#verdictPill");
	pill.dataset.tone = pack.tone === "unknown" ? "amber" : pack.tone;
	pill.textContent = pack.tone === "ok" ? "GREEN · STABLE" : pack.tone === "amber" ? "AMBER · TIGHT" : pack.tone === "unknown" ? "SUMMARY · NO LEDGER" : "RED · PROTECT";

	$("#reservedVal").textContent = CAD(pack.reserved);
	$("#volBufVal").textContent = CAD(pack.volBuf);
	$("#pendingVal").textContent = CAD(pack.pending);
	const denom = Math.max(pack.bal, pack.reserved, pack.volBuf, 1);
	$("#reservedBar").style.width = `${Math.min(100, (pack.reserved / denom) * 100)}%`;
	$("#volBufBar").style.width = `${Math.min(100, (pack.volBuf / denom) * 100)}%`;
	$("#pendingBar").style.width = `${Math.min(100, (pack.pending / denom) * 100)}%`;

	$("#breakdownList").innerHTML = pack.breakdown
		.map((b) => `<div><span>${b.label}</span><span>${b.value >= 0 ? CAD2(b.value) : "−" + CAD2(Math.abs(b.value))}</span></div>`)
		.join("");

	$("#personaName").textContent = `${card.occupation}`;
	$("#personaMeta").textContent = `${card.city}, AB · ${card.pay_type} pay · rent burden ${card.rent_burden}`;
	$("#personaStats").innerHTML = [
		["Typical daily net", CAD2(card.typical_daily_net)],
		["Income volatility", `${Math.round(card.volatility * 100)}%`],
		["Household / dependents", `${card.household_size} / ${card.dependents}`],
		["Wage advances", `${card.advances} · fees ${CAD2(card.advance_fees)}`],
		["Median buffer days", card.buffer_median != null ? card.buffer_median.toFixed(1) : "n/a"],
		["Commute", card.commute],
	]
		.map(([k, v]) => `<li><span>${k}</span><strong>${v}</strong></li>`)
		.join("");
	$("#cityBadge").textContent = `${card.city.toUpperCase()} · ${card.has_bank ? "BANKED" : "UNDERBANKED"}${card.prepaid ? " · PREPAID" : ""}${card.side_gig ? " · SIDE GIG" : ""}`;

	drawRing($("#ringCanvas"), pack.safe, Math.max(160, card.typical_daily_net));
	try {
		state.hero3d?.setSafeLevel?.(pack.safe, Math.max(160, card.typical_daily_net));
	} catch (_) {}
}

function renderBuyBar() {
	const run = () => {
		const amount = $("#buyAmount").value;
		const essential = ["groceries", "transit", "childcare"].includes($("#buyCategory").value);
		const res = checkPurchase(state._safe.safe, amount, essential);
		const el = $("#buyResult");
		el.dataset.tone = res.tone;
		el.textContent = res.message;
		blip(res.tone);
		if (res.tone === "ok") sprayConfetti();
	};
	$("#runBuyCheck").onclick = run;
	$("#buyAmount").onkeydown = (e) => { if (e.key === "Enter") run(); };
	$("#buyCategory").onchange = () => { if ($("#buyResult").textContent) run(); };
}

function renderRadar() {
	const gap = rentGap(state._detail, state._card, state.asOf);
	state._gap = gap;
	const badge = $("#gapBadge");
	badge.dataset.tone = gap.tone;
	badge.textContent =
		gap.gap > 0 ? `SHORT ${CAD(gap.gap)}` : gap.tone === "amber" ? "WATCH WINDOW" : "COVERED";
	drawTimeline($("#timelineCanvas"), gap, state.asOf);
	$("#obligationList").innerHTML = gap.obs
		.map(
			(o) => `<li>
			<span>${o.name}<br><span class="due">in ${o.days}d · day ${o.due_day}${o.autopay ? " · autopay" : ""}</span></span>
			<span class="amt">${CAD2(o.amount)}</span>
		</li>`
		)
		.join("") || "<li>No obligations in horizon</li>";
	$("#gapCallout").innerHTML =
		gap.gap > 0
			? `<strong>${CAD(gap.gap)} short</strong><p style="margin:0.4rem 0 0;color:var(--ink-dim);font-size:0.9rem">Projected available ${CAD(gap.available)} vs essentials ${CAD(gap.essentials)} before the next housing/bill cluster.</p>`
			: `<strong style="color:var(--ok)">On track</strong><p style="margin:0.4rem 0 0;color:var(--ink-dim);font-size:0.9rem">Projected earnings + balance cover essentials in this window.</p>`;
	$("#shiftTarget").innerHTML =
		gap.shiftsNeeded > 0
			? `<h3 style="margin:0 0 0.4rem;font-family:var(--font-display)">Shift target</h3>
			<p style="margin:0;color:var(--ink-dim)">Pick up <strong style="color:var(--amber)">${gap.shiftsNeeded}</strong> more shifts @ ~${CAD2(gap.proj.meanShift)} mean net to close the gap. Work-days/week pattern ≈ ${gap.proj.workDaysPerWeek.toFixed(1)}.</p>`
			: `<h3 style="margin:0 0 0.4rem;font-family:var(--font-display)">Shift target</h3><p style="margin:0;color:var(--ink-dim)">No extra shifts required for the obligation window — maintain pace.</p>`;
}

function renderBuffer() {
	const days = state._safe.bufferDays;
	$("#bufferDays").textContent = state._safe.thin ? "—" : days > 90 ? "90+" : days.toFixed(1);
	drawGauge($("#gaugeCanvas"), state._safe.thin ? 0 : days);
	drawWeeks($("#weekCanvas"), state._detail.weeks);

	const updateSim = () => {
		const extra = Number($("#simShifts").value);
		const cut = Number($("#simCut").value);
		$("#simShiftsVal").textContent = extra;
		$("#simCutVal").textContent = cut + "%";
		const sim = bufferSimulate(state._safe, state._detail, state._card, {
			extraShifts: extra,
			skipAdv: $("#simSkipAdv").checked,
			cutPct: cut,
		}, state.asOf);
		const delta = sim.days - days;
		$("#simResult").textContent = state._safe.thin
			? "Pick a ★ spotlight worker to simulate runway."
			: `Simulated runway: ${sim.days.toFixed(1)} days (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}) · balance proxy ${CAD(sim.bal)}`;
	};
	$("#simShifts").oninput = updateSim;
	$("#simCut").oninput = updateSim;
	$("#simSkipAdv").onchange = updateSim;
	updateSim();
}

function renderShifts() {
	const rows = shiftROI(state._detail, state.asOf);
	$("#shiftTable tbody").innerHTML = rows
		.map(
			(r) => `<tr>
			<td>${r.date.slice(5)}</td><td>${r.shift}</td>
			<td class="pos">${CAD2(r.net)}</td><td class="neg">${CAD2(r.burn)}</td>
			<td class="${r.allIn >= 0 ? "pos" : "neg"}">${CAD2(r.allIn)}</td>
			<td>${r.method}</td>
		</tr>`
		)
		.join("") || `<tr><td colspan="6">No shift history in spotlight pack — pick a ★ worker.</td></tr>`;

	const adv = advanceAdvice(state._detail, state._card, state.asOf);
	$("#advancePanel").innerHTML = adv.length
		? adv
				.map(
					(a) => `<div class="adv-item">
				<header><strong>${a.reason.replaceAll("_", " ")}</strong><span class="fee">${CAD2(a.amount)} + ${CAD2(a.fee)} fee</span></header>
				<div class="adv-alt">${a.alt}</div>
				<div class="adv-alt" style="margin-top:0.25rem">${a.status} · ${a.at.slice(0, 10)} · ≈ ${a.shiftsEquiv} shifts liquidity${a.apr != null ? ` · ~${Math.round(a.apr)}% APR` : ""}</div>
			</div>`
				)
				.join("")
		: `<div class="adv-item"><div class="adv-alt">No earned-wage advances for this worker as of ${state.asOf}.</div></div>`;
	drawFees($("#feeCanvas"), adv.length ? state._detail.advances.filter((a) => new Date(a.at) <= new Date(state.asOf + "T23:59:59")) : []);
}

function renderPeers() {
	const cmp = peerCompare(state._card, state.bundle.peer_stats);
	$("#peerYou").innerHTML = `<h3>You</h3>
		<div class="stat"><span>Buffer days</span><strong>${state._card.buffer_median ?? "—"}</strong></div>
		<div class="stat"><span>Advances</span><strong>${state._card.advances}</strong></div>
		<div class="stat"><span>Fees paid</span><strong>${CAD2(state._card.advance_fees)}</strong></div>
		<div class="stat"><span>Typical daily net</span><strong>${CAD2(state._card.typical_daily_net)}</strong></div>
		<div class="peer-delta ${cmp.bufDelta >= 0 ? "up" : "down"}">${cmp.thin ? "Pool too small for compare" : `${cmp.bufDelta >= 0 ? "▲" : "▼"} ${Math.abs(cmp.bufDelta).toFixed(1)} buffer days vs pool`}</div>`;
	$("#peerPool").innerHTML = `<h3>Pool · n=${cmp.pool.n}${cmp.thin ? " · thin" : ""}</h3>
		<div class="stat"><span>Median buffer</span><strong>${cmp.pool.buffer_median ?? "—"}</strong></div>
		<div class="stat"><span>Mean advances</span><strong>${cmp.pool.advances_mean ?? "—"}</strong></div>
		<div class="stat"><span>Mean fees</span><strong>${CAD2(cmp.pool.fees_mean || 0)}</strong></div>
		<div class="stat"><span>Mean daily net</span><strong>${CAD2(cmp.pool.typical_net_mean || 0)}</strong></div>
		<div class="peer-delta ${cmp.feeDelta <= 0 ? "up" : "down"}">${cmp.thin ? "Need n≥3 peers" : `Fee delta ${cmp.feeDelta >= 0 ? "+" : ""}${CAD2(cmp.feeDelta)} vs peers`}</div>`;
	drawPeers($("#peerCanvas"), state._card, state.bundle.cards);
	const same = state.bundle.cards.filter((c) => c.occupation === state._card.occupation).slice(0, 12);
	$("#peerCloud").innerHTML = same.map((c) => `<span>${c.city} · ${CAD(c.typical_daily_net)}</span>`).join("");
}

function renderLedger() {
	const pockets = pocketSplit(state._detail, state.asOf);
	const labels = [
		["Balance (as of)", pockets.spendable],
		["Cash / payroll card flow", Math.max(0, (pockets.pots.cash || 0) + (pockets.pots.payroll_card || 0))],
		["E-transfer flow", Math.max(0, pockets.pots.etransfer || 0)],
		["Direct deposit flow", Math.max(0, pockets.pots.direct_deposit || 0)],
	];
	$("#pocketRow").innerHTML = labels
		.map(([lbl, val]) => `<div class="pocket"><div class="lbl">${lbl}</div><div class="val">${CAD(val)}</div></div>`)
		.join("");

	const asOfEnd = new Date(state.asOf + "T23:59:59");
	const txns = [...state._detail.transactions].filter((t) => new Date(t.ts) <= asOfEnd).reverse();
	const filtered = txns.filter((t) => {
		if (state.txnFilter === "income") return t.dir === "credit";
		if (state.txnFilter === "essential") return t.dir === "debit" && t.essential;
		if (state.txnFilter === "discretionary") return t.dir === "debit" && !t.essential;
		return true;
	}).slice(0, 60);
	$("#txnList").innerHTML = filtered
		.map(
			(t) => `<li>
			<span class="cat">${t.category.replaceAll("_", " ")}</span>
			<span class="amt ${t.dir === "credit" ? "pos" : "neg"}">${t.dir === "credit" ? "+" : "−"}${CAD2(t.amount)}</span>
			<span class="meta">${t.ts.replace("T", " ")} · ${t.channel}${t.essential ? " · essential" : ""}</span>
		</li>`
		)
		.join("") || `<li><span class="cat">No transactions — choose a ★ spotlight worker for full ledger.</span></li>`;

	const needRebuild = state._flowWorker !== state.workerId || !state.flow3d;
	if (needRebuild) {
		if (state.flow3d) {
			state.flow3d.dispose();
			state.flow3d = null;
		}
		if (state.createFlowScene && state._detail.transactions.length) {
			try {
				state.flow3d = state.createFlowScene($("#flow3d"), state._detail.transactions);
				state._flowWorker = state.workerId;
				$(".flow-cap").textContent = "Cashflow field — credits rise, debits sink, essentials glow copper.";
			} catch (e) {
				console.warn("flow3d failed", e);
			}
		} else {
			state._flowWorker = state.workerId;
			const cap = $(".flow-cap");
			if (cap) cap.textContent = state._detail.transactions.length ? "3D unavailable — ledger list still works." : "No ledger — pick a ★ spotlight worker.";
		}
	}
}

function renderPipelineUI() {
	const names = [
		"Income forecast",
		"Obligation schedule",
		"SafeSpend core",
		"Rent Gap radar",
		"Peer pool compare",
		"Spoken briefing",
	];
	$("#passList").innerHTML = names
		.map(
			(t, i) => `<li data-pass="${i + 1}">
			<span class="n">0${i + 1}</span>
			<div><h4>${t}</h4><p>Waiting…</p></div>
			<span class="status">IDLE</span>
		</li>`
		)
		.join("");
	$("#briefing").textContent = "";
	state._briefingMeta = null;
}

async function onRunPipeline() {
	if (state._pipelineRunning) return;
	state._pipelineRunning = true;
	const btn = $("#runPipeline");
	if (btn) btn.disabled = true;
	renderPipelineUI();
	$("#briefing").textContent = "Running 6-pass forward-feeding analysis…";
	try {
		const acc = await runPipeline(
			{ detail: state._detail, card: state._card, asOf: state.asOf, peerStats: state.bundle.peer_stats },
			async (pass, status, result) => {
				const li = $(`#passList li[data-pass="${pass.id}"]`);
				if (!li) return;
				li.classList.toggle("active", status === "active");
				li.classList.toggle("done", status === "done");
				const st = li.querySelector(".status");
				if (st) st.textContent = status === "active" ? "RUNNING" : "DONE";
				if (status === "done" && result) {
					let summary = "Complete.";
					if (pass.id === 1) summary = `Daily expect ${CAD2(result.dailyExpect)} · mean shift ${CAD2(result.meanShift)}`;
					if (pass.id === 2) summary = `${result.length} obligations in 21-day horizon`;
					if (pass.id === 3) summary = `SafeSpend ${CAD(result.safe)} · tone ${result.tone}`;
					if (pass.id === 4) summary = result.gap > 0 ? `Gap ${CAD(result.gap)} · ${result.shiftsNeeded} shifts` : "Essentials covered";
					if (pass.id === 5) summary = result.thin ? `Pool thin (n=${result.pool.n})` : `Pool n=${result.pool.n} · buffer Δ ${result.bufDelta.toFixed(1)}`;
					if (pass.id === 6) summary = "Briefing synthesized";
					const p = li.querySelector("p");
					if (p) p.textContent = summary;
				}
			}
		);
		const text = acc.p6?.text || "Pipeline finished with no briefing.";
		$("#briefing").textContent = text;
		state._briefingMeta = { workerId: state.workerId, asOf: state.asOf, text };
		toast("Pipeline complete");
		return text;
	} catch (e) {
		console.error(e);
		$("#briefing").textContent = `Pipeline error: ${e.message || e}`;
		toast("Pipeline failed");
	} finally {
		state._pipelineRunning = false;
		if (btn) btn.disabled = false;
	}
}

function wireDialog() {
	const dlg = $("#buyDialog");
	const form = $("#buyForm");
	$("#checkBuyBtn").onclick = () => {
		if (dlg.open) return;
		$("#dlgVerdict").textContent = "";
		dlg.showModal();
	};
	form?.addEventListener("submit", (e) => {
		if (e.submitter && e.submitter.value === "cancel") return;
		e.preventDefault();
	});
	const verdict = () => {
		const essential = $("#dlgEssential").value === "1";
		const res = checkPurchase(state._safe.safe, $("#dlgAmount").value, essential);
		const el = $("#dlgVerdict");
		el.dataset.tone = res.tone;
		el.style.color = res.tone === "ok" ? "var(--ok)" : res.tone === "amber" ? "var(--warn)" : "var(--danger)";
		el.textContent = `${res.message} · “${$("#dlgWhat").value}”`;
		blip(res.tone);
		if (res.tone === "ok") sprayConfetti();
	};
	$("#dlgConfirm").onclick = verdict;
	$("#dlgAmount").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); verdict(); } };
	$("#dlgWhat").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); verdict(); } };
}

function wireFilters() {
	$$(".filters .chip").forEach((chip) => {
		chip.onclick = () => {
			$$(".filters .chip").forEach((c) => c.classList.remove("active"));
			chip.classList.add("active");
			state.txnFilter = chip.dataset.filter;
			// filter only re-renders list — keep 3D scene
			const asOfEnd = new Date(state.asOf + "T23:59:59");
			const txns = [...state._detail.transactions].filter((t) => new Date(t.ts) <= asOfEnd).reverse();
			const filtered = txns.filter((t) => {
				if (state.txnFilter === "income") return t.dir === "credit";
				if (state.txnFilter === "essential") return t.dir === "debit" && t.essential;
				if (state.txnFilter === "discretionary") return t.dir === "debit" && !t.essential;
				return true;
			}).slice(0, 60);
			$("#txnList").innerHTML = filtered
				.map(
					(t) => `<li>
					<span class="cat">${t.category.replaceAll("_", " ")}</span>
					<span class="amt ${t.dir === "credit" ? "pos" : "neg"}">${t.dir === "credit" ? "+" : "−"}${CAD2(t.amount)}</span>
					<span class="meta">${t.ts.replace("T", " ")} · ${t.channel}${t.essential ? " · essential" : ""}</span>
				</li>`
				)
				.join("") || `<li><span class="cat">No matching transactions.</span></li>`;
		};
	});
}

function wireMisc() {
	document.addEventListener("keydown", (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.target.matches("input, select, textarea")) return;
		const k = e.key.toLowerCase();
		const map = { "1": "#cockpit", "2": "#radar", "3": "#buffer", "4": "#shifts", "5": "#peers", "6": "#ledger", "7": "#pipeline" };
		if (k === "b") {
			const dlg = $("#buyDialog");
			if (!dlg?.open) $("#checkBuyBtn").click();
			return;
		}
		if (k === "p") { $("#runPipeline").click(); return; }
		if (k === "t") { $("#tourPersona").click(); return; }
		if (map[k]) document.querySelector(map[k])?.scrollIntoView({ behavior: "smooth" });
	});
	$("#tourPersona").onclick = () => {
		state.workerId = "W-0001";
		$("#workerSelect").value = "W-0001";
		state.asOf = "2026-04-27";
		$("#simDateLabel").textContent = "Apr 27";
		renderAll();
		document.querySelector("#cockpit").scrollIntoView({ behavior: "smooth" });
		toast("Tour: W-0001 · Apr 27 — rent in 4 days, SafeSpend $0");
	};
	$("#simDateBtn").onclick = () => {
		const opts = [
			["2026-04-27", "Apr 27"],
			["2026-05-01", "May 1"],
			["2026-05-13", "May 13"],
			["2026-06-01", "Jun 1"],
			["2026-06-15", "Jun 15"],
		];
		const i = opts.findIndex((o) => o[0] === state.asOf);
		const next = opts[(i + 1) % opts.length];
		state.asOf = next[0];
		$("#simDateLabel").textContent = next[1];
		state._flowWorker = null; // force flow rebuild on date change
		renderAll();
		toast(`Simulation date → ${next[1]}`);
	};
	$("#runPipeline").onclick = () => onRunPipeline();
	$("#autoDemo").onclick = async () => {
		if (state._demoRunning) return;
		state._demoRunning = true;
		$("#autoDemo").disabled = true;
		toast("Auto demo — hang on");
		try {
			state.workerId = "W-0001";
			$("#workerSelect").value = "W-0001";
			state.asOf = "2026-04-27";
			$("#simDateLabel").textContent = "Apr 27";
			state._flowWorker = null;
			renderAll();
			const stops = ["#hero", "#cockpit", "#radar", "#buffer", "#shifts", "#peers", "#ledger", "#pipeline"];
			for (const s of stops) {
				document.querySelector(s)?.scrollIntoView({ behavior: "smooth" });
				await new Promise((r) => setTimeout(r, 1400));
			}
			await onRunPipeline();
			toast("Demo complete — try Speak briefing");
		} finally {
			state._demoRunning = false;
			$("#autoDemo").disabled = false;
		}
	};
	$("#speakBriefing").onclick = () => {
		const meta = state._briefingMeta;
		if (!meta || meta.workerId !== state.workerId || meta.asOf !== state.asOf) {
			toast("Run the pipeline first for this worker/date");
			return;
		}
		if (!window.speechSynthesis) {
			toast("Speech synthesis not available");
			return;
		}
		window.speechSynthesis.cancel();
		const u = new SpeechSynthesisUtterance(meta.text);
		u.rate = 1.02;
		u.pitch = 0.95;
		window.speechSynthesis.speak(u);
		toast("Speaking briefing…");
	};
	$("#exportBriefing").onclick = () => {
		const meta = state._briefingMeta;
		if (!meta || meta.workerId !== state.workerId || meta.asOf !== state.asOf || meta.text.length < 40) {
			toast("Run the pipeline first for this worker/date");
			return;
		}
		const blob = new Blob([`DAYSHIFT briefing · ${meta.workerId} · ${meta.asOf}\n\n${meta.text}\n`], { type: "text/plain" });
		const a = document.createElement("a");
		const url = URL.createObjectURL(blob);
		a.href = url;
		a.download = `dayshift-${meta.workerId}-${meta.asOf}.txt`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1500);
		toast("Briefing exported");
	};
}

function sprayConfetti() {
	const layer = document.createElement("div");
	layer.className = "confetti";
	document.body.appendChild(layer);
	const colors = ["#3ecf8e", "#f0c35a", "#c47a3a", "#3aa8a0", "#e8f0ea"];
	for (let i = 0; i < 36; i++) {
		const p = document.createElement("i");
		p.style.left = Math.random() * 100 + "%";
		p.style.background = colors[i % colors.length];
		p.style.animationDelay = Math.random() * 0.3 + "s";
		layer.appendChild(p);
	}
	setTimeout(() => layer.remove(), 1600);
}

function renderAll() {
	try {
		renderStrip();
		renderCockpit();
		renderRadar();
		renderBuffer();
		renderShifts();
		renderPeers();
		renderLedger();
		renderPipelineUI();
		$("#loadMeta").textContent = `${state.bundle.meta.workers} workers · as of ${state.asOf} · bundle ${state._bundleKB}KB cached`;
	} catch (e) {
		console.error("renderAll", e);
		toast(`Render error: ${e.message || e}`);
	}
}

async function main() {
	let mxRaf = 0;
	window.addEventListener("pointermove", (e) => {
		if (mxRaf) return;
		mxRaf = requestAnimationFrame(() => {
			document.documentElement.style.setProperty("--mx", (e.clientX / innerWidth) * 100 + "%");
			document.documentElement.style.setProperty("--my", (e.clientY / innerHeight) * 100 + "%");
			mxRaf = 0;
		});
	}, { passive: true });

	setLoader("Loading worker data…");
	try {
		state.bundle = await loadBundle();
		state._bundleKB = Math.round(JSON.stringify(state.bundle).length / 1024);
	} catch (e) {
		console.error(e);
		setLoader(String(e.message || e), true);
		return;
	}

	setLoader("Wiring cockpit…");
	try {
		fillWorkerSelect();
		renderPipelineUI();
		renderBuyBar();
		wireDialog();
		wireFilters();
		wireMisc();
		if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
		renderAll();
	} catch (e) {
		console.error(e);
		setLoader(`Boot error: ${e.message || e}`, true);
		return;
	}

	hideLoader();
	requestAnimationFrame(() => document.body.classList.add("ready"));

	loadViz3d().then((ok) => {
		if (!ok) {
			const cap = $(".flow-cap");
			if (cap) cap.textContent = "3D offline (CDN/WebGL) — 2D cockpit still live.";
			return;
		}
		try {
			state.hero3d = state.createHeroScene($("#hero3d"));
			state.hero3d?.setSafeLevel?.(state._safe?.safe || 0, 200);
		} catch (e) {
			console.warn("WebGL hero fallback", e);
		}
		try {
			if (state._detail?.transactions?.length) {
				state.flow3d = state.createFlowScene($("#flow3d"), state._detail.transactions);
				state._flowWorker = state.workerId;
			}
		} catch (e) {
			console.warn("WebGL flow fallback", e);
		}
	});
}

main().catch((e) => {
	console.error(e);
	setLoader(`Fatal: ${e.message || e}`, true);
});
