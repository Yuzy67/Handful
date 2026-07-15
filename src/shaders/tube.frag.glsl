uniform float uTime;
uniform float uTheme; // 0 = electric, 1 = fire, 2 = water, 3 = leaf
uniform float uAlpha;
uniform float uGlowBoost;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);

  vec3 baseColor;
  vec3 glowColor;
  float flicker;
  float flowSpeed;

  if (uTheme < 0.5) {
    // Electric — cool blue arcing into a white-hot core, fast crackle
    baseColor = vec3(0.35, 0.65, 1.0);
    glowColor = vec3(1.0, 1.0, 1.0);
    flicker = 0.75 + 0.25 * sin(uTime * 30.0 + vUv.x * 40.0);
    flowSpeed = 6.0;
  } else if (uTheme < 1.5) {
    // Fire — red-orange into a yellow-hot core, slow flicker
    baseColor = vec3(1.0, 0.32, 0.05);
    glowColor = vec3(1.0, 0.85, 0.3);
    flicker = 0.8 + 0.2 * sin(uTime * 8.0 + vUv.x * 20.0);
    flowSpeed = 2.0;
  } else if (uTheme < 2.5) {
    // Water — deep blue into a pale cyan core, gentle flow
    baseColor = vec3(0.08, 0.42, 0.88);
    glowColor = vec3(0.6, 0.95, 1.0);
    flicker = 0.92 + 0.08 * sin(uTime * 2.0 + vUv.x * 10.0);
    flowSpeed = 1.2;
  } else {
    // Leaf — deep green into a soft light-green core, slow pulse
    baseColor = vec3(0.14, 0.5, 0.2);
    glowColor = vec3(0.6, 0.88, 0.4);
    flicker = 0.94 + 0.06 * sin(uTime * 1.0 + vUv.x * 6.0);
    flowSpeed = 0.6;
  }

  // a soft band that scrolls along the tube's length, like flowing energy —
  // kept subtle so it reads as a smooth glow rather than visible stripes
  float flow = 0.5 + 0.5 * sin(vUv.x * 5.0 - uTime * flowSpeed);
  float mixAmount = clamp(flow * 0.22 + fresnel * 0.7 + uGlowBoost, 0.0, 1.0);
  vec3 color = mix(baseColor, glowColor, mixAmount) * flicker;

  float alpha = uAlpha * clamp(0.55 + fresnel * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
