import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function disposeObject(obj) {
	obj.traverse?.((o) => {
		o.geometry?.dispose?.();
		if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
		else o.material?.dispose?.();
	});
}

/** Hero: orbital SafeSpend orb + coin particles + Alberta glow */
export function createHeroScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setClearColor(0x000000, 0);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
	camera.position.set(0, 0.4, 5.2);

	const amb = new THREE.AmbientLight(0x6a8a78, 0.55);
	scene.add(amb);
	const key = new THREE.DirectionalLight(0xf0c35a, 1.1);
	key.position.set(3, 4, 2);
	scene.add(key);
	const fill = new THREE.PointLight(0x3db872, 18, 12);
	fill.decay = 2;
	fill.position.set(-2, -1, 2);
	scene.add(fill);

	const orbGeo = new THREE.IcosahedronGeometry(1.15, 2);
	const orbMat = new THREE.MeshStandardMaterial({
		color: 0x1f5c3f,
		emissive: 0x0d2a1c,
		metalness: 0.55,
		roughness: 0.28,
		flatShading: true,
	});
	const orb = new THREE.Mesh(orbGeo, orbMat);
	scene.add(orb);

	const wire = new THREE.Mesh(
		new THREE.IcosahedronGeometry(1.28, 1),
		new THREE.MeshBasicMaterial({ color: 0xf0c35a, wireframe: true, transparent: true, opacity: 0.22 })
	);
	scene.add(wire);

	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(1.75, 0.035, 16, 100),
		new THREE.MeshStandardMaterial({ color: 0xc47a3a, emissive: 0x5a3010, metalness: 0.8, roughness: 0.2 })
	);
	ring.rotation.x = Math.PI / 2.4;
	scene.add(ring);

	const ring2 = ring.clone();
	ring2.scale.setScalar(1.15);
	ring2.rotation.x = Math.PI / 1.7;
	ring2.material = ring.material.clone();
	ring2.material.color.set(0x3db872);
	scene.add(ring2);

	const coins = new THREE.Group();
	const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 20);
	const coinMat = new THREE.MeshStandardMaterial({ color: 0xf0c35a, metalness: 0.9, roughness: 0.25, emissive: 0x3a2a08 });
	const coinData = [];
	for (let i = 0; i < 48; i++) {
		const m = new THREE.Mesh(coinGeo, coinMat);
		const a = Math.random() * Math.PI * 2;
		const r = 2.1 + Math.random() * 1.6;
		const y = (Math.random() - 0.5) * 2.8;
		m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
		m.rotation.x = Math.random() * Math.PI;
		coins.add(m);
		coinData.push({ m, a, r, y, sp: 0.2 + Math.random() * 0.5 });
	}
	scene.add(coins);

	const N = 900;
	const pos = new Float32Array(N * 3);
	for (let i = 0; i < N; i++) {
		pos[i * 3] = (Math.random() - 0.5) * 18;
		pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
		pos[i * 3 + 2] = (Math.random() - 0.5) * 14 - 2;
	}
	const pGeo = new THREE.BufferGeometry();
	pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	const points = new THREE.Points(
		pGeo,
		new THREE.PointsMaterial({ color: 0x9aada3, size: 0.025, transparent: true, opacity: 0.65, depthWrite: false })
	);
	scene.add(points);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.enablePan = false;
	controls.enableZoom = false; // don't trap page scroll over the hero
	controls.minDistance = 3.2;
	controls.maxDistance = 8;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.55;
	canvas.style.touchAction = "pan-y";
	canvas.style.pointerEvents = "none"; // auto-rotate only — hero is decorative

	let safeNorm = 0.4;
	function setSafeLevel(safe, max = 200) {
		safeNorm = Math.max(0.05, Math.min(1, (Number(safe) || 0) / (Number(max) || 200)));
		orbMat.emissiveIntensity = 0.35 + safeNorm * 0.9;
		orb.scale.setScalar(0.85 + safeNorm * 0.35);
	}

	function resize() {
		const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
		const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas.parentElement || canvas);

	let visible = true;
	const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
	io.observe(canvas);

	let t0 = performance.now();
	let raf = 0;
	function frame(t) {
		raf = requestAnimationFrame(frame);
		if (!visible || document.hidden) return;
		const dt = (t - t0) / 1000;
		t0 = t;
		orb.rotation.y += dt * 0.25;
		orb.rotation.x += dt * 0.08;
		wire.rotation.y -= dt * 0.18;
		ring.rotation.z += dt * 0.35;
		ring2.rotation.z -= dt * 0.22;
		for (const c of coinData) {
			c.a += dt * c.sp * 0.4;
			c.m.position.x = Math.cos(c.a) * c.r;
			c.m.position.z = Math.sin(c.a) * c.r;
			c.m.position.y = c.y + Math.sin(t * 0.001 + c.a) * 0.15;
			c.m.rotation.y += dt * 2;
		}
		points.rotation.y += dt * 0.02;
		controls.update();
		renderer.render(scene, camera);
	}
	raf = requestAnimationFrame(frame);

	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault();
		cancelAnimationFrame(raf);
	});

	return {
		setSafeLevel,
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
			controls.dispose();
			disposeObject(scene);
			renderer.dispose();
		},
	};
}

/** Ledger flow field: rising credits / sinking debits */
export function createFlowScene(canvas, transactions) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setClearColor(0x0a100e, 1);
	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x0a100e, 0.08);
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
	camera.position.set(0, 3.2, 9);

	scene.add(new THREE.AmbientLight(0x445544, 0.7));
	const L = new THREE.PointLight(0xf0c35a, 16, 30);
	L.decay = 2;
	L.position.set(2, 5, 4);
	scene.add(L);

	const floor = new THREE.Mesh(
		new THREE.CircleGeometry(8, 48),
		new THREE.MeshStandardMaterial({ color: 0x152019, metalness: 0.4, roughness: 0.7 })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -2.2;
	scene.add(floor);

	const group = new THREE.Group();
	scene.add(group);

	const barGeo = new THREE.BoxGeometry(0.22, 1, 0.22);
	const recent = (transactions || []).slice(-80);
	const meshes = [];
	recent.forEach((t, i) => {
		const credit = t.dir === "credit";
		const amt = Number(t.amount) || 0;
		const h = Math.min(3.5, 0.25 + amt / 180);
		const col = credit ? 0x3ecf8e : t.essential ? 0xc47a3a : 0xe85d4c;
		const mat = new THREE.MeshStandardMaterial({
			color: col,
			emissive: col,
			emissiveIntensity: 0.25,
			metalness: 0.3,
			roughness: 0.45,
		});
		const m = new THREE.Mesh(barGeo, mat);
		m.scale.y = h;
		const x = ((i % 16) - 7.5) * 0.45;
		const z = (Math.floor(i / 16) - 2) * 0.55;
		m.position.set(x, credit ? -2.2 + h / 2 : 2.2 - h / 2, z);
		m.userData = { credit, baseY: m.position.y, phase: Math.random() * Math.PI * 2 };
		group.add(m);
		meshes.push(m);
	});

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.enableZoom = false;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.8;
	controls.target.set(0, 0, 0);
	canvas.style.touchAction = "pan-y";

	function resize() {
		const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
		const h = canvas.clientHeight || 420;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas.parentElement || canvas);

	let visible = true;
	const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
	io.observe(canvas);

	let raf = 0;
	function frame(t) {
		raf = requestAnimationFrame(frame);
		if (!visible || document.hidden) return;
		for (const m of meshes) {
			m.position.y = m.userData.baseY + Math.sin(t * 0.002 + m.userData.phase) * 0.08;
			m.rotation.y += 0.01;
		}
		group.rotation.y = Math.sin(t * 0.0002) * 0.15;
		controls.update();
		renderer.render(scene, camera);
	}
	raf = requestAnimationFrame(frame);

	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault();
		cancelAnimationFrame(raf);
	});

	return {
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
			controls.dispose();
			disposeObject(scene);
			barGeo.dispose();
			renderer.dispose();
		},
	};
}
