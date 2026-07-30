/* Canvas charts — no chart library dependency */
(function () {

function prep(canvas, W, H) {
	if (!canvas) return null;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const dpr = Math.min(devicePixelRatio || 1, 2);
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	canvas.style.width = W + "px";
	canvas.style.maxWidth = "100%";
	canvas.style.height = "auto";
	canvas.style.display = "block";
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, W, H);
	return ctx;
}

function emptyMsg(ctx, W, msg) {
	ctx.fillStyle = "#6b7f74";
	ctx.font = "13px Source Sans 3, sans-serif";
	ctx.fillText(msg, 20, 40);
}

function drawRing(canvas, safe, max = 180) {
	const size = 320;
	const ctx = prep(canvas, size, size);
	if (!ctx) return;
	const cx = size / 2;
	const cy = size / 2;
	const r = 118;
	const m = Number(max) || 180;
	const pct = Number.isFinite(safe / m) ? Math.max(0.02, Math.min(1, safe / m)) : 0.02;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.strokeStyle = "rgba(232,240,234,0.08)";
	ctx.lineWidth = 16;
	ctx.stroke();
	const grad = ctx.createLinearGradient(0, 0, size, size);
	grad.addColorStop(0, "#2f8f5b");
	grad.addColorStop(0.5, "#f0c35a");
	grad.addColorStop(1, "#c47a3a");
	ctx.beginPath();
	ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
	ctx.strokeStyle = grad;
	ctx.lineCap = "round";
	ctx.lineWidth = 16;
	ctx.stroke();
	ctx.save();
	for (let i = 0; i < 24; i++) {
		const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
		ctx.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
		ctx.strokeStyle = "rgba(154,173,163,0.35)";
		ctx.lineWidth = 2;
		ctx.stroke();
	}
	ctx.restore();
}

function drawGauge(canvas, days) {
	const W = 360, H = 220;
	const ctx = prep(canvas, W, H);
	if (!ctx) return;
	const cx = W / 2;
	const cy = H * 0.78;
	const r = 120;
	ctx.beginPath();
	ctx.arc(cx, cy, r, Math.PI, 0);
	ctx.strokeStyle = "rgba(232,240,234,0.08)";
	ctx.lineWidth = 18;
	ctx.stroke();
	const capped = Math.min(30, Math.max(0, Number(days) || 0));
	const pct = capped / 30;
	const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
	grad.addColorStop(0, "#e85d4c");
	grad.addColorStop(0.45, "#f0b429");
	grad.addColorStop(1, "#3ecf8e");
	ctx.beginPath();
	ctx.arc(cx, cy, r, Math.PI, Math.PI + pct * Math.PI);
	ctx.strokeStyle = grad;
	ctx.lineCap = "round";
	ctx.lineWidth = 18;
	ctx.stroke();
	const angle = Math.PI + pct * Math.PI;
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.lineTo(cx + Math.cos(angle) * (r - 10), cy + Math.sin(angle) * (r - 10));
	ctx.strokeStyle = "#f0c35a";
	ctx.lineWidth = 3;
	ctx.stroke();
	ctx.fillStyle = "#f0c35a";
	ctx.beginPath();
	ctx.arc(cx, cy, 6, 0, Math.PI * 2);
	ctx.fill();
}

function drawTimeline(canvas, gapInfo, asOf) {
	const W = 960, H = 280;
	const ctx = prep(canvas, W, H);
	if (!ctx || !gapInfo) return;
	const pad = 40;
	const days = 30;
	ctx.fillStyle = "rgba(232,240,234,0.04)";
	ctx.fillRect(pad, 40, W - pad * 2, H - 90);

	const projDaily = gapInfo.proj?.dailyExpect || 0;
	const bal = gapInfo.bal != null ? gapInfo.bal : Math.max(0, (gapInfo.available || 0) - (gapInfo.proj?.projected || 0));
	// build series with obligation dips
	const series = [];
	let cash = bal;
	const obsByDay = {};
	for (const o of gapInfo.obs || []) {
		if (o.days >= 0 && o.days <= days) {
			obsByDay[o.days] = (obsByDay[o.days] || 0) + (o.essential ? o.amount : 0);
		}
	}
	for (let d = 0; d <= days; d++) {
		if (d > 0) cash += projDaily;
		if (obsByDay[d]) cash -= obsByDay[d];
		series.push(cash);
	}
	const minC = Math.min(...series, 0);
	const maxC = Math.max(...series, 1);
	const span = maxC - minC || 1;
	const yAt = (v) => {
		const n = (v - minC) / span;
		return H - 50 - Math.max(0, Math.min(H - 100, n * (H - 100)));
	};

	ctx.save();
	ctx.strokeStyle = "rgba(62,207,142,0.55)";
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	for (let d = 0; d <= days; d++) {
		const x = pad + (d / days) * (W - pad * 2);
		const y = yAt(series[d]);
		if (d === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();
	ctx.restore();

	ctx.fillStyle = "#9aada3";
	ctx.font = "12px IBM Plex Mono, monospace";
	ctx.fillText(`Projected cash · as of ${asOf || "—"} (balance + earnings − essentials)`, pad, 28);

	for (const o of (gapInfo.obs || []).slice(0, 8)) {
		const dd = Math.min(days, Math.max(0, o.days));
		const x = pad + (dd / days) * (W - pad * 2);
		const y = 70 + (o.essential ? 0 : 30);
		ctx.beginPath();
		ctx.arc(x, y + 40, o.essential ? 8 : 5, 0, Math.PI * 2);
		ctx.fillStyle = o.category === "housing" ? "#e85d4c" : o.essential ? "#c47a3a" : "#3aa8a0";
		ctx.fill();
		ctx.fillStyle = "#e8f0ea";
		ctx.font = "11px IBM Plex Mono, monospace";
		ctx.save();
		ctx.translate(x, y + 60);
		ctx.rotate(-0.6);
		ctx.fillText(`${o.name} $${Math.round(o.amount)}`, 0, 0);
		ctx.restore();
		ctx.save();
		ctx.strokeStyle = "rgba(232,93,76,0.25)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, 50);
		ctx.lineTo(x, H - 50);
		ctx.stroke();
		ctx.restore();
	}
	if (gapInfo.gap > 0) {
		ctx.fillStyle = "rgba(232,93,76,0.12)";
		ctx.fillRect(pad, 40, (Math.min(gapInfo.days, days) / days) * (W - pad * 2), H - 90);
		ctx.fillStyle = "#e85d4c";
		ctx.font = "bold 14px Bricolage Grotesque, sans-serif";
		ctx.fillText(`GAP ZONE · short $${Math.round(gapInfo.gap)}`, pad + 12, H - 60);
	}
}

function drawWeeks(canvas, weeks = []) {
	const W = 640, H = 240;
	const ctx = prep(canvas, W, H);
	if (!ctx) return;
	const data = (weeks || []).slice(-12);
	if (!data.length) {
		emptyMsg(ctx, W, "No weekly history — pick a ★ spotlight worker.");
		return;
	}
	const pad = 36;
	const max = Math.max(...data.map((w) => Math.max(w.income || 0, w.expense || 0, 1)), 1);
	const bw = (W - pad * 2) / data.length;
	data.forEach((w, i) => {
		const x = pad + i * bw;
		const ih = ((w.income || 0) / max) * (H - 70);
		const eh = ((w.expense || 0) / max) * (H - 70);
		ctx.fillStyle = "rgba(62,207,142,0.75)";
		ctx.fillRect(x + 4, H - 30 - ih, bw * 0.35, ih);
		ctx.fillStyle = "rgba(232,93,76,0.65)";
		ctx.fillRect(x + bw * 0.4, H - 30 - eh, bw * 0.35, eh);
		if (w.neg) {
			ctx.fillStyle = "#e85d4c";
			ctx.fillRect(x + 4, H - 24, bw - 8, 3);
		}
	});
	ctx.fillStyle = "#6b7f74";
	ctx.font = "11px IBM Plex Mono, monospace";
	ctx.fillText("income", pad, 18);
	ctx.fillStyle = "#e85d4c";
	ctx.fillText("expense", pad + 60, 18);
}

function drawFees(canvas, advances = []) {
	const W = 520, H = 200;
	const ctx = prep(canvas, W, H);
	if (!ctx) return;
	const data = (advances || []).slice().reverse();
	if (!data.length) {
		emptyMsg(ctx, W, "No advances on record for this worker.");
		return;
	}
	const max = Math.max(...data.map((a) => (a.amount || 0) + (a.fee || 0)), 1);
	const bw = (W - 40) / data.length;
	data.forEach((a, i) => {
		const x = 20 + i * bw;
		const h = (((a.amount || 0) + (a.fee || 0)) / max) * 140;
		ctx.fillStyle = "rgba(196,122,58,0.55)";
		ctx.fillRect(x + 6, H - 40 - h, bw - 12, h);
		const fh = ((a.fee || 0) / max) * 140;
		ctx.fillStyle = "#e85d4c";
		ctx.fillRect(x + 6, H - 40 - fh, bw - 12, fh);
	});
	ctx.fillStyle = "#9aada3";
	ctx.font = "11px IBM Plex Mono, monospace";
	ctx.fillText("stack = advance · red tip = fee", 20, 18);
}

function drawPeers(canvas, card, cards = []) {
	const W = 640, H = 280;
	const ctx = prep(canvas, W, H);
	if (!ctx || !card) return;
	const peers = cards.filter((c) => c.occupation === card.occupation && c.pay_type === card.pay_type);
	const pts = peers
		.filter((c) => c.buffer_median != null && c.typical_daily_net != null)
		.map((c) => ({
			x: c.typical_daily_net,
			y: Math.min(80, c.buffer_median),
			self: c.id === card.id,
			fees: Number(c.advance_fees) || 0,
		}));
	if (!pts.length) {
		emptyMsg(ctx, W, "No peer points for this occupation.");
		return;
	}
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const minX = Math.min(...xs) - 10;
	const maxX = Math.max(...xs) + 10;
	const minY = 0;
	const maxY = Math.max(...ys, 5) + 5;
	const pad = 40;
	const X = (v) => pad + ((v - minX) / (maxX - minX || 1)) * (W - pad * 2);
	const Y = (v) => H - pad - ((v - minY) / (maxY - minY || 1)) * (H - pad * 1.5);
	ctx.strokeStyle = "rgba(232,240,234,0.08)";
	ctx.strokeRect(pad, pad / 2, W - pad * 2, H - pad * 1.5);
	for (const p of pts) {
		ctx.beginPath();
		ctx.arc(X(p.x), Y(p.y), p.self ? 8 : 4, 0, Math.PI * 2);
		const alpha = 0.25 + Math.min(0.6, p.fees / 40);
		ctx.fillStyle = p.self ? "#f0c35a" : `rgba(61,184,114,${alpha})`;
		ctx.fill();
		if (p.self) {
			ctx.strokeStyle = "#f0c35a";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(X(p.x), Y(p.y), 14, 0, Math.PI * 2);
			ctx.stroke();
		}
	}
	ctx.fillStyle = "#6b7f74";
	ctx.font = "11px IBM Plex Mono, monospace";
	ctx.fillText("← lower daily net", pad, H - 12);
	ctx.fillText("buffer days →", W - 120, pad);
}

window.DSCharts = { drawRing, drawGauge, drawTimeline, drawWeeks, drawFees, drawPeers };
})();
