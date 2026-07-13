uniform vec3 uColorA;
uniform vec3 uColorB;

varying float vDist;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;

  // hot bright core + wider soft halo, layered for a glowy look
  float core = smoothstep(0.18, 0.0, d);
  float halo = smoothstep(0.5, 0.1, d) * 0.65;
  float alpha = clamp(core + halo, 0.0, 1.0);

  vec3 baseColor = mix(uColorA, uColorB, clamp(vDist / 2.6, 0.0, 1.0));
  vec3 color = baseColor + core * 0.7; // whiten the hot center for extra glow

  gl_FragColor = vec4(color, alpha);
}
