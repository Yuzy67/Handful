import * as THREE from 'three';

// 11 fruits: the 6 named explicitly, plus 5 more chosen because they all
// read clearly as a round-ish shape.
//
// `shape` is a non-uniform scale applied to the same sphere geometry
// (x, y, z factors) so fruits aren't all perfect spheres — a real apple is
// slightly flattened, a lemon is distinctly oblong, a grape stays round.
// This works cleanly with the existing hemisphere-slice + circular-cap
// system because scaling a sphere and its flat circular cross-section by
// the same factors keeps them matching (an ellipsoid's cross-section
// through its center is an ellipse, exactly matching a circle scaled by
// those same factors) — unlike per-vertex shape sculpting, which would
// break that match and need a custom-shaped cap to fix correctly.
//
// `seedsOnSkin` is only true for fruits whose seeds are genuinely visible
// on the WHOLE, uncut fruit (strawberry). Everything else that has seeds
// (watermelon, kiwi, pomegranate) only shows them on the sliced flesh
// cross-section, matching how the real fruit actually looks.
export const FRUIT_TYPES = [
  { name: 'Apple', skin: '#d64541', skinDark: '#a5322f', flesh: '#f6e7c1', rind: '#c9dba0', radius: 0.34, pattern: 'plain', shininess: 90, shape: [1.0, 0.94, 1.0] },
  { name: 'Watermelon', skin: '#3a9d4f', skinDark: '#1f6b30', flesh: '#f2555a', rind: '#e8f5d0', radius: 0.5, pattern: 'stripes', shininess: 55, shape: [0.85, 1.18, 0.85] },
  { name: 'Lemon', skin: '#f4d03f', skinDark: '#d4ac0d', flesh: '#fdf3c7', rind: '#fff8dc', radius: 0.3, pattern: 'dimpled', shininess: 35, shape: [0.72, 1.25, 0.72] },
  { name: 'Grape', skin: '#7d3c98', skinDark: '#5b2c6f', flesh: '#e8daef', rind: '#d8c8e8', radius: 0.18, pattern: 'plain', shininess: 100, shape: [1.0, 1.0, 1.0] },
  { name: 'Mango', skin: '#f39c12', skinDark: '#c96f0f', flesh: '#fbd97a', rind: '#fdeeb0', radius: 0.36, pattern: 'blush', blend: '#e74c3c', shininess: 65, shape: [0.88, 1.18, 0.95] },
  { name: 'Strawberry', skin: '#e6294b', skinDark: '#b71c3c', flesh: '#fbe0e6', rind: '#ffe8ee', radius: 0.26, pattern: 'seededSkin', seedColor: '#f4d03f', shininess: 45, shape: [0.86, 1.22, 0.86] },
  { name: 'Orange', skin: '#f5921b', skinDark: '#c96f0f', flesh: '#ffddaa', rind: '#fff3d6', radius: 0.34, pattern: 'dimpled', shininess: 30, shape: [1.0, 0.9, 1.0] },
  { name: 'Kiwi', skin: '#7a5230', skinDark: '#5c3d22', flesh: '#a8d24a', rind: '#e8f0c8', radius: 0.28, pattern: 'fuzzy', shininess: 8, shape: [0.85, 1.12, 0.85] },
  { name: 'Coconut', skin: '#6b4a30', skinDark: '#4a3220', flesh: '#fffdf5', rind: '#e8dcc8', radius: 0.4, pattern: 'fuzzy', shininess: 5, shape: [0.95, 1.12, 0.95] },
  { name: 'Peach', skin: '#f5b895', skinDark: '#e0926a', flesh: '#f8d99a', rind: '#ffe8cc', radius: 0.32, pattern: 'blush', blend: '#e0556b', shininess: 18, shape: [1.0, 0.94, 1.0] },
  { name: 'Pomegranate', skin: '#9b2242', skinDark: '#6e1830', flesh: '#c0143c', rind: '#f0d8c8', radius: 0.32, pattern: 'leathery', shininess: 40, shape: [1.0, 0.94, 1.0] },
];

const SKIN_SIZE_DESKTOP = 320;
const SKIN_SIZE_PHONE = 192;
const FLESH_SIZE_DESKTOP = 288;
const FLESH_SIZE_PHONE = 176;

function addDirectionalShading(ctx, size) {
  // A subtle, low-strength variation rather than a strong painted
  // highlight — real dynamic lighting (added once fruits use a lit
  // material) now does the actual shading job. This just adds a touch of
  // natural, uneven skin-tone variation underneath it.
  const highlight = ctx.createRadialGradient(
    size * 0.32, size * 0.28, size * 0.02,
    size * 0.32, size * 0.28, size * 0.62
  );
  highlight.addColorStop(0, 'rgba(255,255,255,0.12)');
  highlight.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, size, size);

  const shadow = ctx.createRadialGradient(
    size * 0.68, size * 0.74, size * 0.05,
    size * 0.68, size * 0.74, size * 0.7
  );
  shadow.addColorStop(0, 'rgba(0,0,0,0.12)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);
}

// Draws a fruit's exterior SKIN as a canvas texture, wrapped with THREE's
// standard sphere UV mapping in mind (U = longitude 0..1, V = latitude
// 0..1) so patterns like watermelon stripes are drawn as vertical bands —
// the only orientation that actually wraps around a sphere as a clean
// vertical stripe rather than a diagonal smear.
function buildSkinTexture(fruit, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, fruit.blend || fruit.skin);
  base.addColorStop(1, fruit.skin);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (fruit.pattern === 'stripes') {
    // Vertical bands in UV space = stripes that correctly wrap around the
    // sphere's longitude, matching a real watermelon's meridian stripes.
    const bandCount = 10;
    const bandWidth = size / bandCount;
    ctx.fillStyle = fruit.skinDark;
    for (let i = 0; i < bandCount; i += 2) {
      const x = i * bandWidth;
      const wobble = Math.sin(i * 1.7) * bandWidth * 0.12;
      ctx.beginPath();
      ctx.moveTo(x + wobble, 0);
      ctx.lineTo(x + bandWidth * 0.65 + wobble, 0);
      ctx.lineTo(x + bandWidth * 0.65 - wobble, size);
      ctx.lineTo(x - wobble, size);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (fruit.pattern === 'dimpled') {
    // Citrus peel: many tiny pores, evenly scattered.
    ctx.fillStyle = fruit.skinDark;
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.globalAlpha = 0.12 + Math.random() * 0.18;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.0035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (fruit.pattern === 'fuzzy') {
    ctx.fillStyle = fruit.skinDark;
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.globalAlpha = 0.15 + Math.random() * 0.25;
      const w = size * (0.004 + Math.random() * 0.004);
      ctx.fillRect(x, y, w, w * 2.2);
    }
    ctx.globalAlpha = 1;
  }

  if (fruit.pattern === 'leathery') {
    // Pomegranate's tough, slightly mottled rind.
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = size * (0.03 + Math.random() * 0.05);
      ctx.fillStyle = fruit.skinDark;
      ctx.globalAlpha = 0.1 + Math.random() * 0.12;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (fruit.pattern === 'seededSkin') {
    // Strawberry — the only fruit whose seeds genuinely sit on the outside.
    ctx.fillStyle = fruit.seedColor;
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.012, size * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // small stem/calyx mark near the top pole, a nice realistic touch shared
  // by most fruits
  if (fruit.pattern !== 'fuzzy' && fruit.pattern !== 'leathery') {
    ctx.fillStyle = fruit.skinDark;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(size * 0.5, size * 0.06, size * 0.035, size * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  addDirectionalShading(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Draws the FLESH cross-section — what you actually see the instant a
// fruit is sliced. This is where seeds/pits/segments genuinely belong for
// fruits like watermelon, kiwi, and pomegranate, matching how they really
// look once cut open.
function buildFleshTexture(fruit, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.48;

  // Skin rim first (a thin sliver of the actual outer skin color shows at
  // the very edge of any real cut fruit), then the rind layer just inside
  // it, then the main flesh — three concentric layers instead of one flat
  // fill, which is what makes a real cross-section read as layered rather
  // than a single block of color.
  ctx.fillStyle = fruit.skinDark;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = fruit.rind || fruit.flesh;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = fruit.flesh;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.fill();

  const fleshR = r * 0.86; // patterns below stay within the actual flesh area, not the rind

  switch (fruit.name) {
    case 'Watermelon': {
      ctx.fillStyle = '#1a1a1a';
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * fleshR * 0.85;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.008, size * 0.016, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'Orange':
    case 'Lemon': {
      // radial citrus wedge segments
      const wedges = 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = size * 0.012;
      for (let i = 0; i < wedges; i++) {
        const a = (i / wedges) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * fleshR, cy + Math.sin(a) * fleshR);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(cx, cy, fleshR * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'Mango':
    case 'Peach': {
      // flat pit outline in the center
      ctx.fillStyle = fruit.name === 'Mango' ? '#c98a3a' : '#8a5a3a';
      ctx.beginPath();
      ctx.ellipse(cx, cy, fleshR * 0.42, fleshR * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'Kiwi': {
      ctx.fillStyle = '#f4f9e8';
      ctx.beginPath();
      ctx.arc(cx, cy, fleshR * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      const seedRing = 16;
      for (let i = 0; i < seedRing; i++) {
        const a = (i / seedRing) * Math.PI * 2;
        const x = cx + Math.cos(a) * fleshR * 0.62;
        const y = cy + Math.sin(a) * fleshR * 0.62;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.007, size * 0.014, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'Coconut': {
      ctx.strokeStyle = '#6b4a30';
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, fleshR * 0.92, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(cx, cy, fleshR * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'Pomegranate': {
      // the flesh IS densely packed seed clusters (arils)
      const tones = ['#c0143c', '#e0355e', '#a10f34', '#d92850'];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * fleshR * 0.85;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)];
          ctx.beginPath();
          ctx.arc(x, y, size * (0.018 + Math.random() * 0.012), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'Apple': {
      ctx.fillStyle = '#8a5a3a';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * fleshR * 0.12, cy + Math.sin(a) * fleshR * 0.12, size * 0.014, size * 0.022, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      // Grape / Strawberry: kept clean and simple, matching the real fruit.
      break;
  }

  // soft radial shading so the flesh doesn't look perfectly flat
  const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(0.7, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Builds and caches a skin + flesh texture per fruit type. Call once at
// mode setup, reuse across every spawn/slice of that fruit for the whole
// session. `isTouchPhone` scales resolution down to keep texture memory
// modest on phones without any visible quality loss at typical viewing size.
export function buildFruitAssets(isTouchPhone) {
  const skinSize = isTouchPhone ? SKIN_SIZE_PHONE : SKIN_SIZE_DESKTOP;
  const fleshSize = isTouchPhone ? FLESH_SIZE_PHONE : FLESH_SIZE_DESKTOP;
  return FRUIT_TYPES.map((fruit) => ({
    ...fruit,
    texture: buildSkinTexture(fruit, skinSize),
    fleshTexture: buildFleshTexture(fruit, fleshSize),
  }));
}
