varying float vAlpha;
varying float vTheme;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;

  float core = smoothstep(0.18, 0.0, d);
  float halo = smoothstep(0.5, 0.1, d) * 0.6;
  float shape = clamp(core + halo, 0.0, 1.0);

  vec3 color;
  if (vTheme < 0.5) {
    // electric: blue arcing into a white-hot core
    color = mix(vec3(0.35, 0.65, 1.0), vec3(1.0, 1.0, 1.0), core);
  } else if (vTheme < 1.5) {
    // fire: deep red-orange into a yellow core
    color = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.82, 0.28), core);
  } else if (vTheme < 2.5) {
    // water: deep blue into a pale cyan core
    color = mix(vec3(0.08, 0.42, 0.88), vec3(0.55, 0.92, 1.0), core);
  } else {
    // leaf: deep green into a soft light-green core
    color = mix(vec3(0.14, 0.5, 0.2), vec3(0.55, 0.85, 0.4), core);
  }

  gl_FragColor = vec4(color, shape * vAlpha);
}
