import * as THREE from 'three';
import { generateShapes } from '../shapes.js';
import { dist2D, countExtendedFingers, clamp } from '../arUtils.js';
import vertexShader from '../shaders/particle.vert.glsl?raw';
import fragmentShader from '../shaders/particle.frag.glsl?raw';

const SHAPE_NAMES = ['Sphere', 'Torus', 'Galaxy', 'Helix', 'Cube'];
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.0;
const PINCH_MIN = 0.02;
const PINCH_MAX = 0.25;

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

  function tick() {
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
  }

  function setActive(active) {
    group.visible = active;
  }

  return { updateGesture, tick, setActive };
}
