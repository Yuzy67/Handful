import * as THREE from 'three';
import { landmarkToWorld, isPointing, isFist, countExtendedFingers, createDebouncer } from '../arUtils.js';

const THEMES = ['Electric', 'Fire', 'Water', 'Leaf'];
const DRAW_DISTANCE = 3.2; // how far in front of the camera the drawing plane sits
const MIN_POINT_SPACING = 0.009; // world units — guards against duplicate/degenerate curve points
const CORE_RADIUS = [0.026, 0.044, 0.036, 0.04]; // electric thinnest (like an arc), fire thickest
const TIP_SMOOTHING = 0.3; // lower = smoother line, higher = more responsive to raw jitter
const GRAB_SMOOTHING = 0.3; // same idea, applied to the fist's drag position
const GRAB_BOUNDS = { x: 4, y: 3, z: 3 };
const MAX_FINISHED_STROKES = 60; // a generous cap — normal use never approaches it, but it
// bounds how much geometry can accumulate over a very long, uninterrupted drawing session

// dynamic import so the vert/frag shaders live in their own files, same
// pattern as every other shader in this project
import tubeVert from '../shaders/tube.vert.glsl?raw';
import tubeFrag from '../shaders/tube.frag.glsl?raw';

/**
 * Draw mode: point with your index finger (other fingers curled) and move
 * your hand to paint a continuous glowing 3D tube tracing that path — real
 * extruded geometry, not a particle effect. Finished strokes persist until
 * cleared. Make a fist to grab and drag the entire drawing as one piece.
 */
export function createDrawMode(scene, camera, statusEl, isTouchPhone) {
  const radialSegments = isTouchPhone ? 6 : 10;
  const tubularSegmentsPerPoint = isTouchPhone ? 2 : 4;
  const maxPointsPerStroke = isTouchPhone ? 300 : 500;

  const group = new THREE.Group();
  scene.add(group);
  group.visible = false;

  let currentTheme = 0;
  let clock = 0;

  let activePoints = null;
  let activeCoreMesh = null;
  let activeHaloMesh = null;
  let activeCoreMat = null;
  let activeHaloMat = null;
  let smoothedTip = null; // {x, y} in normalized landmark space, eased toward the raw fingertip

  let isGrabbing = false;
  const grabAnchor = new THREE.Vector3();
  const groupStartPos = new THREE.Vector3();
  let smoothedPalm = null; // {x, y} eased toward the raw palm landmark, same idea as smoothedTip
  const fingerCountDebouncer = createDebouncer(3);

  const strokes = []; // finished strokes: { core, halo, coreMat, haloMat }

  function makeMaterial(themeIndex, alpha, glowBoost, blending, depthWrite) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: clock },
        uTheme: { value: themeIndex },
        uAlpha: { value: alpha },
        uGlowBoost: { value: glowBoost },
      },
      vertexShader: tubeVert,
      fragmentShader: tubeFrag,
      transparent: true,
      depthWrite,
      blending,
      side: THREE.DoubleSide,
    });
  }

  function buildTubeGeometry(points, radius) {
    const curve = new THREE.CatmullRomCurve3(points);
    const tubularSegments = Math.min(
      Math.max(points.length * tubularSegmentsPerPoint, 8),
      1200
    );
    return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  }

  function makeDotGeometry(point, radius) {
    const geo = new THREE.SphereGeometry(radius, 10, 8);
    geo.translate(point.x, point.y, point.z);
    return geo;
  }

  function beginStroke(point) {
    activePoints = [point.clone()];
    const radius = CORE_RADIUS[currentTheme];

    activeCoreMat = makeMaterial(currentTheme, 1.0, 0.0, THREE.NormalBlending, true);
    activeCoreMesh = new THREE.Mesh(makeDotGeometry(point, radius), activeCoreMat);
    group.add(activeCoreMesh);

    activeHaloMat = makeMaterial(currentTheme, 0.35, 0.6, THREE.AdditiveBlending, false);
    activeHaloMesh = new THREE.Mesh(makeDotGeometry(point, radius * 2.3), activeHaloMat);
    group.add(activeHaloMesh);
  }

  function refreshActiveMesh() {
    if (!activePoints || activePoints.length < 2) return;

    const radius = CORE_RADIUS[currentTheme];
    const newCoreGeo = buildTubeGeometry(activePoints, radius);
    const newHaloGeo = buildTubeGeometry(activePoints, radius * 2.3);

    activeCoreMesh.geometry.dispose();
    activeCoreMesh.geometry = newCoreGeo;

    activeHaloMesh.geometry.dispose();
    activeHaloMesh.geometry = newHaloGeo;
  }

  function extendStroke(point) {
    if (!activePoints) {
      beginStroke(point);
      return;
    }
    const last = activePoints[activePoints.length - 1];
    if (last.distanceTo(point) < MIN_POINT_SPACING) return;
    if (activePoints.length >= maxPointsPerStroke) return; // soft cap — stroke just stops growing

    activePoints.push(point.clone());
    refreshActiveMesh();
  }

  function endStroke() {
    if (activeCoreMesh) {
      strokes.push({
        core: activeCoreMesh,
        halo: activeHaloMesh,
        coreMat: activeCoreMat,
        haloMat: activeHaloMat,
      });
      if (strokes.length > MAX_FINISHED_STROKES) {
        const oldest = strokes.shift();
        group.remove(oldest.core);
        group.remove(oldest.halo);
        oldest.core.geometry.dispose();
        oldest.halo.geometry.dispose();
        oldest.coreMat.dispose();
        oldest.haloMat.dispose();
      }
    }
    activePoints = null;
    activeCoreMesh = null;
    activeHaloMesh = null;
    activeCoreMat = null;
    activeHaloMat = null;
    smoothedTip = null;
  }

  function updateGesture(results) {
    const hands = results.landmarks || [];

    if (hands.length === 0) {
      if (activePoints) endStroke();
      isGrabbing = false;
      smoothedPalm = null;
      statusEl.textContent = `Show your hand — ${THEMES[currentTheme]} brush selected`;
      return;
    }

    const lm = hands[0];

    if (isPointing(lm)) {
      isGrabbing = false;
      smoothedPalm = null;
      const rawTip = lm[8]; // index fingertip

      if (!smoothedTip) {
        smoothedTip = { x: rawTip.x, y: rawTip.y };
      } else {
        smoothedTip.x += (rawTip.x - smoothedTip.x) * TIP_SMOOTHING;
        smoothedTip.y += (rawTip.y - smoothedTip.y) * TIP_SMOOTHING;
      }

      const worldPos = landmarkToWorld(smoothedTip, camera, DRAW_DISTANCE);
      extendStroke(worldPos);
      statusEl.textContent = `Drawing — ${THEMES[currentTheme]}`;
      return;
    }

    if (activePoints) endStroke();

    const rawFingerCount = countExtendedFingers(lm);

    // Hysteresis: a true fist is required to START a grab, but once
    // grabbing, a single noisy frame reading 1 finger won't cancel it —
    // this is what keeps a hold-and-drag feeling continuous instead of
    // stuttering every time hand tracking flickers for a frame. isFist()
    // ignores the thumb entirely, since a resting thumb next to a closed
    // fist was the main reason grabs failed to trigger at all before.
    const shouldGrab = isGrabbing ? rawFingerCount <= 1 : isFist(lm);

    if (shouldGrab) {
      const rawPalm = lm[9];

      if (!smoothedPalm) {
        smoothedPalm = { x: rawPalm.x, y: rawPalm.y };
      } else {
        smoothedPalm.x += (rawPalm.x - smoothedPalm.x) * GRAB_SMOOTHING;
        smoothedPalm.y += (rawPalm.y - smoothedPalm.y) * GRAB_SMOOTHING;
      }

      const worldPos = landmarkToWorld(smoothedPalm, camera, DRAW_DISTANCE);

      if (!isGrabbing) {
        isGrabbing = true;
        grabAnchor.copy(worldPos);
        groupStartPos.copy(group.position);
      } else {
        const delta = new THREE.Vector3().subVectors(worldPos, grabAnchor);
        group.position.copy(groupStartPos).add(delta);
        group.position.x = THREE.MathUtils.clamp(group.position.x, -GRAB_BOUNDS.x, GRAB_BOUNDS.x);
        group.position.y = THREE.MathUtils.clamp(group.position.y, -GRAB_BOUNDS.y, GRAB_BOUNDS.y);
        group.position.z = THREE.MathUtils.clamp(group.position.z, -GRAB_BOUNDS.z, GRAB_BOUNDS.z);
      }
      statusEl.textContent = 'Fist — moving your drawing';
      return;
    }

    isGrabbing = false;
    smoothedPalm = null;

    const fingerCount = fingerCountDebouncer(rawFingerCount) ?? rawFingerCount;
    if (fingerCount >= 2 && fingerCount <= 5) {
      currentTheme = fingerCount - 2; // 2 fingers->Electric, 3->Fire, 4->Water, 5->Leaf
    }
    statusEl.textContent = `${THEMES[currentTheme]} brush — point with index finger to draw`;
  }

  function tick(dt) {
    clock += dt;
    if (activeCoreMat) activeCoreMat.uniforms.uTime.value = clock;
    if (activeHaloMat) activeHaloMat.uniforms.uTime.value = clock;
    for (const s of strokes) {
      s.coreMat.uniforms.uTime.value = clock;
      s.haloMat.uniforms.uTime.value = clock;
    }
  }

  function clear() {
    if (activePoints) endStroke();
    for (const s of strokes) {
      group.remove(s.core);
      group.remove(s.halo);
      s.core.geometry.dispose();
      s.halo.geometry.dispose();
      s.coreMat.dispose();
      s.haloMat.dispose();
    }
    strokes.length = 0;
    group.position.set(0, 0, 0);
  }

  function setActive(active) {
    group.visible = active;
    if (!active) {
      if (activePoints) endStroke();
      isGrabbing = false;
      smoothedPalm = null;
    }
  }

  return { updateGesture, tick, clear, setActive };
}
