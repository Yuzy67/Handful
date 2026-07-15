import * as THREE from 'three';

export function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export function isExtended(lm, tipIdx, refIdx, wristIdx = 0) {
  return dist2D(lm[tipIdx], lm[wristIdx]) > dist2D(lm[refIdx], lm[wristIdx]) * 1.15;
}

export function countExtendedFingers(lm) {
  let count = 0;
  if (isExtended(lm, 4, 2)) count++; // thumb
  if (isExtended(lm, 8, 6)) count++; // index
  if (isExtended(lm, 12, 10)) count++; // middle
  if (isExtended(lm, 16, 14)) count++; // ring
  if (isExtended(lm, 20, 18)) count++; // pinky
  return count;
}

// True when only the index finger is extended (a "pointing" pose) —
// thumb state is ignored since it varies naturally while pointing.
export function isPointing(lm) {
  return (
    isExtended(lm, 8, 6) &&
    !isExtended(lm, 12, 10) &&
    !isExtended(lm, 16, 14) &&
    !isExtended(lm, 20, 18)
  );
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
