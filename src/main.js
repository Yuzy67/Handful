import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createParticleMode } from './modes/particles.js';
import { createDrawMode } from './modes/draw.js';

// ---- DOM ----
const video = document.getElementById('webcam');
const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');

const startBtn = document.getElementById('startBtn');
const startScreen = document.getElementById('startScreen');

const modeSelectScreen = document.getElementById('modeSelectScreen');
const pickParticlesBtn = document.getElementById('pickParticlesBtn');
const pickDrawBtn = document.getElementById('pickDrawBtn');
const switchModeBtn = document.getElementById('switchModeBtn');
const clearBtn = document.getElementById('clearBtn');
const guideBtn = document.getElementById('guideBtn');

const particleGuideOverlay = document.getElementById('particleGuideOverlay');
const closeParticleGuide = document.getElementById('closeParticleGuide');
const drawGuideOverlay = document.getElementById('drawGuideOverlay');
const closeDrawGuide = document.getElementById('closeDrawGuide');

// ---- three.js + tracking state ----
let handLandmarker;
let scene, camera, renderer;
let particleMode, drawMode;
let activeMode = 'particles'; // 'particles' | 'draw'
let lastVideoTime = -1;
let lastFrameTime = 0;

function isTouchPhoneDevice() {
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 800;
}

// ---- camera + hand tracking setup (shared by both modes) ----
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
    console.warn('GPU delegate failed, falling back to CPU:', err);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  }
}

// ---- scene setup (shared canvas/renderer/camera for both modes) ----
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

  const isTouchPhone = isTouchPhoneDevice();
  particleMode = createParticleMode(scene, camera, statusEl, isTouchPhone);
  drawMode = createDrawMode(scene, camera, statusEl, isTouchPhone);

  particleMode.setActive(true);
  drawMode.setActive(false);

  lastFrameTime = performance.now();
}

// ---- mode switching ----
function setActiveMode(mode) {
  activeMode = mode;
  particleMode.setActive(mode === 'particles');
  drawMode.setActive(mode === 'draw');
  clearBtn.classList.toggle('hidden', mode !== 'draw');
}

// ---- detection + render loops ----
function detectLoop() {
  if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());
    if (activeMode === 'draw') {
      drawMode.updateGesture(results);
    } else {
      particleMode.updateGesture(results);
    }
  }
  requestAnimationFrame(detectLoop);
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  particleMode.tick();
  drawMode.tick(dt);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- boot: particle preview renders immediately, camera comes later ----
initScene();
animate();

// ---- UI wiring ----
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  try {
    await initCamera();
    await initHandLandmarker();
    startScreen.classList.add('hidden');
    modeSelectScreen.classList.remove('hidden');
    guideBtn.classList.remove('hidden');
    switchModeBtn.classList.remove('hidden');
    detectLoop();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Camera access failed — check browser permissions';
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }
});

pickParticlesBtn.addEventListener('click', () => {
  setActiveMode('particles');
  modeSelectScreen.classList.add('hidden');
});

pickDrawBtn.addEventListener('click', () => {
  setActiveMode('draw');
  modeSelectScreen.classList.add('hidden');
});

switchModeBtn.addEventListener('click', () => {
  modeSelectScreen.classList.remove('hidden');
});

clearBtn.addEventListener('click', () => {
  drawMode.clear();
});

guideBtn.addEventListener('click', () => {
  if (activeMode === 'draw') {
    drawGuideOverlay.classList.remove('hidden');
  } else {
    particleGuideOverlay.classList.remove('hidden');
  }
});

closeParticleGuide.addEventListener('click', () => particleGuideOverlay.classList.add('hidden'));
closeDrawGuide.addEventListener('click', () => drawGuideOverlay.classList.add('hidden'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // non-critical — app still works without it, just not installable
    });
  });
}
