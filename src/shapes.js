// Procedural particle shape generators.
// Each function returns a Float32Array of length count*3.
// The same particle "slot" (array index) is reused across every shape,
// so morphing between shapes on the GPU animates smoothly instead of
// popping — the shader blends all 5 positions by weight every frame.

export function generateShapes(count) {
  return {
    sphere: sphere(count),
    torus: torus(count),
    galaxy: galaxy(count),
    helix: helix(count),
    cube: cube(count),
  };
}

function sphere(count) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 1.4 + Math.random() * 0.4;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  return pos;
}

function torus(count) {
  const pos = new Float32Array(count * 3);
  const R = 1.5;
  const r = 0.55;
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 2;
    pos[i * 3] = (R + r * Math.cos(phi)) * Math.cos(theta);
    pos[i * 3 + 1] = (R + r * Math.cos(phi)) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.sin(phi);
  }
  return pos;
}

function galaxy(count) {
  const pos = new Float32Array(count * 3);
  const arms = 3;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const armOffset = ((i % arms) / arms) * Math.PI * 2;
    const radius = t * 2.3 + 0.05;
    const angle = radius * 3.5 + armOffset + (Math.random() - 0.5) * 0.4;
    const jitter = (Math.random() - 0.5) * 0.18 * (1 - t * 0.5);
    pos[i * 3] = Math.cos(angle) * radius + jitter;
    pos[i * 3 + 1] = Math.sin(angle) * radius + jitter;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
  }
  return pos;
}

function helix(count) {
  const pos = new Float32Array(count * 3);
  const turns = 4;
  const radius = 0.65;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const strand = i % 2;
    const angle = t * Math.PI * 2 * turns + strand * Math.PI;
    const wobble = (Math.random() - 0.5) * 0.08;
    pos[i * 3] = Math.cos(angle) * (radius + wobble);
    pos[i * 3 + 1] = (t - 0.5) * 3.4;
    pos[i * 3 + 2] = Math.sin(angle) * (radius + wobble);
  }
  return pos;
}

function cube(count) {
  const pos = new Float32Array(count * 3);
  const s = 1.5;
  for (let i = 0; i < count; i++) {
    const face = i % 6;
    const u = (Math.random() * 2 - 1) * s;
    const v = (Math.random() * 2 - 1) * s;
    let x, y, z;
    switch (face) {
      case 0: x = s; y = u; z = v; break;
      case 1: x = -s; y = u; z = v; break;
      case 2: x = u; y = s; z = v; break;
      case 3: x = u; y = -s; z = v; break;
      case 4: x = u; y = v; z = s; break;
      default: x = u; y = v; z = -s; break;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
  return pos;
}
