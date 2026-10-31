// Render layer only: consumes src/core.mjs output, never re-implements geometry.
import * as THREE from "three";
import { compare } from "./src/core.mjs";

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 4.5, 9);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 60);
const target = new THREE.Vector3(0, 0, 0);
const orbit = { theta: 0.7, phi: 1.12, radius: 3.6 };
function placeCamera() {
  camera.position.set(
    target.x + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
    target.y + orbit.radius * Math.cos(orbit.phi),
    target.z + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta)
  );
  camera.lookAt(target);
}

scene.add(new THREE.HemisphereLight(0xbcd9ff, 0x0a1418, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(2.4, 3.2, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x3ddc97, 0.9);
rim.position.set(-2.6, -1.2, -2.2);
scene.add(rim);

const group = new THREE.Group();
scene.add(group);
const material = new THREE.MeshStandardMaterial({
  color: 0x5fd6b4, metalness: 0.18, roughness: 0.42, flatShading: false,
});
const wireMaterial = new THREE.MeshBasicMaterial({
  color: 0x9df3cf, wireframe: true, transparent: true, opacity: 0.16,
});
let mesh = null, wireMesh = null;
let wireOn = false;

function build(spec, res, referenceVolume) {
  const t0 = performance.now();
  const out = compare(spec, res);
  const ms = performance.now() - t0;

  if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
  if (wireMesh) { group.remove(wireMesh); wireMesh.geometry.dispose(); }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(out.mesh.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(out.mesh.indices), 1));
  geo.computeVertexNormals();
  mesh = new THREE.Mesh(geo, material);
  group.add(mesh);

  wireMesh = new THREE.Mesh(geo, wireMaterial);
  wireMesh.visible = wireOn;
  group.add(wireMesh);

  const volumeError = Math.abs(out.volume - referenceVolume) / referenceVolume;
  document.getElementById("s-res").textContent = `${res}\u00b3`;
  document.getElementById("s-dense").textContent = out.dense.evals.toLocaleString();
  document.getElementById("s-pruned").textContent = out.pruned.evals.toLocaleString();
  document.getElementById("s-cut").textContent = `${(out.pruned.evalReduction * 100).toFixed(1)}%`;
  document.getElementById("s-tris").textContent = out.dense.triangles.toLocaleString();
  document.getElementById("s-vol").textContent = out.volume.toFixed(5);
  document.getElementById("s-err").textContent = `${(volumeError * 100).toFixed(3)}%`;
  document.getElementById("s-mm").textContent = String(out.manifold.nonManifoldEdges);
  document.getElementById("s-ident").textContent = out.identical ? "bit-identical" : "DIVERGED";
  document.getElementById("s-ident").className = out.identical ? "val good" : "val warn";
  document.getElementById("s-ms").textContent = `${ms.toFixed(0)} ms`;

  const label = document.getElementById("lbl-res");
  label.textContent = String(res);
}

const data = await (await fetch("./data/field.json")).json();
build(data.spec, 128, data.reference.volume);

// --- orbit / zoom (no addons) ---
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  orbit.theta -= (e.clientX - lastX) * 0.006;
  orbit.phi = Math.max(0.12, Math.min(Math.PI - 0.12, orbit.phi - (e.clientY - lastY) * 0.006));
  lastX = e.clientX; lastY = e.clientY;
  placeCamera();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  orbit.radius = Math.max(1.6, Math.min(8, orbit.radius * (1 + Math.sign(e.deltaY) * 0.08)));
  placeCamera();
}, { passive: false });

// --- controls ---
let spin = true;
const slider = document.getElementById("res");
slider.addEventListener("input", () => {
  const res = 2 ** Number(slider.value);
  document.getElementById("lbl-res").textContent = `${res} (computing…)`;
  // Yield one frame so the label paints before the synchronous core run.
  requestAnimationFrame(() => setTimeout(() => build(data.spec, res, data.reference.volume), 0));
});
document.getElementById("wire").addEventListener("click", (e) => {
  wireOn = !wireOn;
  e.currentTarget.classList.toggle("on", wireOn);
  if (wireMesh) wireMesh.visible = wireOn;
});
document.getElementById("spin").addEventListener("click", (e) => {
  spin = !spin;
  e.currentTarget.classList.toggle("on", spin);
});
document.getElementById("reset").addEventListener("click", () => {
  orbit.theta = 0.7; orbit.phi = 1.12; orbit.radius = 3.6;
  placeCamera();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

placeCamera();
renderer.setAnimationLoop(() => {
  if (spin && !dragging) orbit.theta += 0.0022;
  placeCamera();
  renderer.render(scene, camera);
});
