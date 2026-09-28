/**
 * شانۆی شەڕ (یەکێک لە سێ هەڵبژێرە) —— بە سەرچاوەگرتن لە دیمەنەکانی فیلمی «牛来»:
 * sunset  بیابانی خۆرئاوابوون (وێنەی 1: چیا بەنەوشەیی-سوور، دارە گۆڵەییەکان، ئاسمانی گەرم و پرتەقاڵی)
 * night   دارستانی گورگی شەوی تاریک (شەوی هێرشکردنی گورگەکان بۆ سەر گەلەکانی مانگا: مانگی سارد، دارە سوزییە وێنە-تاریکەکان، بنەدار)
 * forest  دارستانی قەڵەوی ئاسمان (دارەکانی قامیشی بەنەوشەیی و تاجی گۆڵەیی، زەویی سەوزی پڕ لە پەڵەی ڕووناکی، ئاسمانی زەردی گەرم)
 */
import * as THREE from 'three';

const CFG = {
  sunset: {
    sky: [['0', '#2e1a4d'], ['0.35', '#8a4a7c'], ['0.58', '#e2825a'], ['0.75', '#f7b45c'], ['1', '#fcd9a0']],
    ground: ['#d9a86c', ['rgba(190,140,86,0.5)', 'rgba(233,190,130,0.5)', 'rgba(160,110,70,0.35)']],
    fog: [0xd89070, 55, 110],
    hemi: [0xd8a0c0, 0xd9a468, 1.35],
    sun: { color: 0xffe9c8, int: 2.1, pos: [-14, 18, 8] },
    rim: { color: 0xd060ff, int: 0.45 },
    disc: { color: 0xffe9b0, glow: 0xffc06a, pos: [-30, 13, -62] },
    rock: [0x7c4a70, 0x5e3a62, 0x9c5a78],
    tree: 'puff',
  },
  night: {
    sky: [['0', '#04060f'], ['0.5', '#0a1428'], ['0.8', '#12203a'], ['1', '#1c3040']],
    ground: ['#1e3a22', ['rgba(30,70,38,0.5)', 'rgba(50,90,55,0.4)', 'rgba(12,26,16,0.5)']],
    fog: [0x0a1420, 30, 85],
    hemi: [0x2a3a58, 0x0e141c, 0.85],
    sun: { color: 0x8fa8e8, int: 1.35, pos: [12, 20, 10] },
    rim: { color: 0x4466aa, int: 0.5 },
    disc: { color: 0xe8f0ff, glow: 0x8fa8d8, pos: [26, 18, -58], moon: true },
    rock: [0x2a3648, 0x1c2836, 0x33435c],
    tree: 'night',
  },
  forest: {
    sky: [['0', '#e8c86a'], ['0.5', '#f5e3a0'], ['1', '#d8e8a8']],
    ground: ['#7cb454', ['rgba(90,150,70,0.5)', 'rgba(140,190,100,0.45)', 'rgba(60,110,50,0.4)']],
    fog: [0xd8e0a0, 40, 95],
    hemi: [0xc8d8b0, 0x5a7a4a, 1.25],
    sun: { color: 0xfff2cc, int: 2.0, pos: [-12, 16, 6] },
    rim: { color: 0x88aaff, int: 0.35 },
    disc: null,
    rock: [0x9a90b8, 0x7a7098, 0xb0a8cc],
    tree: 'purple',
  },
};

function groundTexture(base, speckles) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = speckles[(Math.random() * speckles.length) | 0];
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [p, col] of stops) grad.addColorStop(Number(p), col);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildStage(scene, stageId = 'sunset') {
  const C = CFG[stageId] || CFG.sunset;
  const g = new THREE.Group();
  const geos = [], mats = [], texs = [];
  const M = (m) => (mats.push(m), m);
  const G = (geo) => (geos.push(geo), geo);

  // ئاسمان
  const skyTex = skyTexture(C.sky); texs.push(skyTex);
  g.add(new THREE.Mesh(G(new THREE.SphereGeometry(90, 32, 20)),
    M(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }))));

  // هەور (ئاسمانی شەو بێ هەورە)
  if (stageId !== 'night') {
    const cloudM = M(new THREE.MeshBasicMaterial({
      color: stageId === 'forest' ? 0xfff4d8 : 0xffd9b8, transparent: true, opacity: 0.85, fog: false }));
    const cloudM2 = M(new THREE.MeshBasicMaterial({
      color: stageId === 'forest' ? 0xe8e0c0 : 0xe8a0c0, transparent: true, opacity: 0.7, fog: false }));
    for (let i = 0; i < 8; i++) {
      const cl = new THREE.Group();
      const n = 3 + (Math.random() * 3 | 0);
      for (let j = 0; j < n; j++) {
        const puff = new THREE.Mesh(G(new THREE.SphereGeometry(2.4 + Math.random() * 2.6, 10, 8)), Math.random() < 0.4 ? cloudM2 : cloudM);
        puff.position.set(j * 2.6 - n * 1.2, Math.random() * 1.2, Math.random() * 1.6);
        puff.scale.y = 0.45;
        cl.add(puff);
      }
      const a = Math.random() * Math.PI * 2, r = 46 + Math.random() * 26;
      cl.position.set(Math.cos(a) * r, 14 + Math.random() * 16, Math.sin(a) * r);
      g.add(cl);
    }
  } else {
    // ئەستێرەکان
    const starGeo = G(new THREE.BufferGeometry());
    const pos = [];
    for (let i = 0; i < 240; i++) {
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 25, h = 10 + Math.random() * 60;
      pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.add(new THREE.Points(starGeo, M(new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.5, fog: false }))));
  }

  // خۆر / مانگ
  if (C.disc) {
    const disc = new THREE.Mesh(G(new THREE.SphereGeometry(7, 24, 16)), M(new THREE.MeshBasicMaterial({ color: C.disc.color, fog: false })));
    disc.position.set(...C.disc.pos);
    g.add(disc);
    const glow = new THREE.Mesh(G(new THREE.SphereGeometry(11, 24, 16)),
      M(new THREE.MeshBasicMaterial({ color: C.disc.glow, transparent: true, opacity: C.disc.moon ? 0.25 : 0.35, fog: false })));
    glow.position.set(...C.disc.pos);
    g.add(glow);
  }

  // زەوی
  const groundTex = groundTexture(C.ground[0], C.ground[1]); texs.push(groundTex);
  const ground = new THREE.Mesh(G(new THREE.CircleGeometry(60, 48)),
    M(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  // چیاکانی دوور
  const rockM = M(new THREE.MeshStandardMaterial({ color: C.rock[0], roughness: 1 }));
  const rockM2 = M(new THREE.MeshStandardMaterial({ color: C.rock[1], roughness: 1 }));
  const rockLight = M(new THREE.MeshStandardMaterial({ color: C.rock[2], roughness: 1 }));
  function mountain(x, z, s, mat) {
    const geo = G(new THREE.ConeGeometry(1, 1, 7, 3));
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) * (0.75 + Math.random() * 0.5));
      pos.setZ(i, pos.getZ(i) * (0.75 + Math.random() * 0.5));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(16 * s, 9 * s, 12 * s);
    m.position.set(x, 0, z);
    m.rotation.y = Math.random() * Math.PI;
    return m;
  }
  g.add(mountain(-38, -46, 1.5, rockM), mountain(-20, -58, 2.0, rockM2),
    mountain(18, -52, 1.7, rockM), mountain(42, -44, 1.3, rockLight),
    mountain(0, -70, 2.6, rockM2), mountain(-58, -30, 1.2, rockM2), mountain(60, -34, 1.1, rockM));

  // دار: دارە گۆڵەییەکانی بیابان / دارە سوزییە تاریکەکانی شەو + بنەدار / دارە قامیشی بەنەوشەیی و تاجی گۆڵەیی
  const trunkM = M(new THREE.MeshStandardMaterial({ color: stageId === 'forest' ? 0x8a80b0 : 0x6b4a33, roughness: 1 }));
  const leafM = M(new THREE.MeshStandardMaterial({ color: stageId === 'night' ? 0x16281a : 0x3e6b2e, roughness: 1 }));
  const leafM2 = M(new THREE.MeshStandardMaterial({ color: stageId === 'night' ? 0x1e3424 : 0x54823a, roughness: 1 }));
  function tree(x, z, s) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    if (C.tree === 'night') {
      const trunk = new THREE.Mesh(G(new THREE.CylinderGeometry(0.1 * s, 0.18 * s, 3.2 * s, 7)), trunkM);
      trunk.position.y = 1.6 * s;
      t.add(trunk);
      for (let j = 0; j < 3; j++) {
        const cone = new THREE.Mesh(G(new THREE.ConeGeometry((1.15 - j * 0.28) * s, 1.3 * s, 8)), j % 2 ? leafM : leafM2);
        cone.position.y = (2.4 + j * 0.85) * s;
        t.add(cone);
      }
    } else {
      const trunk = new THREE.Mesh(G(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.2 * s, 8)), trunkM);
      trunk.position.y = 1.1 * s; trunk.rotation.z = (Math.random() - 0.5) * 0.15;
      t.add(trunk);
      const n = 2 + (Math.random() * 2 | 0);
      for (let j = 0; j < n; j++) {
        const puff = new THREE.Mesh(G(new THREE.SphereGeometry((0.75 + Math.random() * 0.5) * s, 12, 10)), Math.random() < 0.5 ? leafM : leafM2);
        puff.position.set((Math.random() - 0.5) * 0.9 * s, (2.1 + j * 0.55 + Math.random() * 0.3) * s, (Math.random() - 0.5) * 0.7 * s);
        t.add(puff);
      }
    }
    return t;
  }
  for (const [x, z, s] of [[-14, -17, 1.4], [-8, -19, 1.6], [-2.5, -21, 1.3], [3.5, -18.5, 1.5], [9.5, -20, 1.3], [15, -18, 1.7], [-20, -15, 1.3], [20, -16, 1.5], [-26, -13, 1.4], [26, -12, 1.3], [-9, -24, 1.8], [6, -25, 1.6]]) {
    g.add(tree(x, z, s));
  }

  // بنەدار (دارستانی گورگی شەو) / بەردە گەورەکانی لای پشتەوە
  if (stageId === 'night') {
    for (const [x, z] of [[-5, -6], [4, -8], [-7, -10], [6.5, -11], [0, -13], [8, -5.5]]) {
      const stump = new THREE.Mesh(G(new THREE.CylinderGeometry(0.5, 0.62, 0.5, 9)), trunkM);
      stump.position.set(x, 0.25, z);
      stump.rotation.y = Math.random() * 3;
      stump.castShadow = true;
      g.add(stump);
    }
  }
  const boulderM = M(new THREE.MeshStandardMaterial({ color: C.rock[0], roughness: 1 }));
  for (const [x, z, s] of [[-11.5, -3, 1.1], [11.8, -4, 0.9], [-10.5, 3.5, 0.6], [10.8, 4, 0.7]]) {
    const b = new THREE.Mesh(G(new THREE.DodecahedronGeometry(0.9 * s, 0)), boulderM);
    b.position.set(x, 0.4 * s, z);
    b.rotation.set(Math.random(), Math.random(), Math.random());
    b.castShadow = true;
    g.add(b);
  }

  // ڕووناکی (بەپێی شانۆکە دەگۆڕێت)
  const sunLight = new THREE.DirectionalLight(C.sun.color, C.sun.int);
  sunLight.position.set(...C.sun.pos);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -16; sunLight.shadow.camera.right = 16;
  sunLight.shadow.camera.top = 12; sunLight.shadow.camera.bottom = -6;
  sunLight.shadow.camera.far = 60;
  sunLight.shadow.bias = -0.0004;
  g.add(sunLight);
  g.add(new THREE.HemisphereLight(...C.hemi));
  const rim = new THREE.DirectionalLight(C.rim.color, C.rim.int);
  rim.position.set(10, 6, -14);
  g.add(rim);

  // کارایی: جەمکردنەوەی ماتریسی شانۆی جێگیر
  g.updateMatrixWorld(true);
  g.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });

  scene.add(g);
  scene.fog = new THREE.Fog(C.fog[0], C.fog[1], C.fog[2]);

  return {
    group: g,
    dispose() {
      scene.remove(g);
      g.traverse((o) => {
        // قووڵایی سێبەری چراغەکان RenderTarget ـە، لابردنی چراغ بە خۆکار خەرجی سەرچاوەکەی ئازاد ناکات، دەبێت بە دەستی dispose بکرێت
        if (o.isLight && o.castShadow && o.shadow?.map) {
          o.shadow.map.dispose();
          o.shadow.map = null;
        }
        if (o.isLight) o.dispose?.();
        if (o.isMesh || o.isPoints) {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            if (m.map && !texs.includes(m.map)) m.map.dispose();
            m.dispose();
          }
        }
      });
      for (const geo of geos) geo.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
