import * as THREE from 'three';
import { generateShapes } from '../shapes.js';
import { dist2D, countExtendedFingers, isFist, createDebouncer, clamp } from '../arUtils.js';
import vertexShader from '../shaders/particle.vert.glsl?raw';
import fragmentShader from '../shaders/particle.frag.glsl?raw';

const SHAPE_NAMES = ['Sphere', 'Torus', 'Galaxy', 'Helix', 'Cube'];
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.0;
const PINCH_MIN = 0.02;
const PINCH_MAX = 0.25;
const SHAPE_LOCK_THRESHOLD = 0.13; // below this pinch distance, freeze the shape instead of re-reading finger count
const BASE_MAX_RADIUS = 2.3; // the galaxy shape's outer radius — the largest of the 5 presets
const SAFE_MARGIN = 0.85; // keep shapes within 85% of the visible frustum, not touching the edges

// Computes the biggest combined scale (base shape size × zoom × stretch) that
// still fits on screen right now — recalculated every frame so it adapts
// instantly to window resizes and, critically, to narrow portrait phone
// screens where there's much less horizontal room than a widescreen laptop.
function computeMaxSafeScale(camera) {
  const halfHeight = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const halfWidth = halfHeight * camera.aspect;
  const maxRadius = Math.min(halfHeight, halfWidth) * SAFE_MARGIN;
  return maxRadius / BASE_MAX_RADIUS;
}

export function createParticleMode(scene, camera, statusEl, isTouchPhone) {
  const isLowCoreCount = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  const count = isTouchPhone ? 8000 : isLowCoreCount ? 12000 : 24000;

  const shapes = generateShapes(count);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(shapes.sphere, 3));
  geometry.setAttribute('aPosB', new THREE.BufferAttribute(shapes.torus, 3));
  geometry.setAttribute('aPosC', new THREE.BufferAttribute(shapes.galaxy, 3));
  geometry.setAttribute('aPosD', new THREE.BufferAttribute(shapes.helix, 3));
  geometry.setAttribute('aPosE', new THREE.BufferAttribute(shapes.cube, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1.0 },
      uTime: { value: 0 },
      uWeights: { value: [1, 0, 0, 0, 0] },
      uStretchAxis: { value: new THREE.Vector3(1, 0, 0) },
      uStretchAmount: { value: 1.0 },
      uColorA: { value: new THREE.Color(0x5eead4) },
      uColorB: { value: new THREE.Color(0xf472b6) },
      uBrightnessBoost: { value: isTouchPhone ? 1.4 : 1.0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;

  const group = new THREE.Group();
  group.add(particles);
  scene.add(group);

  let targetScale = 1.0;
  let currentScale = 1.0;
  let targetWeights = [1, 0, 0, 0, 0];
  let currentWeights = [1, 0, 0, 0, 0];
  let targetStretch = 1.0;
  let currentStretch = 1.0;
  const targetStretchAxis = new THREE.Vector3(1, 0, 0);
  const currentStretchAxis = new THREE.Vector3(1, 0, 0);
  const fingerCountDebouncer = createDebouncer(3);
  let lastFingerCount = 1; // remembers the shape selection made before an active pinch locks it in

  function oneHot(index, length) {
    const arr = new Array(length).fill(0);
    arr[index] = 1;
    return arr;
  }

  function updateGesture(results) {
    const hands = results.landmarks || [];

    if (hands.length >= 2) {
      const palmA = hands[0][9];
      const palmB = hands[1][9];
      const dx = palmB.x - palmA.x;
      const dy = palmB.y - palmA.y;
      const handDist = Math.sqrt(dx * dx + dy * dy);

      const t = clamp((handDist - 0.15) / (0.9 - 0.15), 0, 1);
      targetStretch = 1.0 + t * 1.8;

      if (handDist > 0.001) {
        targetStretchAxis.set(-dx, -dy, 0).normalize();
      }
      targetScale = 1.1;
      statusEl.textContent = 'Two hands — stretching the shape';
    } else if (hands.length === 1) {
      targetStretch = 1.0;

      const lm = hands[0];

      if (isFist(lm)) {
        targetScale = 0.35;
        statusEl.textContent = 'Fist — collapsed';
      } else {
        const thumbTip = lm[4];
        const indexTip = lm[8];
        const pinchDist = dist2D(thumbTip, indexTip);
        const t = clamp((pinchDist - PINCH_MIN) / (PINCH_MAX - PINCH_MIN), 0, 1);
        targetScale = SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);

        // Only re-read the finger count while the hand is clearly NOT
        // pinching. Pinching itself curls the index finger toward the
        // thumb, which would otherwise get misread as a finger-count
        // change and flip the shape mid-resize — exactly the "pinching
        // turns it into a ring" bug. Once locked, the last selection holds
        // for the whole resize gesture.
        if (pinchDist > SHAPE_LOCK_THRESHOLD) {
          const rawFingerCount = countExtendedFingers(lm);
          lastFingerCount = fingerCountDebouncer(rawFingerCount) ?? rawFingerCount;
          const shapeIndex = clamp(lastFingerCount - 1, 0, 4);
          targetWeights = oneHot(shapeIndex, 5);
        }

        const shapeIndex = clamp(lastFingerCount - 1, 0, 4);
        statusEl.textContent =
          pinchDist > SHAPE_LOCK_THRESHOLD
            ? `${lastFingerCount} finger${lastFingerCount > 1 ? 's' : ''} — ${SHAPE_NAMES[shapeIndex]} · pinch to resize`
            : `Resizing — ${SHAPE_NAMES[shapeIndex]}`;
      }
    } else {
      targetStretch = 1.0;
      statusEl.textContent = 'Show your hand to the camera';
    }
  }

  function tick(dt) {
    // Converted from flat per-frame lerp factors to dt-scaled exponential
    // decay — the old flat-factor version made the whole mode respond and
    // animate faster on high-refresh-rate displays (90/120Hz phones) and
    // slower on 60Hz ones, since it was applied once per render call
    // rather than scaled to real elapsed time. These decay rates are
    // chosen to closely reproduce the original feel at a 60fps reference.
    const scaleFactor = 1 - Math.exp(-9 * dt);
    const weightFactor = 1 - Math.exp(-6.5 * dt);

    currentScale += (targetScale - currentScale) * scaleFactor;
    currentStretch += (targetStretch - currentStretch) * scaleFactor;
    currentStretchAxis.lerp(targetStretchAxis, scaleFactor);
    if (currentStretchAxis.lengthSq() > 0.0001) currentStretchAxis.normalize();

    for (let i = 0; i < 5; i++) {
      currentWeights[i] += (targetWeights[i] - currentWeights[i]) * weightFactor;
    }

    // Keep the combined size on screen regardless of scale + stretch + aspect ratio
    const maxSafeScale = computeMaxSafeScale(camera);
    let displayScale = currentScale;
    let displayStretch = currentStretch;
    const combined = displayScale * displayStretch;
    if (combined > maxSafeScale) {
      const factor = maxSafeScale / combined;
      displayScale *= factor;
      displayStretch *= factor;
    }

    material.uniforms.uScale.value = displayScale;
    material.uniforms.uStretchAmount.value = displayStretch;
    material.uniforms.uStretchAxis.value.copy(currentStretchAxis);
    material.uniforms.uWeights.value = currentWeights;
    material.uniforms.uTime.value += 0.6 * dt;
    particles.rotation.y += 0.15 * dt;
  }

  function setActive(active) {
    group.visible = active;
  }

  return { updateGesture, tick, setActive };
}
