attribute float aBirth;
attribute float aTheme; // 0 = electric, 1 = fire, 2 = water, 3 = leaf
attribute float aSeed;

uniform float uTime;

varying float vAlpha;
varying float vTheme;

void main() {
  float age = uTime - aBirth;

  float lifetime;
  if (aTheme < 0.5) lifetime = 3.0;       // electric — quick flicker
  else if (aTheme < 1.5) lifetime = 5.0;  // fire — burns for a few seconds
  else if (aTheme < 2.5) lifetime = 7.5;  // water — flows and lingers
  else lifetime = 11.0;                    // leaf — drifts the longest

  // Not yet spawned, or fully faded: push off-frustum and zero-size
  // rather than branching out of the shader (keeps it simple and safe).
  if (age < 0.0 || age > lifetime) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vTheme = aTheme;
    return;
  }

  float t = age / lifetime;
  vec3 pos = position;
  float n = aSeed * 6.2831853;

  if (aTheme < 0.5) {
    // Electric: fast, tight jitter, no real drift
    pos.x += sin(uTime * 40.0 + n) * 0.02 * (1.0 - t);
    pos.y += cos(uTime * 47.0 + n * 1.3) * 0.02 * (1.0 - t);
    pos.z += sin(uTime * 53.0 + n * 0.7) * 0.02 * (1.0 - t);
  } else if (aTheme < 1.5) {
    // Fire: rises and flickers side to side
    pos.y += t * 0.55;
    pos.x += sin(uTime * 6.0 + n) * 0.05 * t;
  } else if (aTheme < 2.5) {
    // Water: gentle sideways flow with a slow fall
    pos.y -= t * 0.16;
    pos.x += sin(uTime * 2.0 + n + pos.y * 2.0) * 0.06;
  } else {
    // Leaf: slow lazy drift downward with a wide sway
    pos.y -= t * 0.3;
    pos.x += sin(uTime * 1.2 + n) * 0.12;
    pos.z += cos(uTime * 1.0 + n * 0.6) * 0.08;
  }

  vAlpha = 1.0 - t;
  vTheme = aTheme;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  float size;
  if (aTheme < 0.5) size = 10.0;
  else if (aTheme < 1.5) size = 17.0;
  else if (aTheme < 2.5) size = 13.0;
  else size = 15.0;

  gl_PointSize = size / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
