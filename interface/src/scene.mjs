import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const accents = [0xd8ed53, 0xff654b, 0xa9b8f5];

export function mountPostOffice(host, { mode = 0 } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    host.dataset.scene = "fallback";
    return { setMode() {}, pause() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const hero = host.closest(".experience");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 70);
  camera.position.set(0, 0.9, 13);
  camera.lookAt(0, 0.25, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7b8b74, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(-4, 7, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8d9f4, 1);
  fill.position.set(5, 0, 3);
  scene.add(fill);
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xfdfdf6,
    roughness: 0.3,
    metalness: 0.08,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
  });
  const fold = white.clone();
  fold.color.setHex(0xe3e8d9);
  const accent = new THREE.MeshPhysicalMaterial({
    color: accents[mode],
    roughness: 0.29,
    metalness: 0.13,
    clearcoat: 0.65,
  });
  const ink = new THREE.MeshPhysicalMaterial({
    color: 0x1b2620,
    roughness: 0.24,
    metalness: 0.5,
  });
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xb3bfb0,
    roughness: 0.19,
    metalness: 0.92,
  });
  const coral = new THREE.MeshPhysicalMaterial({
    color: 0xff654b,
    roughness: 0.32,
    metalness: 0.13,
  });
  const lilac = new THREE.MeshPhysicalMaterial({
    color: 0x9ba7ec,
    roughness: 0.24,
    metalness: 0.28,
  });
  const root = new THREE.Group();
  scene.add(root);
  const paper = new THREE.Group();
  const parcel = new THREE.Group();
  const swap = new THREE.Group();
  root.add(paper, parcel, swap);
  const models = [paper, parcel, swap];
  const textures = [];

  function box(parent, w, h, d, radius, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 3, radius),
      material
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function triangle(parent, vertices, material, z) {
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0][0], vertices[0][1]);
    for (const [x, y] of vertices.slice(1)) shape.lineTo(x, y);
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.035,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.025,
        bevelThickness: 0.025,
      }),
      material
    );
    mesh.position.z = z;
    parent.add(mesh);
    return mesh;
  }
  function label(parent, text, sub, background, w, h, x, y, z, dark = true) {
    const surface = document.createElement("canvas");
    surface.width = 1024;
    surface.height = 512;
    const ctx = surface.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = dark ? "#20271c" : "#f5f5ed";
    ctx.font = "500 32px Helvetica, Arial, sans-serif";
    ctx.fillText(sub, 64, 82);
    ctx.font = "600 135px Helvetica, Arial, sans-serif";
    ctx.fillText(text, 58, 269);
    ctx.lineWidth = 2;
    ctx.strokeStyle = dark ? "#20271c55" : "#ffffff55";
    ctx.beginPath();
    ctx.moveTo(64, 350);
    ctx.lineTo(960, 350);
    ctx.stroke();
    ctx.font = "400 27px Helvetica, Arial, sans-serif";
    ctx.fillText(".ai TO .ai", 64, 420);
    ctx.fillText("PARLEY POST", 711, 420);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture })
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function seal(parent, x, y, z, material = ink, radius = 0.27) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.07, 48),
      material
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, y, z);
    parent.add(disc);
    const emblem = new THREE.Group();
    box(emblem, 0.045, 0.25, 0.025, 0.01, white, -0.045, -0.025);
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.024, 8, 24),
      white
    );
    loop.position.set(0.02, 0.055, 0);
    emblem.add(loop);
    emblem.position.set(x, y, z + 0.045);
    parent.add(emblem);
  }
  function envelope(parent, material, scale = 1, open = false) {
    const g = new THREE.Group();
    box(g, 3.85, 2.5, 0.21, 0.1, material);
    if (open)
      triangle(
        g,
        [
          [-1.86, 1.2],
          [0, 2.85],
          [1.86, 1.2],
        ],
        fold,
        -0.12
      );
    triangle(
      g,
      [
        [-1.86, 1.16],
        [0, -0.05],
        [-1.86, -1.17],
      ],
      material,
      0.15
    );
    triangle(
      g,
      [
        [1.86, 1.16],
        [1.86, -1.17],
        [0, -0.05],
      ],
      fold,
      0.15
    );
    triangle(
      g,
      [
        [-1.86, -1.17],
        [1.86, -1.17],
        [0, 0.2],
      ],
      material,
      0.19
    );
    if (!open)
      triangle(
        g,
        [
          [-1.86, 1.17],
          [0, -0.28],
          [1.86, 1.17],
        ],
        material,
        0.25
      );
    g.scale.setScalar(scale);
    parent.add(g);
    return g;
  }
  envelope(paper, white, 1, true);
  const note = new THREE.Group();
  box(note, 3.3, 2.2, 0.08, 0.045, accent);
  label(
    note,
    "hello.ai",
    "A NEW CONNECTION",
    "#d8ed53",
    3.2,
    1.6,
    0,
    0.18,
    0.046
  );
  note.position.set(0, 1.17, 0.025);
  note.rotation.z = -0.035;
  paper.add(note);
  seal(paper, 0, -0.25, 0.31);
  paper.rotation.set(-0.12, -0.3, -0.15);
  box(parcel, 2.6, 3.2, 0.48, 0.13, coral);
  box(parcel, 2.7, 1.17, 0.15, 0.06, coral, 0, 1.1, 0.26);
  const giftRibbon = box(parcel, 0.18, 3.2, 0.06, 0.02, chrome, 0, 0, 0.27);
  giftRibbon.position.x = 0.65;
  label(
    parcel,
    "for you.",
    "A LITTLE HELLO",
    "#ff654b",
    2.25,
    1.13,
    -0.05,
    0.04,
    0.32
  );
  seal(parcel, 0, 0.8, 0.41, ink, 0.3);
  parcel.rotation.set(-0.18, -0.37, -0.14);
  const leftOffer = box(swap, 2.3, 2.8, 0.23, 0.11, lilac, -0.75, 0.3, 0);
  leftOffer.rotation.z = 0.16;
  const rightOffer = box(swap, 2.3, 2.8, 0.23, 0.11, white, 0.8, -0.2, 0.35);
  rightOffer.rotation.z = -0.12;
  const offerA = new THREE.Group(),
    offerB = new THREE.Group();
  label(offerA, "BNB", "YOU GIVE", "#9ba7ec", 1.9, 0.95, 0, 0, 0);
  offerA.position.set(-0.75, 0.8, 0.13);
  offerA.rotation.z = 0.16;
  label(offerB, "USDT", "YOU RECEIVE", "#fdfdf6", 1.9, 0.95, 0, 0, 0);
  offerB.position.set(0.8, 0.1, 0.49);
  offerB.rotation.z = -0.12;
  swap.add(offerA, offerB);
  seal(swap, 0.8, -0.8, 0.52);
  swap.rotation.set(-0.12, -0.24, -0.1);
  const satelliteA = envelope(scene, coral, 0.28);
  const satelliteB = envelope(scene, lilac, 0.22);
  satelliteA.rotation.set(0.2, 0.35, -0.5);
  satelliteB.rotation.set(-0.15, -0.5, 0.25);
  const rails = new THREE.Group();
  const railMat = new THREE.MeshBasicMaterial({
    color: 0x8c9d82,
    transparent: true,
    opacity: 0.32,
  });
  scene.add(rails);
  const curves = [];
  for (let j = 0; j < 2; j++) {
    const points = Array.from({ length: 65 }, (_, i) => {
      const t = (i / 64) * Math.PI * 2;
      return new THREE.Vector3(
        Math.cos(t) * (5.7 + j * 0.6),
        Math.sin(t) * (0.9 + j * 0.3) - 0.2,
        Math.sin(t) * 1.8 - 1.4
      );
    });
    const curve = new THREE.CatmullRomCurve3(points, true);
    curves.push(curve);
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 160, 0.008, 5, true),
      railMat
    );
    rail.rotation.z = j ? -0.2 : 0.14;
    rails.add(rail);
  }
  const courier = envelope(scene, ink, 0.075);
  const shadowSurface = document.createElement("canvas");
  shadowSurface.width = shadowSurface.height = 256;
  const shadowContext = shadowSurface.getContext("2d");
  const shadowGradient = shadowContext.createRadialGradient(
    128,
    128,
    0,
    128,
    128,
    128
  );
  shadowGradient.addColorStop(0, "rgba(32,45,25,.21)");
  shadowGradient.addColorStop(0.4, "rgba(32,45,25,.09)");
  shadowGradient.addColorStop(1, "rgba(32,45,25,0)");
  shadowContext.fillStyle = shadowGradient;
  shadowContext.fillRect(0, 0, 256, 256);
  const shadowTexture = new THREE.CanvasTexture(shadowSurface);
  textures.push(shadowTexture);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 1.15),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    })
  );
  shadow.position.set(0.1, -2.22, -0.6);
  scene.add(shadow);
  const pointer = new THREE.Vector2();
  const damped = new THREE.Vector2();
  let time = 0,
    last = performance.now(),
    active = mode,
    paused = false,
    visible = true,
    disposed = false,
    contextAvailable = true,
    frame;
  let compact = false;
  function size() {
    const { width, height } = host.getBoundingClientRect();
    compact = width < 720;
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.position.z = compact ? 11.8 : width < 1100 ? 15.5 : 13;
    camera.updateProjectionMatrix();
    root.position.y = compact ? 0.7 : 0.15;
    root.scale.setScalar(compact ? 0.93 : 1);
    rails.scale.x = compact ? 0.66 : 1;
    render();
  }
  function render() {
    if (disposed) return;
    for (const [i, model] of models.entries()) model.visible = i === active;
    root.rotation.x = damped.y * 0.11;
    root.rotation.y = damped.x * 0.22;
    root.position.x = damped.x * 0.13;
    const bob = Math.sin(time * 0.7) * 0.13;
    root.position.y = (compact ? 0.7 : 0.15) + bob;
    paper.rotation.z = -0.15 + Math.sin(time * 0.43) * 0.035;
    note.position.y = 1.17 + Math.sin(time * 0.8) * 0.13;
    parcel.rotation.y = -0.37 + Math.sin(time * 0.4) * 0.12;
    swap.rotation.y = -0.24 + Math.sin(time * 0.4) * 0.12;
    const spread = compact ? 0.55 : 1;
    satelliteA.position.set(
      -4.3 * spread,
      0.45 + Math.sin(time * 0.8) * 0.2,
      -0.5
    );
    satelliteB.position.set(
      4.2 * spread,
      -0.25 + Math.cos(time * 0.6) * 0.2,
      -1
    );
    satelliteA.rotation.z = -0.5 + Math.sin(time * 0.5) * 0.12;
    satelliteB.rotation.z = 0.25 - Math.sin(time * 0.6) * 0.13;
    const point = curves[0].getPointAt((time * 0.035 + 0.12) % 1);
    courier.position.copy(point);
    courier.position.x *= spread;
    courier.rotation.z = Math.sin(time * 0.5) * 0.3;
    renderer.render(scene, camera);
    host.dataset.scene = "ready";
    host.dataset.mode = String(active);
    host.dataset.motion = paused ? "paused" : "playing";
    host.dataset.frame = String(Math.floor(time * 100));
  }
  function tick(now) {
    frame = requestAnimationFrame(tick);
    const delta = Math.min((now - last) / 1000, 0.06);
    last = now;
    if (!visible || document.hidden || paused || !contextAvailable) return;
    time += delta;
    damped.lerp(pointer, 0.04);
    render();
  }
  function move(e) {
    const r = hero.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      ((e.clientY - r.top) / r.height) * 2 - 1
    );
  }
  function leave() {
    pointer.set(0, 0);
  }
  function contextLost(e) {
    e.preventDefault();
    host.dataset.scene = "fallback";
    contextAvailable = false;
  }
  function contextRestored() {
    contextAvailable = true;
    host.dataset.scene = "ready";
    render();
  }
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  hero.addEventListener("pointermove", move);
  hero.addEventListener("pointerleave", leave);
  const observer = new ResizeObserver(size);
  observer.observe(host);
  const intersection = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { rootMargin: "80px" }
  );
  intersection.observe(hero);
  size();
  frame = requestAnimationFrame(tick);
  return {
    setMode(index) {
      active = index;
      host.dataset.mode = String(index);
      render();
      if (!paused && typeof canvas.animate === "function")
        canvas.animate(
          [
            { opacity: 0.3, transform: "translateY(12px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 430, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
    },
    pause(value) {
      paused = value;
      render();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : [];
        materials.forEach((m) => m.dispose());
      });
      textures.forEach((t) => t.dispose());
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
