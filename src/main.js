import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { generateShapes } from './shapes.js';

import vertexShader from './shaders/particle.vert.glsl?raw';
import fragmentShader from './shaders/particle.frag.glsl?raw';

// ---- DOM ----
const video = document.getElementById('webcam');
const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const startScreen = document.getElementById('startScreen');
const guideOverlay = document.getElementById('guideOverlay');
const guideBtn = document.getElementById('guideBtn');
const openGuideFromStart = document.getElementById('openGuideFromStart');
const closeGuide = document.getElementById('closeGuide');

// ---- three.js state ----
let handLandmarker;
let scene, camera, renderer, particles, material;
let lastVideoTime = -1;

// ---- gesture-driven targets (what we're smoothing toward) ----
const SHAPE_NAMES = ['Sphere', 'Torus', 'Galaxy', 'Helix', 'Cube'];
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.0;
const PINCH_MIN = 0.02;
const PINCH_MAX = 0.25;

let targetScale = 1.0;
let currentScale = 1.0;

let targetWeights = [1, 0, 0, 0, 0]; // starts as sphere
let currentWeights = [1, 0, 0, 0, 0];

let targetStretch = 1.0;
let currentStretch = 1.0;
const targetStretchAxis = new THREE.Vector3(1, 0, 0);
const currentStretchAxis = new THREE.Vector3(1, 0, 0);

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function oneHot(index, length) {
  const arr = new Array(length).fill(0);
  arr[index] = 1;
  return arr;
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isExtended(lm, tipIdx, refIdx, wristIdx = 0) {
  return dist2D(lm[tipIdx], lm[wristIdx]) > dist2D(lm[refIdx], lm[wristIdx]) * 1.15;
}

function countExtendedFingers(lm) {
  let count = 0;
  if (isExtended(lm, 4, 2)) count++; // thumb
  if (isExtended(lm, 8, 6)) count++; // index
  if (isExtended(lm, 12, 10)) count++; // middle
  if (isExtended(lm, 16, 14)) count++; // ring
  if (isExtended(lm, 20, 18)) count++; // pinky
  return count;
}

// ---- camera + hand tracking setup ----
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
    },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  const modelAssetPath =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  } catch (err) {
    // Some mobile GPUs/browsers don't support the GPU delegate reliably —
    // fall back to CPU rather than failing the whole app.
    console.warn('GPU delegate failed, falling back to CPU:', err);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  }
}

// ---- scene setup ----
function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.z = 6;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const isTouchPhone = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 800;
  const isLowCoreCount = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  const count = isTouchPhone ? 8000 : isLowCoreCount ? 12000 : 24000;

  const shapes = generateShapes(count);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(shapes.sphere, 3));
  geometry.setAttribute('aPosB', new THREE.BufferAttribute(shapes.torus, 3));
  geometry.setAttribute('aPosC', new THREE.BufferAttribute(shapes.galaxy, 3));
  geometry.setAttribute('aPosD', new THREE.BufferAttribute(shapes.helix, 3));
  geometry.setAttribute('aPosE', new THREE.BufferAttribute(shapes.cube, 3));

  material = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1.0 },
      uTime: { value: 0 },
      uWeights: { value: [1, 0, 0, 0, 0] },
      uStretchAxis: { value: new THREE.Vector3(1, 0, 0) },
      uStretchAmount: { value: 1.0 },
      uColorA: { value: new THREE.Color(0x5eead4) }, // teal
      uColorB: { value: new THREE.Color(0xf472b6) }, // pink
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);
}

// ---- gesture engine: landmarks -> targets ----
function updateGestureFromResults(results) {
  const hands = results.landmarks || [];

  if (hands.length >= 2) {
    // Two hands: distance + direction between palms controls stretch.
    const palmA = hands[0][9]; // middle-finger MCP ~= palm center
    const palmB = hands[1][9];
    const dx = palmB.x - palmA.x;
    const dy = palmB.y - palmA.y;
    const handDist = Math.sqrt(dx * dx + dy * dy);

    const t = clamp((handDist - 0.15) / (0.9 - 0.15), 0, 1);
    targetStretch = 1.0 + t * 1.8;

    // flip x/y to match the mirrored display so the stretch feels natural
    if (handDist > 0.001) {
      targetStretchAxis.set(-dx, -dy, 0).normalize();
    }
    targetScale = 1.1;
    statusEl.textContent = 'Two hands — stretching the shape';
  } else if (hands.length === 1) {
    targetStretch = 1.0; // relax stretch when only one hand is up

    const lm = hands[0];
    const fingerCount = countExtendedFingers(lm);

    if (fingerCount === 0) {
      targetScale = 0.35;
      statusEl.textContent = 'Fist — collapsed';
    } else {
      const thumbTip = lm[4];
      const indexTip = lm[8];
      const pinchDist = dist2D(thumbTip, indexTip);
      const t = clamp((pinchDist - PINCH_MIN) / (PINCH_MAX - PINCH_MIN), 0, 1);
      targetScale = SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);

      const shapeIndex = clamp(fingerCount - 1, 0, 4);
      targetWeights = oneHot(shapeIndex, 5);
      statusEl.textContent = `${fingerCount} finger${fingerCount > 1 ? 's' : ''} — ${SHAPE_NAMES[shapeIndex]} · pinch to resize`;
    }
  } else {
    targetStretch = 1.0;
    statusEl.textContent = 'Show your hand to the camera';
  }
}

function detectLoop() {
  if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());
    updateGestureFromResults(results);
  }
  requestAnimationFrame(detectLoop);
}

// ---- render loop ----
function animate() {
  requestAnimationFrame(animate);

  currentScale += (targetScale - currentScale) * 0.08;
  currentStretch += (targetStretch - currentStretch) * 0.08;
  currentStretchAxis.lerp(targetStretchAxis, 0.08);
  if (currentStretchAxis.lengthSq() > 0.0001) currentStretchAxis.normalize();

  for (let i = 0; i < 5; i++) {
    currentWeights[i] += (targetWeights[i] - currentWeights[i]) * 0.06;
  }

  material.uniforms.uScale.value = currentScale;
  material.uniforms.uStretchAmount.value = currentStretch;
  material.uniforms.uStretchAxis.value.copy(currentStretchAxis);
  material.uniforms.uWeights.value = currentWeights;
  material.uniforms.uTime.value += 0.01;
  particles.rotation.y += 0.0015;

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- UI wiring ----
// Start the particle scene immediately so it's visible as a live preview
// behind the landing page — camera and hand tracking only start on click.
initScene();
animate();

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  try {
    await initCamera();
    await initHandLandmarker();
    startScreen.classList.add('hidden');
    detectLoop();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Camera access failed — check browser permissions';
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }
});

guideBtn.addEventListener('click', () => guideOverlay.classList.remove('hidden'));
openGuideFromStart.addEventListener('click', () => guideOverlay.classList.remove('hidden'));
closeGuide.addEventListener('click', () => guideOverlay.classList.add('hidden'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // non-critical — app still works without it, just not installable
    });
  });
}
