uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uBrightnessBoost;

varying float vDist;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;

  // hot bright core + soft halo, layered for a glowy but detailed look
  float core = smoothstep(0.2, 0.0, d);
  float halo = smoothstep(0.5, 0.15, d) * 0.6;
  float alpha = clamp(core + halo, 0.0, 1.0);

  vec3 baseColor = mix(uColorA, uColorB, clamp(vDist / 2.6, 0.0, 1.0));
  vec3 color = (baseColor + core * 0.85) * 1.15 * uBrightnessBoost;

  gl_FragColor = vec4(color, alpha);
}
