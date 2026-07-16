attribute vec3 aPosB;
attribute vec3 aPosC;
attribute vec3 aPosD;
attribute vec3 aPosE;

uniform float uWeights[5];
uniform float uScale;
uniform vec3 uStretchAxis;
uniform float uStretchAmount;
uniform float uTime;

varying float vDist;

void main() {
  vec3 pos = position * uWeights[0]
           + aPosB * uWeights[1]
           + aPosC * uWeights[2]
           + aPosD * uWeights[3]
           + aPosE * uWeights[4];

  // gentle ambient drift so it never looks static
  pos.x += sin(uTime * 0.5 + position.y * 2.0) * 0.03;
  pos.y += cos(uTime * 0.4 + position.x * 2.0) * 0.03;
  pos.z += sin(uTime * 0.35 + position.z * 2.0) * 0.03;

  pos *= uScale;

  // directional stretch driven by two-hand distance
  float d = dot(pos, uStretchAxis);
  pos += uStretchAxis * d * (uStretchAmount - 1.0);

  vDist = length(pos);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float sizeFactor = clamp(uScale, 0.35, 1.5);
  gl_PointSize = (27.0 * sizeFactor) / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
