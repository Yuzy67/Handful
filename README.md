# Handful 🖐️✨

A hand-gesture-controlled 3D particle playground. Show your webcam your hand,
pinch and spread to sculpt a living particle cloud in real time.

100% free and open source. No accounts, no API keys, no paid services anywhere
in this stack.

## What's in this build

- Live camera as a fullscreen AR-style background (particles float in your real room)
- Webcam hand tracking (MediaPipe HandLandmarker, up to 2 hands, GPU with automatic CPU fallback)
- Three selectable experiences from a mode-select screen after Start:

**Play with Particles**
- **Fist** → collapse the cloud into a dense core
- **1–5 fingers extended** → morph between 5 shapes: sphere, torus, galaxy spiral, DNA helix, cube — blended smoothly, no hard cuts
- **Pinch thumb & index** → resize the cloud, works on any shape
- **Two hands, pull apart** → stretch the shape along that direction

**Draw in AR**
- **Point with your index finger** (other fingers curled) and move your hand → paints a continuous glowing 3D tube tracing your fingertip's exact path — real extruded geometry with a circular cross-section, not a particle effect
- Fingertip position is smoothed before it reaches the curve, so natural hand tremor doesn't turn into a jagged line
- **2–5 fingers extended** → switch brush: Electric, Fire, Water, Leaf — each with its own color, thickness, and animated glow flowing along the surface
- **Make a fist and move your hand** → grabs and drags your entire drawing as one piece, like picking up a page
- Strokes persist once drawn (like real ink) until you clear the canvas
- Clear button in the HUD wipes everything and resets the drawing's position

**Slice Fruits**
- 11 procedurally-textured fruits (apple, watermelon, lemon, grape, mango, strawberry, orange, kiwi, coconut, peach, pomegranate) arc up and fall under real gravity — each with its own non-spherical proportions (oblong lemon and strawberry, flattened apple and orange, round grape) instead of every fruit being a plain sphere
- Skin patterns are UV-mapped to correctly wrap the sphere (watermelon stripes run as true vertical meridians, not a diagonal smear), and each fruit's sliced cross-section shows three distinct layers — skin, rind, flesh — with its own realistic internal detail: citrus wedges, a mango/peach pit, kiwi's seed ring, pomegranate's packed arils
- **Drag your index finger through a fruit** → slices it into two physically separating halves with a matching flesh cross-section, a juice burst, an expanding shockwave ring, and a quick flash
- **💣 Bombs** spawn among the fruit — dark, pulsing, unmistakable. Slicing one costs points instead of earning them, with its own distinct smoke-burst explosion
- Works with **both hands independently** — each can slice on its own
- A lightweight glowing blade trail follows fast finger motion
- Live **score and strike rate** shown in the HUD (score = fruit sliced minus a penalty per bomb hit); clear button resets everything and starts a fresh run
- Fruit spawn positions and arc height are recalculated from the live screen size every time, so nothing spawns or arcs off-screen on any aspect ratio, including narrow phones
- Fingertip position is lightly smoothed before it's used for both the blade trail and hit detection — reduces raw tracking jitter without adding noticeable lag
- The last few swipe segments are tested each update, not just the newest one, so a fast continuous swipe can't slip past a fruit purely because of which exact frame boundary got tested
- Fruits spin around a single random axis rather than tumbling on all three independently, drift decays slightly over the arc like real air resistance, and sliced halves "pop" briefly oversized before settling to size — small physical-motion details that add up
- **Difficulty ramps up the longer a run continues** — fruits launch faster and spawn more often, reaching full difficulty in about 30 seconds. A fruit already in the air keeps the speed it launched with — only newly spawned fruits reflect the harder difficulty, so nothing jarringly speeds up mid-flight. Resets alongside your score when you hit clear.
- Swipe detection is timed against the real interval between camera frames (not the render loop), and the blade trail is a single pre-allocated, in-place-updated mesh rather than rebuilt from scratch every frame — deliberate fixes for lag and inconsistent detection, especially on phones, which is most of this app's traffic. Materials are intentionally unlit (a texture with baked-in shading, not real-time per-pixel lighting) for the same reason — real dynamic lighting is one of the more expensive things to ask a phone GPU to do, especially with several fruits, halves, and effects on screen at once.

All three modes share the same camera/tracking session — switch between them anytime via the ⇄ button without restarting.

Natural next additions: color-swipe themes for particle mode, two-hand simultaneous drawing, saving/sharing a snapshot.

## Run it locally (free, 5 minutes)

1. Install [Node.js](https://nodejs.org) (free, LTS version) if you don't have it.
2. Open a terminal in this folder and run:
   ```
   npm install
   npm run dev
   ```
3. Open the printed `http://localhost:5173` link in Chrome or Edge.
4. Click **Start**, allow camera access, and move your hand in front of the camera.

No build servers, no paid MediaPipe/Three.js tier — every dependency here is
open source (MIT/Apache-2.0) and the model files load from Google's free
public CDN.

## Host it for free (so anyone can just open a link)

1. Push this folder to a public GitHub repo.
2. Run `npm run build` — this outputs a static `dist/` folder.
3. Enable **GitHub Pages** in the repo settings pointed at `dist/`
   (or use [Netlify](https://netlify.com)/[Vercel](https://vercel.com) free tier —
   drag-and-drop the `dist/` folder, done).
4. You now have a permanent free URL — no server costs, ever, since everything
   runs in the visitor's own browser.

## Turning this into a literal downloadable desktop app (optional)

If you want a true double-click `.exe`/`.dmg` instead of a browser link, wrap
this same code in [Electron](https://www.electronjs.org) (also free/open
source) using `electron-builder`. The camera/particle logic doesn't change —
only the shell around it does.

## License

MIT — do anything you want with it, including forking and republishing.
