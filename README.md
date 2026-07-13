# Handful 🖐️✨

A hand-gesture-controlled 3D particle playground. Show your webcam your hand,
pinch and spread to sculpt a living particle cloud in real time.

100% free and open source. No accounts, no API keys, no paid services anywhere
in this stack.

## What's in this build

- Live camera as a fullscreen AR-style background (particles float in your real room)
- Webcam hand tracking (MediaPipe HandLandmarker, up to 2 hands)
- **Fist** → collapse the cloud into a dense core
- **1–5 fingers extended** → morph between 5 shapes: sphere, torus, galaxy spiral, DNA helix, cube — blended smoothly, no hard cuts
- **Pinch thumb & index** → resize the cloud, works on any shape
- **Two hands, pull apart** → stretch the shape along that direction
- Start screen + in-app gesture guide covering all of the above

Natural next additions: color-swipe themes, wrist-rotation control, saving/sharing a snapshot.

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
