import * as THREE from 'three';

export function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// A curled finger moves mostly in depth (toward/away from the camera), not
// in screen-space x/y — a 2D-only distance barely registers that motion
// unless the hand happens to be oriented so the curl lines up with the
// camera's flat plane. Using the z MediaPipe already provides makes curl
// detection work regardless of hand orientation. z is a noisier estimate
// than x/y (depth from a single camera is inherently harder), so it's
// weighted down slightly rather than trusted equally.
function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = ((a.z || 0) - (b.z || 0)) * 0.7;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// A stable reference for "how big is this hand is in the frame" (wrist to
// middle-finger knuckle) — used to scale extension thresholds so detection
// behaves consistently whether the hand is close to the camera (typical
// laptop webcam use) or farther away (typical phone selfie-camera distance),
// instead of a flat ratio that only really works well at one distance.
function handScale(lm) {
  return dist3D(lm[0], lm[9]) || 0.001;
}

function isExtendedRaw(lm, tipIdx, refIdx, scale, marginMultiplier, wristIdx = 0) {
  const margin = scale * 0.22 * marginMultiplier;
  return dist3D(lm[tipIdx], lm[wristIdx]) - dist3D(lm[refIdx], lm[wristIdx]) > margin;
}

// General single-finger check, exported for reuse. Internal call sites below
// use isExtendedRaw directly so they can share one precomputed handScale
// instead of recomputing it per finger.
export function isExtended(lm, tipIdx, refIdx, wristIdx = 0) {
  return isExtendedRaw(lm, tipIdx, refIdx, handScale(lm), 1.0, wristIdx);
}

// Counts extended fingers, thumb included. The thumb uses a noticeably
// stricter margin than the other four: in its natural resting position the
// thumb very often reads as borderline "extended" under a simple distance
// check, which was silently inflating every count by one (2 fingers reading
// as 3, 3 as 4, and so on). It still registers when clearly, deliberately
// extended (e.g. an open palm), just not from a relaxed resting position.
export function countExtendedFingers(lm) {
  const scale = handScale(lm);
  let count = 0;
  if (isExtendedRaw(lm, 4, 2, scale, 1.7)) count++; // thumb — stricter margin
  if (isExtendedRaw(lm, 8, 6, scale, 1.0)) count++; // index
  if (isExtendedRaw(lm, 12, 10, scale, 1.0)) count++; // middle
  if (isExtendedRaw(lm, 16, 14, scale, 1.0)) count++; // ring
  if (isExtendedRaw(lm, 20, 18, scale, 1.0)) count++; // pinky
  return count;
}

// True when only the index finger is extended (a "pointing" pose) — thumb
// state is ignored since it varies naturally while pointing.
export function isPointing(lm) {
  const scale = handScale(lm);
  return (
    isExtendedRaw(lm, 8, 6, scale, 1.0) &&
    !isExtendedRaw(lm, 12, 10, scale, 1.0) &&
    !isExtendedRaw(lm, 16, 14, scale, 1.0) &&
    !isExtendedRaw(lm, 20, 18, scale, 1.0)
  );
}

// True when the four fingers (excluding thumb) are all curled — a fist.
// Thumb is intentionally excluded: many people naturally rest the thumb
// across or beside a closed fist rather than fully tucked in, and requiring
// it to also register "curled" made grab/collapse gestures fail constantly.
export function isFist(lm) {
  const scale = handScale(lm);
  return (
    !isExtendedRaw(lm, 8, 6, scale, 1.0) &&
    !isExtendedRaw(lm, 12, 10, scale, 1.0) &&
    !isExtendedRaw(lm, 16, 14, scale, 1.0) &&
    !isExtendedRaw(lm, 20, 18, scale, 1.0)
  );
}

// Requires the same raw value for `requiredFrames` consecutive calls before
// "committing" to it. This filters out single-frame hand-tracking noise
// (a momentary misread of 3 fingers instead of 2) without adding
// perceptible lag, since a real, deliberate gesture change is naturally
// held for longer than ~3 frames anyway.
export function createDebouncer(requiredFrames = 3) {
  let candidate = null;
  let streak = 0;
  let committed = null;

  return function update(value) {
    if (value === candidate) {
      streak++;
    } else {
      candidate = value;
      streak = 1;
    }
    if (streak >= requiredFrames) {
      committed = candidate;
    }
    return committed;
  };
}

/**
 * One Euro Filter (Casiez, Godin, Vogel 2012) — the standard technique for
 * smoothing noisy real-time position signals like hand/finger tracking. It
 * adapts its own smoothing strength to the signal's speed: heavy smoothing
 * while nearly still (kills tracking jitter), automatically loosening up
 * during fast movement so a real swipe doesn't feel laggy or delayed. This
 * is a meaningfully better fit here than a flat exponential-moving-average,
 * which has to pick one smoothing strength that's always a compromise
 * between "smooth when still" and "responsive when fast."
 *
 * minCutoff: smoothing strength at rest — lower is smoother but adds lag.
 * beta: how quickly smoothing backs off as speed increases — higher means
 * fast motion stays crisper.
 */
export function createOneEuroFilter(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
  let xPrev = null;
  let dxPrev = 0;
  let tPrev = null;

  function alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  return {
    filter(x, t) {
      if (tPrev === null) {
        tPrev = t;
        xPrev = x;
        dxPrev = 0;
        return x;
      }
      const dt = Math.max(t - tPrev, 1e-6);
      tPrev = t;

      const dx = (x - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      const dxHat = aD * dx + (1 - aD) * dxPrev;

      const cutoff = minCutoff + beta * Math.abs(dxHat);
      const a = alpha(cutoff, dt);
      const xHat = a * x + (1 - a) * xPrev;

      xPrev = xHat;
      dxPrev = dxHat;
      return xHat;
    },
    reset() {
      xPrev = null;
      dxPrev = 0;
      tPrev = null;
    },
  };
}

/**
 * Converts a mirrored-screen-space hand landmark (normalized 0..1, in raw
 * unmirrored camera coordinates, as MediaPipe returns them) into a 3D world
 * position sitting on a virtual pane a fixed `distance` in front of the
 * camera. This is what makes AR drawing actually line up with where your
 * fingertip appears on screen, rather than floating at an arbitrary spot —
 * it's recomputed every call from the camera's live fov/aspect, so it stays
 * correct across window resizes and orientation changes.
 */
export function landmarkToWorld(point, camera, distance) {
  const mirroredX = 1 - point.x; // video is displayed mirrored via CSS
  const ndcX = (mirroredX - 0.5) * 2;
  const ndcY = -(point.y - 0.5) * 2;

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfHeight = Math.tan(vFov / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;

  return new THREE.Vector3(
    camera.position.x + ndcX * halfWidth,
    camera.position.y + ndcY * halfHeight,
    camera.position.z - distance
  );
}
