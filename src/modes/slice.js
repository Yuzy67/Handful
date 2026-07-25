import * as THREE from 'three';
import { landmarkToWorld } from '../arUtils.js';
import { buildFruitAssets } from '../fruits.js';
import tubeVert from '../shaders/tube.vert.glsl?raw';
import tubeFrag from '../shaders/tube.frag.glsl?raw';

const GRAVITY = -2.4; // world units / s^2
const SLICE_DEPTH = 3.2; // fixed depth for both fruits and the finger-projection plane
const MIN_SWIPE_SPEED = 1.0; // world units/sec — filters out a near-stationary finger. Lower
// than before because the fingertip signal is smoothed (see TIP_SMOOTHING below), so the
// natural micro-jitter that previously required a higher buffer is largely already filtered out.
const MAX_PLAUSIBLE_SPEED = 45; // world units/sec — beyond this, treat it as a hand-tracking
// glitch (e.g. MediaPipe swapping which array index refers to which physical hand when two
// hands are present) rather than a real swipe, and re-anchor without hit-testing. Speed-based
// rather than distance-based specifically because dt between detections can legitimately vary
// (video frame rate isn't perfectly constant), so a fixed distance threshold would sometimes
// reject genuine fast swipes and sometimes miss real glitches depending on the gap length.
const HIT_PADDING = 0.09; // forgiveness added to a fruit's hit radius — games are almost always
// more forgiving than strictly "accurate" here, since a technically-correct-but-strict hitbox
// reads to players as unresponsive rather than precise.
const HIT_TEST_SEGMENTS = 3; // test the last few trail segments each update, not just the single
// newest one — a fast continuous swipe's true path shouldn't be able to slip past a fruit purely
// because of which exact frame boundary got tested; sliced fruits are removed immediately, so
// re-testing recent history carries no risk of double-slicing the same fruit.
const BLADE_TRAIL_MAX_AGE = 0.22; // seconds a point stays in the blade trail before fading out
const BLADE_MAX_POINTS = 10; // fixed cap — lets the trail geometry be pre-allocated once
const BLADE_RADIUS = 0.045;
const HALF_LIFETIME = 1.3; // seconds a sliced half stays on screen before cleanup
const HALF_POP_DURATION = 0.15; // seconds a freshly-sliced half spends easing down from an
// oversized "pop" to its normal size — a classic bit of game-feel polish
const JUICE_LIFETIME = 0.55;
const SHOCKWAVE_LIFETIME = 0.32;
const FLASH_LIFETIME = 0.18;
const MAX_DETECTION_GAP = 1.0; // seconds — a gap larger than this (tab backgrounded, big stall)
// is treated as a fresh start rather than used for a speed calculation
const HORIZONTAL_DRAG = 0.12; // subtle exponential decay on a fruit's sideways drift — real
// projectiles experience some air resistance; a perfectly constant horizontal velocity reads as
// slightly artificial
const BOMB_RADIUS = 0.3;
const BOMB_SPAWN_CHANCE = 0.16; // fraction of spawns that are a bomb instead of a fruit
const BOMB_PENALTY = 3; // score deducted per bomb hit — enough to genuinely hurt without a
// single mistake ending a run outright (this game has no lives/game-over)
const SMOKE_LIFETIME = 0.6;
const PENALTY_FLASH_DURATION = 1.1; // seconds the "-3" penalty message stays visible before
// reverting to the normal score display — guarantees a bomb hit is always clearly felt, even
// on the rare occasion the displayed score doesn't visibly change (e.g. it was already at the 0 floor)

// Tuned lighter (more responsive, less lag) than draw mode's fingertip
// smoothing — drawing rewards a clean, deliberate line, but slicing is a
// fast-paced action where too much smoothing would make the game feel
// unresponsive. This still meaningfully reduces raw per-frame jitter,
// which both looks better in the blade trail and makes the swipe-speed
// calculation more consistent (jitter was previously a source of both
// spurious speed spikes and dips right at a fruit's hit boundary).
const TIP_SMOOTHING = 0.55;

// Progressive difficulty: the longer a single run continues, the faster
// fruits are launched and the more often they spawn — capped so it never
// becomes literally unplayable. Resets whenever the player hits the reset
// button, matching stats resetting alongside it (a "fresh run" resets both).
const DIFFICULTY_RAMP_SECONDS = 32; // time to reach full difficulty — reaches max noticeably
// sooner than before, without raising the ceiling itself dramatically
const MAX_GRAVITY_BOOST = 0.7; // up to 70% stronger gravity+launch speed at max difficulty
const MAX_SPAWN_SPEEDUP = 0.5; // up to 50% shorter spawn intervals at max difficulty

/**
 * Fruit-slicing mode: fruits arc up and fall under gravity; dragging a
 * fingertip through one at speed slices it into two physically separating
 * halves with a flesh-colored, fruit-appropriate cross-section, plus a
 * one-shot particle burst. Tracks up to two hands independently.
 *
 * Swipe detection and the blade trail are both driven directly by
 * `updateGesture`, which only fires once per genuinely new camera frame —
 * not by the render loop, which can run at a higher, uncorrelated frame
 * rate. This keeps the speed calculation accurate (using the real elapsed
 * time between detections, not a render tick) and avoids rebuilding
 * trail geometry far more often than the tracking data actually changes.
 *
 * All fruit geometry/materials are pre-built once per fruit type and
 * reused across every spawn/slice for the whole session. The blade trail
 * uses a single pre-allocated, in-place-updated ribbon geometry per hand —
 * not a fresh THREE.TubeGeometry every update — since tube reconstruction
 * involves real per-call cost (frame computation along the curve) that
 * adds up fast at high update rates.
 */
export function createSliceMode(scene, camera, statusEl, isTouchPhone) {
  const sphereSegments = isTouchPhone ? 10 : 20;
  const capSegments = isTouchPhone ? 12 : 24;
  const maxConcurrentFruits = isTouchPhone ? 4 : 7;
  const spawnIntervalRange = isTouchPhone ? [1.15, 1.85] : [0.8, 1.4];
  const juiceParticleCount = isTouchPhone ? 12 : 30;

  const group = new THREE.Group();
  scene.add(group);
  group.visible = false;
  let isActive = false;

  // ---- pre-built, shared-forever assets per fruit type ----
  const fruitAssets = buildFruitAssets(isTouchPhone).map((fruit) => {
    const sphereGeo = new THREE.SphereGeometry(fruit.radius, sphereSegments, sphereSegments);
    // MeshBasicMaterial (unlit) deliberately, not a lit material — real-time
    // per-fragment lighting is one of the most expensive things a mobile
    // GPU can be asked to do, and stacking multiple dynamic lights during
    // active slicing compounds that cost fast. The texture itself carries a
    // baked-in highlight/shading (see fruits.js) to still read as
    // dimensional, at zero per-frame lighting cost.
    const skinMat = new THREE.MeshBasicMaterial({ map: fruit.texture });

    // Two hemispheres split along the local X axis (their flat cut face
    // lies in the local Y-Z plane, which contains the camera's view axis —
    // so the cut reads as a visible edge on screen instead of vanishing
    // face-on, which is what a Z-axis split would do).
    const hemiA = new THREE.SphereGeometry(fruit.radius, sphereSegments, sphereSegments, -Math.PI / 2, Math.PI);
    const hemiB = new THREE.SphereGeometry(fruit.radius, sphereSegments, sphereSegments, Math.PI / 2, Math.PI);

    const capGeo = new THREE.CircleGeometry(fruit.radius, capSegments);
    capGeo.rotateY(Math.PI / 2); // reorient from the default XY plane to the YZ plane, matching the cut face
    // DoubleSide guards against the cap's normal facing either way — it
    // renders correctly regardless, so a sign slip here can't cause an
    // invisible or inside-out face.
    const fleshMat = new THREE.MeshBasicMaterial({ map: fruit.fleshTexture, side: THREE.DoubleSide });

    // Fruits are no longer perfect spheres (see the `shape` scale factors
    // in fruits.js), so the hit-test radius uses the LARGEST of the three
    // scale dimensions — staying at least as forgiving as the fruit's
    // biggest visual extent rather than the smallest, matching the
    // existing "hit detection should err generous, not strict" approach.
    const hitRadius = fruit.radius * Math.max(...fruit.shape);

    return { ...fruit, sphereGeo, skinMat, hemiA, hemiB, capGeo, fleshMat, hitRadius };
  });

  // ---- bomb (shared geometry/material, built once) ----
  const bombBodyGeo = new THREE.SphereGeometry(BOMB_RADIUS, sphereSegments, sphereSegments);
  const bombFuseGeo = new THREE.CylinderGeometry(BOMB_RADIUS * 0.09, BOMB_RADIUS * 0.11, BOMB_RADIUS * 0.55, 8);
  // Plain MeshBasicMaterial (unlit), same phone-performance reasoning as
  // the fruits — its color is animated directly each frame for a pulsing
  // "danger" glow, which is far cheaper than a real light since it only
  // touches this one material, not a full scene relighting pass.
  const bombBodyMat = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });
  const bombFuseMat = new THREE.MeshBasicMaterial({ color: 0x8b5a2b });
  const bombDarkColor = new THREE.Color(0x1c1c1c);
  const bombGlowColor = new THREE.Color(0xcc2200);

  // Shaped to match exactly what a fruit's `asset` needs to provide for
  // the existing spawn/physics/effects code to work on a bomb unmodified —
  // this is what lets bombs share the same `fruits` array and physics
  // loop as real fruit, branching only at hit-test time.
  const bombAsset = { radius: BOMB_RADIUS, hitRadius: BOMB_RADIUS, isBomb: true };

  // ---- live state ----
  const fruits = []; // { mesh, asset, x,y,z, vx,vy,vz, gravity, spinAxis, spinSpeed }
  const halves = []; // { group, vx,vy,vz, spinZ, life }
  const bursts = []; // { points, material, life }
  const shockwaves = []; // { mesh, material, life }
  const flashes = []; // { mesh, material, life }
  const shockwaveGeo = new THREE.RingGeometry(0.5, 1, 28); // unit ring, scaled per-instance
  const flashGeo = new THREE.PlaneGeometry(1, 1); // unit plane, scaled per-instance, faces +Z like everything else at this fixed depth

  const handTrail = [[], []]; // rolling blade-trail points per hand slot: { pos: Vector3, age }
  const handPrevWorld = [null, null];
  const handSmoothed = [null, null]; // eased {x, y} landmark position per hand, reduces jitter
  const bladeStates = [createBladeState(), createBladeState()];
  let lastDetectionTime = null;

  let clock = 0;
  let spawnTimer = 0;
  let nextSpawnIn = randomRange(spawnIntervalRange);
  let stats = { sliced: 0, spawned: 0, bombHits: 0 };
  let penaltyFlashTimer = 0;
  let difficultyTime = 0;

  function randomRange([min, max]) {
    return min + Math.random() * (max - min);
  }

  function getDifficultyLevel() {
    return Math.min(difficultyTime / DIFFICULTY_RAMP_SECONDS, 1);
  }

  function getFrustumHalfExtents(distance) {
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const halfWidth = halfHeight * camera.aspect;
    return { halfWidth, halfHeight };
  }

  function updateStatusText() {
    const rate = stats.spawned > 0 ? Math.round((stats.sliced / stats.spawned) * 100) : 0;
    const score = Math.max(0, stats.sliced - stats.bombHits * BOMB_PENALTY);
    const bombNote = stats.bombHits > 0 ? ` · 💣×${stats.bombHits}` : '';
    statusEl.textContent = `🍉 Score ${score} · ${rate}% strike rate${bombNote}`;
  }

  // ---- pre-allocated blade-trail ribbon (built once per hand slot, never
  // rebuilt as a new geometry — only its vertex buffer is overwritten) ----
  function createBladeState() {
    const maxVerts = BLADE_MAX_POINTS * 2;
    const positions = new Float32Array(maxVerts * 3);
    const uvs = new Float32Array(maxVerts * 2);
    const normals = new Float32Array(maxVerts * 3);
    for (let i = 0; i < maxVerts; i++) normals[i * 3 + 2] = 1; // all facing the camera (+Z)

    const indices = [];
    for (let i = 0; i < BLADE_MAX_POINTS - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTheme: { value: 0 }, // electric blue-white — reused as-is, unmodified shader
        uAlpha: { value: 0.95 },
        uGlowBoost: { value: 0.85 },
      },
      vertexShader: tubeVert,
      fragmentShader: tubeFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    // This geometry's vertex buffer is updated in place every detection
    // frame without recomputing a bounding volume, so frustum culling
    // (which relies on that bounding volume) could otherwise incorrectly
    // hide it — disabling it is the standard fix for manually-animated
    // geometry like this, and it's cheap enough that the cost is negligible.
    mesh.frustumCulled = false;
    group.add(mesh);

    return { geometry, positions, uvs, mesh, material };
  }

  function rebuildBladeGeometry(handIndex) {
    const trail = handTrail[handIndex];
    const state = bladeStates[handIndex];
    const n = trail.length;

    if (n < 2) {
      state.mesh.visible = false;
      return;
    }

    const positions = state.positions;
    const uvs = state.uvs;

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1); // 0 = oldest (tail, about to fade), 1 = newest (fingertip)
      const p = trail[i].pos;

      let dx, dy;
      if (i === 0) {
        dx = trail[1].pos.x - p.x;
        dy = trail[1].pos.y - p.y;
      } else if (i === n - 1) {
        dx = p.x - trail[i - 1].pos.x;
        dy = p.y - trail[i - 1].pos.y;
      } else {
        dx = trail[i + 1].pos.x - trail[i - 1].pos.x;
        dy = trail[i + 1].pos.y - trail[i - 1].pos.y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const width = BLADE_RADIUS * (0.25 + 0.75 * t); // tapers thin at the tail, full width at the tip

      const vi = i * 2;
      positions[vi * 3] = p.x + nx * width;
      positions[vi * 3 + 1] = p.y + ny * width;
      positions[vi * 3 + 2] = p.z;
      positions[(vi + 1) * 3] = p.x - nx * width;
      positions[(vi + 1) * 3 + 1] = p.y - ny * width;
      positions[(vi + 1) * 3 + 2] = p.z;

      uvs[vi * 2] = t;
      uvs[vi * 2 + 1] = 0;
      uvs[(vi + 1) * 2] = t;
      uvs[(vi + 1) * 2 + 1] = 1;
    }

    state.geometry.attributes.position.needsUpdate = true;
    state.geometry.attributes.uv.needsUpdate = true;
    state.geometry.setDrawRange(0, (n - 1) * 6);
    state.mesh.visible = true;
  }

  function computeSpawnKinematics() {
    const { halfWidth, halfHeight } = getFrustumHalfExtents(SLICE_DEPTH);

    const x = (Math.random() * 2 - 1) * halfWidth * 0.75;
    const y = -halfHeight * 0.95;
    const z = camera.position.z - SLICE_DEPTH;

    // Difficulty is locked in at spawn time, not read live during flight —
    // so a fruit already in the air never jarringly speeds up mid-arc.
    // Only fruits spawned AFTER difficulty has ramped up reflect it.
    const difficultyLevel = getDifficultyLevel();
    const gravity = GRAVITY * (1 + difficultyLevel * MAX_GRAVITY_BOOST);

    // vy chosen so the arc's peak lands comfortably inside the visible
    // frustum, recomputed from the CURRENT window size every spawn — this
    // is what keeps fruits fully on-screen on any aspect ratio, including
    // narrow portrait phones, instead of a fixed velocity that only looked
    // right at one screen shape. Using this fruit's own (possibly
    // difficulty-boosted) gravity keeps the same peak height at any
    // difficulty level — higher difficulty makes the whole arc quicker and
    // more urgent, not taller or off-screen.
    const desiredRise = halfHeight * (1.1 + Math.random() * 0.5);
    const vy = Math.sqrt(2 * Math.abs(gravity) * desiredRise);
    const vx = (Math.random() * 2 - 1) * (0.35 + difficultyLevel * 0.25);

    // A single random rotation axis with one steady angular speed reads as
    // a smooth, natural tumble — three independent per-axis speeds tend to
    // look more like chaotic wobbling than a graceful spin.
    const axisTheta = Math.random() * Math.PI * 2;
    const axisPhi = Math.acos(Math.random() * 2 - 1);
    const spinAxis = new THREE.Vector3(
      Math.sin(axisPhi) * Math.cos(axisTheta),
      Math.sin(axisPhi) * Math.sin(axisTheta),
      Math.cos(axisPhi)
    );
    const spinSpeed = (Math.random() * 1.5 + 1.5) * (Math.random() < 0.5 ? -1 : 1);

    return { x, y, z, vx, vy, vz: 0, gravity, spinAxis, spinSpeed, halfWidth, halfHeight };
  }

  function spawnFruit() {
    if (fruits.length >= maxConcurrentFruits) return;

    const asset = fruitAssets[Math.floor(Math.random() * fruitAssets.length)];
    const kin = computeSpawnKinematics();

    const mesh = new THREE.Mesh(asset.sphereGeo, asset.skinMat);
    mesh.position.set(kin.x, kin.y, kin.z);
    mesh.scale.set(asset.shape[0], asset.shape[1], asset.shape[2]);
    group.add(mesh);

    fruits.push({ mesh, asset, ...kin });

    stats.spawned++;
    updateStatusText();
  }

  function spawnBomb() {
    if (fruits.length >= maxConcurrentFruits) return;

    const kin = computeSpawnKinematics();

    const bombGroup = new THREE.Group();
    const body = new THREE.Mesh(bombBodyGeo, bombBodyMat);
    const fuse = new THREE.Mesh(bombFuseGeo, bombFuseMat);
    fuse.position.set(0, BOMB_RADIUS * 1.0, 0);
    fuse.rotation.z = 0.3;
    bombGroup.add(body, fuse);
    bombGroup.position.set(kin.x, kin.y, kin.z);
    group.add(bombGroup);

    // Deliberately left as a plain sphere, not given a shape scale like
    // fruits — a bomb should be instantly recognizable as "the round black
    // one to avoid," distinct from the varied fruit shapes.
    fruits.push({ mesh: bombGroup, asset: bombAsset, ...kin });
  }

  function sliceFruit(fruit, swipeAngle, swipeSpeed) {
    group.remove(fruit.mesh);
    const idx = fruits.indexOf(fruit);
    if (idx !== -1) fruits.splice(idx, 1);

    const asset = fruit.asset;
    const kick = Math.min(swipeSpeed * 0.13, 2.2);
    const perp = { x: -Math.sin(swipeAngle), y: Math.cos(swipeAngle) };

    [
      { hemi: asset.hemiA, dir: -1 },
      { hemi: asset.hemiB, dir: 1 },
    ].forEach(({ hemi, dir }) => {
      const halfGroup = new THREE.Group();
      halfGroup.add(new THREE.Mesh(hemi, asset.skinMat));
      halfGroup.add(new THREE.Mesh(asset.capGeo, asset.fleshMat));
      halfGroup.position.set(fruit.x, fruit.y, fruit.z);
      halfGroup.rotation.z = swipeAngle;
      // Starts oversized (a quick "pop" for extra impact), eases down to
      // the fruit's normal (non-uniform) shape in tick().
      halfGroup.scale.set(asset.shape[0] * 1.22, asset.shape[1] * 1.22, asset.shape[2] * 1.22);
      group.add(halfGroup);

      halves.push({
        group: halfGroup,
        shape: asset.shape,
        vx: fruit.vx + perp.x * kick * dir,
        vy: fruit.vy * 0.4 + perp.y * kick * dir,
        vz: (Math.random() - 0.5) * 0.9,
        spinZ: (Math.random() - 0.5) * 8,
        life: 0,
      });
    });

    spawnJuiceBurst(fruit, asset);
    spawnShockwave(fruit, asset);
    spawnFlash(fruit, asset);
    stats.sliced++;
    updateStatusText();
  }

  function spawnJuiceBurst(fruit, asset) {
    const positions = new Float32Array(juiceParticleCount * 3);
    const velocities = [];
    for (let i = 0; i < juiceParticleCount; i++) {
      positions[i * 3] = fruit.x;
      positions[i * 3 + 1] = fruit.y;
      positions[i * 3 + 2] = fruit.z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.9 + Math.random() * 2.2;
      velocities.push({
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed + 0.9,
        z: (Math.random() - 0.5) * speed,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: asset.flesh,
      size: isTouchPhone ? 0.055 : 0.07,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    group.add(points);
    bursts.push({ points, material, geometry, velocities, life: 0, lifetime: JUICE_LIFETIME, startOpacity: 1 });
  }

  function spawnShockwave(fruit, asset) {
    const material = new THREE.MeshBasicMaterial({
      color: asset.flesh,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(shockwaveGeo, material);
    mesh.position.set(fruit.x, fruit.y, fruit.z);
    mesh.scale.setScalar(fruit.asset.radius * 0.5);
    group.add(mesh);
    shockwaves.push({ mesh, material, baseScale: fruit.asset.radius * 0.5, life: 0 });
  }

  function spawnFlash(fruit, asset) {
    const material = new THREE.MeshBasicMaterial({
      color: asset.flesh,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(flashGeo, material);
    mesh.position.set(fruit.x, fruit.y, fruit.z);
    mesh.scale.setScalar(fruit.asset.radius * 1.8);
    group.add(mesh);
    flashes.push({ mesh, material, life: 0 });
  }

  function spawnSmokeBurst(bomb) {
    const count = isTouchPhone ? 14 : 28;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = bomb.x;
      positions[i * 3 + 1] = bomb.y;
      positions[i * 3 + 2] = bomb.z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.6; // bigger, more chaotic than a juice burst
      velocities.push({
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed + 1.2,
        z: (Math.random() - 0.5) * speed,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x555555,
      size: isTouchPhone ? 0.09 : 0.12, // bigger "smoke puff" look than the fine juice spray
      transparent: true,
      opacity: 1,
      depthWrite: false,
      // Deliberately NOT additive — additive dark grey just looks like a
      // dim version of nothing; normal blending is what actually reads as
      // dark smoke rather than a faint light.
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    group.add(points);
    bursts.push({ points, material, geometry, velocities, life: 0, lifetime: SMOKE_LIFETIME, startOpacity: 0.85 });
  }

  function sliceBomb(bomb, swipeAngle, swipeSpeed) {
    group.remove(bomb.mesh);
    const idx = fruits.indexOf(bomb);
    if (idx !== -1) fruits.splice(idx, 1);

    spawnSmokeBurst(bomb);
    spawnShockwave(bomb, { flesh: 0x444444 });
    spawnFlash(bomb, { flesh: 0xff3300 });

    stats.bombHits++;
    penaltyFlashTimer = PENALTY_FLASH_DURATION;
    statusEl.textContent = `💥 Bomb! −${BOMB_PENALTY} points`;
  }

  function closestPointOnSegmentDistance(p0, p1, center) {
    const d = new THREE.Vector3().subVectors(p1, p0);
    const lenSq = d.lengthSq();
    if (lenSq < 1e-6) return p0.distanceTo(center);
    let t = new THREE.Vector3().subVectors(center, p0).dot(d) / lenSq;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const closest = new THREE.Vector3().copy(p0).addScaledVector(d, t);
    return closest.distanceTo(center);
  }

  function processHand(handIndex, lm, dt) {
    if (!lm) {
      handPrevWorld[handIndex] = null;
      handTrail[handIndex] = [];
      handSmoothed[handIndex] = null;
      bladeStates[handIndex].mesh.visible = false;
      return;
    }

    const rawTip = lm[8]; // index fingertip
    let smoothed = handSmoothed[handIndex];
    if (!smoothed) {
      smoothed = { x: rawTip.x, y: rawTip.y };
    } else {
      smoothed = {
        x: smoothed.x + (rawTip.x - smoothed.x) * TIP_SMOOTHING,
        y: smoothed.y + (rawTip.y - smoothed.y) * TIP_SMOOTHING,
      };
    }
    handSmoothed[handIndex] = smoothed;

    const worldPos = landmarkToWorld(smoothed, camera, SLICE_DEPTH);

    // Age existing trail points by the real elapsed time since the last
    // detection (not a render tick), then append the new point.
    const trail = handTrail[handIndex];
    if (dt !== null) {
      for (const p of trail) p.age += dt;
    }
    while (trail.length && trail[0].age > BLADE_TRAIL_MAX_AGE) trail.shift();
    trail.push({ pos: worldPos.clone(), age: 0 });
    if (trail.length > BLADE_MAX_POINTS) trail.shift();
    rebuildBladeGeometry(handIndex);

    const prev = handPrevWorld[handIndex];
    handPrevWorld[handIndex] = worldPos;

    if (!prev || dt === null || dt <= 0 || dt > MAX_DETECTION_GAP) return;

    const dist = prev.distanceTo(worldPos);
    const speed = dist / dt;
    if (speed > MAX_PLAUSIBLE_SPEED) return; // tracking glitch, already re-anchored above
    if (speed < MIN_SWIPE_SPEED) return;

    const dx = worldPos.x - prev.x;
    const dy = worldPos.y - prev.y;
    const swipeAngle = Math.atan2(dy, dx);

    // Test the last few trail segments (not just the single newest one)
    // against every active fruit — a fast, continuous swipe's true path
    // shouldn't be able to slip past a fruit purely because of which exact
    // frame boundary got tested. Sliced fruits are removed immediately, so
    // re-testing recent history carries no risk of double-slicing the
    // same fruit twice.
    const segCount = Math.min(trail.length - 1, HIT_TEST_SEGMENTS);
    const segments = [];
    for (let i = trail.length - 1 - segCount; i < trail.length - 1; i++) {
      if (i >= 0) segments.push([trail[i].pos, trail[i + 1].pos]);
    }

    for (const fruit of [...fruits]) {
      const center = new THREE.Vector3(fruit.x, fruit.y, fruit.z);
      let hit = false;
      for (const [a, b] of segments) {
        if (closestPointOnSegmentDistance(a, b, center) <= fruit.asset.hitRadius + HIT_PADDING) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (fruit.asset.isBomb) {
          sliceBomb(fruit, swipeAngle, speed);
        } else {
          sliceFruit(fruit, swipeAngle, speed);
        }
      }
    }
  }

  function updateGesture(results) {
    if (!isActive) return;
    const hands = results.landmarks || [];

    const now = performance.now();
    const dt = lastDetectionTime !== null ? (now - lastDetectionTime) / 1000 : null;
    lastDetectionTime = now;

    processHand(0, hands[0] || null, dt);
    processHand(1, hands[1] || null, dt);
  }

  function tick(dt) {
    if (!isActive) return;
    clock += dt;
    difficultyTime += dt;

    if (penaltyFlashTimer > 0) {
      penaltyFlashTimer -= dt;
      if (penaltyFlashTimer <= 0) {
        penaltyFlashTimer = 0;
        updateStatusText();
      }
    }

    // spawn — interval shortens as difficulty ramps up, re-evaluated fresh
    // each time a new spawn is scheduled
    spawnTimer += dt;
    if (spawnTimer >= nextSpawnIn) {
      spawnTimer = 0;
      const difficultyLevel = getDifficultyLevel();
      const [baseMin, baseMax] = spawnIntervalRange;
      const shrink = 1 - difficultyLevel * MAX_SPAWN_SPEEDUP;
      nextSpawnIn = randomRange([baseMin * shrink, baseMax * shrink]);
      if (Math.random() < BOMB_SPAWN_CHANCE) {
        spawnBomb();
      } else {
        spawnFruit();
      }
    }

    // fruit physics + off-screen safety cleanup
    for (const fruit of [...fruits]) {
      fruit.vy += fruit.gravity * dt;
      fruit.vx *= 1 - HORIZONTAL_DRAG * dt; // subtle air resistance on sideways drift
      fruit.x += fruit.vx * dt;
      fruit.y += fruit.vy * dt;
      fruit.mesh.position.set(fruit.x, fruit.y, fruit.z);
      fruit.mesh.rotateOnAxis(fruit.spinAxis, fruit.spinSpeed * dt);

      const missed =
        fruit.y < -fruit.halfHeight * 1.3 ||
        Math.abs(fruit.x) > fruit.halfWidth * 1.15;
      if (missed) {
        group.remove(fruit.mesh);
        const idx = fruits.indexOf(fruit);
        if (idx !== -1) fruits.splice(idx, 1);
      }
    }

    // half-fruit debris physics + lifespan cleanup (geometry/material are
    // shared per fruit type, so removal here never needs to dispose them)
    for (const half of [...halves]) {
      half.life += dt;
      half.vy += GRAVITY * dt;
      half.group.position.x += half.vx * dt;
      half.group.position.y += half.vy * dt;
      half.group.position.z += half.vz * dt;
      half.group.rotation.z += half.spinZ * dt;

      if (half.life < HALF_POP_DURATION) {
        const t = half.life / HALF_POP_DURATION;
        const popFactor = 1.22 - 0.22 * t;
        half.group.scale.set(
          half.shape[0] * popFactor,
          half.shape[1] * popFactor,
          half.shape[2] * popFactor
        );
      } else if (half.group.scale.x !== half.shape[0]) {
        half.group.scale.set(half.shape[0], half.shape[1], half.shape[2]);
      }

      if (half.life > HALF_LIFETIME) {
        group.remove(half.group);
        const idx = halves.indexOf(half);
        if (idx !== -1) halves.splice(idx, 1);
      }
    }

    // juice bursts — these DO own unique geometry/material per burst, so
    // they're explicitly disposed on cleanup to avoid leaking GPU memory
    // over a long play session.
    for (const burst of [...bursts]) {
      burst.life += dt;
      const t = burst.life / burst.lifetime;
      const positions = burst.geometry.attributes.position.array;
      for (let i = 0; i < burst.velocities.length; i++) {
        const v = burst.velocities[i];
        v.y += GRAVITY * dt * 0.5;
        positions[i * 3] += v.x * dt;
        positions[i * 3 + 1] += v.y * dt;
        positions[i * 3 + 2] += v.z * dt;
      }
      burst.geometry.attributes.position.needsUpdate = true;
      burst.material.opacity = Math.max(0, burst.startOpacity * (1 - t));
      if (burst.life > burst.lifetime) {
        group.remove(burst.points);
        burst.geometry.dispose();
        burst.material.dispose();
        const idx = bursts.indexOf(burst);
        if (idx !== -1) bursts.splice(idx, 1);
      }
    }

    // keep the blade shaders' glow animation smooth at full render rate
    // even though the geometry itself only updates at detection rate
    for (const state of bladeStates) {
      state.material.uniforms.uTime.value = clock;
    }

    // Bomb pulsing "danger" glow — animates the one shared material, so
    // this costs the same whether zero or several bombs are on screen at
    // once, unlike a per-instance effect.
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    bombBodyMat.color.lerpColors(bombDarkColor, bombGlowColor, pulse * 0.5);

    // shockwave rings — shared geometry (never disposed), but each
    // instance's material is unique (independent opacity fade) and is
    // disposed on cleanup
    for (const sw of [...shockwaves]) {
      sw.life += dt;
      const t = sw.life / SHOCKWAVE_LIFETIME;
      const scale = sw.baseScale * (1 + t * 5);
      sw.mesh.scale.setScalar(scale);
      sw.material.opacity = Math.max(0, 0.8 * (1 - t));
      if (sw.life > SHOCKWAVE_LIFETIME) {
        group.remove(sw.mesh);
        sw.material.dispose();
        const idx = shockwaves.indexOf(sw);
        if (idx !== -1) shockwaves.splice(idx, 1);
      }
    }

    // slice-impact flashes — a quick fading, expanding bright quad. Shared
    // geometry (never disposed), but each instance's material is unique
    // (independent opacity fade) and is disposed on cleanup.
    for (const f of [...flashes]) {
      f.life += dt;
      const t = f.life / FLASH_LIFETIME;
      f.material.opacity = Math.max(0, 0.9 * (1 - t));
      f.mesh.scale.setScalar(f.mesh.scale.x + dt * 1.5);
      if (f.life > FLASH_LIFETIME) {
        group.remove(f.mesh);
        f.material.dispose();
        const idx = flashes.indexOf(f);
        if (idx !== -1) flashes.splice(idx, 1);
      }
    }
  }

  function reset() {
    for (const fruit of fruits) group.remove(fruit.mesh);
    fruits.length = 0;
    for (const half of halves) group.remove(half.group);
    halves.length = 0;
    for (const burst of bursts) {
      group.remove(burst.points);
      burst.geometry.dispose();
      burst.material.dispose();
    }
    bursts.length = 0;
    for (const sw of shockwaves) {
      group.remove(sw.mesh);
      sw.material.dispose();
    }
    shockwaves.length = 0;
    for (const f of flashes) {
      group.remove(f.mesh);
      f.material.dispose();
    }
    flashes.length = 0;
    stats = { sliced: 0, spawned: 0, bombHits: 0 };
    penaltyFlashTimer = 0;
    difficultyTime = 0;
    spawnTimer = 0;
    nextSpawnIn = randomRange(spawnIntervalRange);
    handPrevWorld[0] = null;
    handPrevWorld[1] = null;
    handSmoothed[0] = null;
    handSmoothed[1] = null;
    handTrail[0] = [];
    handTrail[1] = [];
    bladeStates[0].mesh.visible = false;
    bladeStates[1].mesh.visible = false;
    updateStatusText();
  }

  function setActive(active) {
    isActive = active;
    group.visible = active;
    if (active) {
      lastDetectionTime = null; // avoid a bogus huge dt from time spent in another mode
      updateStatusText();
    } else {
      handPrevWorld[0] = null;
      handPrevWorld[1] = null;
      handSmoothed[0] = null;
      handSmoothed[1] = null;

      // Fruits/halves deliberately stay paused (not cleared) so a
      // slice-in-progress resumes correctly if the player switches back —
      // that's meaningful game state. But momentary visual flourishes like
      // a mid-fade juice splash have no such meaning once interrupted, so
      // they're disposed outright rather than left frozen indefinitely.
      for (const burst of bursts) {
        group.remove(burst.points);
        burst.geometry.dispose();
        burst.material.dispose();
      }
      bursts.length = 0;
      for (const sw of shockwaves) {
        group.remove(sw.mesh);
        sw.material.dispose();
      }
      shockwaves.length = 0;
      for (const f of flashes) {
        group.remove(f.mesh);
        f.material.dispose();
      }
      flashes.length = 0;
    }
  }

  return { updateGesture, tick, setActive, reset, getStats: () => ({ ...stats }) };
}
