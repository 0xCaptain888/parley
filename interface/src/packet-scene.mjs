import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// One scissored renderer serves every visible gift, rather than one WebGL context per card.
export function mountPacketDisplay(root, { isPaused }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    root.querySelectorAll(".packet-visual").forEach((entry) => {
      entry.dataset.packetScene = "fallback";
    });
    return { dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  const canvas = renderer.domElement;
  canvas.className = "packet-renderer";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0.4, 7.4);
  camera.lookAt(0, 0.4, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a4c40, 0.65));
  const light = new THREE.DirectionalLight(0xfff5df, 1.7);
  light.position.set(-3, 5, 7);
  scene.add(light);
  const red = new THREE.MeshPhysicalMaterial({
    color: 0xb91d2d,
    roughness: 0.44,
    metalness: 0.05,
    clearcoat: 0.25,
    envMapIntensity: 0.35,
  });
  const fold = red.clone();
  const lidMaterial = red.clone();
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xe9cb80,
    roughness: 0.24,
    metalness: 0.78,
  });
  const paper = new THREE.MeshPhysicalMaterial({
    color: 0xfff4d5,
    roughness: 0.68,
    metalness: 0,
  });
  const model = new THREE.Group();
  scene.add(model);
  function box(parent, w, h, d, radius, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 3, radius),
      material
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function polygon(parent, points, material, z = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(...points[0]);
    points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.02,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelThickness: 0.018,
        bevelSize: 0.018,
      }),
      material
    );
    mesh.position.z = z;
    parent.add(mesh);
    return mesh;
  }
  box(model, 2.18, 2.85, 0.13, 0.07, red);
  const insert = new THREE.Group();
  box(insert, 1.92, 2.26, 0.045, 0.035, paper);
  const surface = document.createElement("canvas");
  surface.width = 512;
  surface.height = 640;
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "#fff4d5";
  ctx.fillRect(0, 0, 512, 640);
  ctx.fillStyle = "#ac7c42";
  ctx.font = "400 24px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PARLEY POST", 256, 76);
  ctx.font = "500 108px Helvetica, Arial, sans-serif";
  ctx.fillText("hello.", 256, 210);
  ctx.font = "400 22px Helvetica, Arial, sans-serif";
  ctx.fillText("FROM ONE NAME", 256, 395);
  ctx.fillText("TO ANOTHER", 256, 431);
  ctx.strokeStyle = "#b9965e";
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, 464, 592);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  const printed = new THREE.Mesh(
    new THREE.PlaneGeometry(1.85, 2.2),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  printed.position.z = 0.03;
  insert.add(printed);
  insert.position.set(0, 0.7, 0.085);
  model.add(insert);
  polygon(
    model,
    [
      [-1.06, 1.34],
      [-1.06, -1.35],
      [0.3, -0.42],
    ],
    fold,
    0.15
  );
  polygon(
    model,
    [
      [1.06, 1.34],
      [-0.3, -0.42],
      [1.06, -1.35],
    ],
    red,
    0.17
  );
  polygon(
    model,
    [
      [-1.06, -1.35],
      [1.06, -1.35],
      [0, 0.25],
    ],
    red,
    0.19
  );
  const flap = new THREE.Group();
  flap.position.set(0, 1.35, 0.2);
  model.add(flap);
  polygon(
    flap,
    [
      [-1.06, 0],
      [0, -1.12],
      [1.06, 0],
    ],
    lidMaterial
  );
  const seal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.245, 0.245, 0.055, 48),
    gold
  );
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0, -0.99, 0.065);
  flap.add(seal);
  const engraving = new THREE.Group();
  box(engraving, 0.035, 0.21, 0.02, 0.01, red, -0.035, -0.03);
  const loop = new THREE.Mesh(
    new THREE.TorusGeometry(0.065, 0.017, 8, 24),
    red
  );
  loop.position.set(0.02, 0.035, 0.01);
  engraving.add(loop);
  engraving.position.set(0, -0.99, 0.104);
  flap.add(engraving);
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 256;
  const label = labelCanvas.getContext("2d");
  label.textAlign = "center";
  label.fillStyle = "#eacb83";
  label.font = "500 105px Helvetica, Arial, sans-serif";
  label.fillText("parley.", 256, 116);
  label.font = "400 21px Helvetica, Arial, sans-serif";
  label.fillText("A LITTLE HELLO, BY NAME.", 256, 179);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.85),
    new THREE.MeshPhysicalMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
      roughness: 0.33,
      metalness: 0.3,
      envMapIntensity: 0.6,
    })
  );
  labelMesh.position.set(0, -0.58, 0.25);
  model.add(labelMesh);
  const bottomMark = new THREE.Group();
  for (let i = 0; i < 4; i++)
    box(
      bottomMark,
      0.028,
      0.06 + (i % 2) * 0.06,
      0.01,
      0.004,
      gold,
      i * 0.075,
      0
    );
  bottomMark.position.set(-0.12, -1.02, 0.255);
  model.add(bottomMark);
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext("2d");
  const shade = shadowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  shade.addColorStop(0, "#69332d35");
  shade.addColorStop(1, "#69332d00");
  shadowContext.fillStyle = shade;
  shadowContext.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 0.8),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
    })
  );
  shadow.position.set(0, -1.65, -0.5);
  scene.add(shadow);
  const states = new Map();
  let entries = [],
    frame,
    disposed = false,
    time = 0,
    last = performance.now(),
    width = 0,
    height = 0,
    available = true;
  function inventory() {
    entries = [...root.querySelectorAll(".packet-visual")];
    const current = new Set(entries);
    for (const entry of states.keys())
      if (!current.has(entry)) states.delete(entry);
    for (const entry of entries) {
      if (!states.has(entry))
        states.set(entry, { open: 0, x: 0, y: 0, targetX: 0, targetY: 0 });
      entry.dataset.packetScene = available ? "ready" : "fallback";
    }
  }
  const mutation = new MutationObserver(inventory);
  mutation.observe(root, { childList: true, subtree: true });
  inventory();
  function move(event) {
    const card = event.target.closest(".packet");
    const visual = card?.querySelector(".packet-visual");
    const state = states.get(visual);
    if (!state) return;
    const r = card.getBoundingClientRect();
    state.targetX = ((event.clientX - r.left) / r.width - 0.5) * 2;
    state.targetY = ((event.clientY - r.top) / r.height - 0.5) * 2;
  }
  root.addEventListener("pointermove", move);
  function render(now) {
    frame = requestAnimationFrame(render);
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (disposed || document.hidden || !available) return;
    if (!isPaused()) time += delta;
    if (innerWidth !== width || innerHeight !== height) {
      width = innerWidth;
      height = innerHeight;
      renderer.setSize(width, height);
    }
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    entries.forEach((entry, index) => {
      const rect = entry.getBoundingClientRect();
      if (
        rect.bottom <= 0 ||
        rect.top >= height ||
        rect.right <= 0 ||
        rect.left >= width ||
        rect.width <= 0
      )
        return;
      const state = states.get(entry);
      const paused = isPaused();
      const targetOpen =
        entry.dataset.open === "true" || (!paused && entry.matches(":hover"))
          ? 1
          : 0;
      if (!isPaused()) {
        state.open = THREE.MathUtils.damp(state.open, targetOpen, 4.5, delta);
        state.x = THREE.MathUtils.damp(state.x, state.targetX, 4, delta);
        state.y = THREE.MathUtils.damp(state.y, state.targetY, 4, delta);
      } else {
        state.open = targetOpen;
      }
      const phase = time + index * 1.8;
      model.rotation.set(
        -0.08 + state.y * 0.06,
        -0.3 + state.x * 0.22 + Math.sin(phase * 0.65) * 0.045,
        -0.09 + Math.sin(phase * 0.8) * 0.018
      );
      model.position.y = Math.sin(phase * 0.9) * 0.055;
      flap.rotation.x = state.open * 2.75;
      insert.position.y = 0.38 + state.open * 1.05;
      insert.rotation.z = state.open * 0.035;
      const color = [0xb91d2d, 0xa91b39, 0xca2c25][index % 3];
      red.color.setHex(color);
      fold.color.setHex(color).multiplyScalar(0.83);
      lidMaterial.color.setHex(color).multiplyScalar(1.06);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setViewport(
        rect.left,
        height - rect.bottom,
        rect.width,
        rect.height
      );
      renderer.setScissor(
        Math.max(0, rect.left),
        Math.max(0, height - rect.bottom),
        Math.min(width, rect.right) - Math.max(0, rect.left),
        Math.min(height, rect.bottom) - Math.max(0, rect.top)
      );
      renderer.render(scene, camera);
      entry.dataset.frame = String(Math.floor(time * 100));
      entry.dataset.opening = state.open > 0.5 ? "open" : "closed";
      entry.dataset.motion = isPaused() ? "paused" : "playing";
    });
  }
  function lost(event) {
    event.preventDefault();
    available = false;
    entries.forEach((entry) => (entry.dataset.packetScene = "fallback"));
    canvas.style.visibility = "hidden";
  }
  function restored() {
    available = true;
    canvas.style.visibility = "";
    inventory();
  }
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  frame = requestAnimationFrame(render);
  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      mutation.disconnect();
      root.removeEventListener("pointermove", move);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) o.material.dispose();
      });
      texture.dispose();
      labelTexture.dispose();
      shadowTexture.dispose();
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
