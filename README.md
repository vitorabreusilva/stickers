# Stickers

A mobile-first PWA for collecting stickers from pictures you find online. Pick a picture and draw a loop around the thing you want. An on-device model cuts it out of its background, and it becomes a die-cut sticker with a white border, saved to your collection.

## Features

- **Get pictures in**: upload from the camera roll or files, paste a copied image (Paste button or Ctrl/Cmd+V), drag and drop on desktop, or share an image to the installed app from the Android share sheet.
- **Circle to cut**: draw a freehand loop with your finger, mouse or pen. Pinch or scroll to zoom, then redraw as many times as you like.
- **Background removal**: the loop doesn't need to be precise. An on-device segmentation model finds the subject you circled and drops the background, even when the loop cuts through the subject. *Use whole picture* with background removal on picks out the picture's main subjects. If you turn it off, you get exactly what's inside the loop.
- **Sticker look**: the cut-out gets an anti-aliased white border (none, thin or thick) that follows its shape and fills enclosed gaps, like a real die-cut sticker.
- **Collection**: stickers are stored on the device in IndexedDB and work offline. Open one to share it, copy it to the clipboard, download it as a PNG, or delete it.
- **Private and offline**: pictures never leave the device. After the first cutout, the model is cached and background removal works offline too.

## Development

```bash
npm install
npm run dev          # local dev server (downloads the cutout model on first run)
npm run build        # production build in dist/
npm run preview      # serve the production build
npm run typecheck
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end flows in Chromium (Playwright), including real background removal
npm run icons        # re-render PWA icons from public/favicon.svg and scripts/icon-maskable.svg
```

The background-removal model (about 30 MB) isn't stored in git. Before `dev` and `build`, `scripts/fetch-model.mjs` downloads a pinned copy from Google's model storage into `public/models/` and checks its SHA-256.

To use a Chromium you already have instead of Playwright's download, set `CHROMIUM_PATH=/path/to/chrome` when running the e2e tests.

Service workers, clipboard access and installation need a secure context. They work on `localhost` and over HTTPS, but not over plain `http://<lan-ip>`.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` typechecks, tests and builds every pull request, and deploys every push to `main` to GitHub Pages.

One-time setup:

1. GitHub Pages needs a **public repository**, or GitHub Pro/Team for a private one.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run the workflow by hand from the Actions tab.

The app will be at `https://<user>.github.io/<repo>/`. The workflow reads the base path from the Pages settings, so a custom domain works as well. To build for another sub-path yourself, run `BASE_PATH=/some/path/ npm run build`.

## How it works

| Piece | File |
| --- | --- |
| Lasso editor (drawing, pinch/zoom, marching ants) | `src/components/LassoEditor.tsx` |
| Loop cleanup (decimation, Chaikin smoothing) | `src/lib/geometry.ts` |
| Background removal: model loading, caching, inference | `src/cutout.worker.ts`, `src/lib/cutout.ts` |
| Mask cleanup (stray specks, crisp edges) | `src/lib/mask.ts` |
| Cut-out and export | `src/lib/sticker.ts` |
| Border: distance transform, hole fill, compositing | `src/lib/outline.ts` |
| Storage | `src/lib/db.ts` |
| Service worker and share target | `src/sw.ts` |

**Background removal** uses Google's [MediaPipe Interactive Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter) v2 ("Magic Touch"), which accepts a lasso stroke as the prompt. It runs in a Web Worker so the UI stays responsive. It uses the GPU when there's a real one, and falls back to the CPU (WebAssembly) otherwise.

The worker gets the part of the picture around the loop plus some margin, so subjects that stick out of a quick loop still come out whole. If the model returns nearly the entire area, which happens with loose loops on plain backgrounds, it asks again with a point at the loop's center. The mask is then cleaned up by dropping specks and faint haze.

On first use the model and runtime (about 44 MB, or roughly 35 MB over the wire) download with a progress bar and are stored in Cache Storage. The app starts this download as soon as you open a picture, so it's usually done by the time you finish drawing. Check the model's card for license terms before using it commercially.

**The sticker** is the picture masked by the subject (or clipped to the loop), then outlined. A Euclidean distance transform on the alpha mask draws a border of exact width, and gaps enclosed by the border are filled. The result is trimmed and saved as a transparent PNG, between 512 and 1024 px on its longest side.

## Platform notes

- **Share target** (sharing an image straight into the app) only works on Android with the PWA installed. On iOS, long-press the image, tap *Copy*, then tap *Paste* in the app, or save it to Photos and upload it.
- **Background removal speed** depends on the device: it's fastest on the GPU. On CPU-only devices a cut can take several seconds.
- Large photos are downscaled to 3072 px on their longest side when opened, to stay within mobile Safari's canvas memory limits.
