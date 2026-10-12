# Stickers

A mobile-first PWA for collecting stickers from pictures you find online. Pick a picture and draw a loop around the thing you want. An on-device model cuts it out of its background, and it becomes a die-cut sticker with a white border, saved to your collection.

## Features

- **Get pictures in**: upload from the camera roll or files, paste a copied image (Paste button or Ctrl/Cmd+V), drag and drop on desktop, or share an image to the installed app from the Android share sheet.
- **Circle to cut**: draw a freehand loop with your finger, mouse or pen. Pinch or scroll to zoom, then redraw as many times as you like.
- **Background removal**: the loop doesn't need to be precise. An on-device segmentation model finds the subject you circled and drops the background, even when the loop cuts through the subject. The cut line is then snapped to the real edges in the picture. On flat backdrops like white clip-art pages, gaps such as the space between legs are cut out, and floating watermarks are dropped. *Use whole picture* with background removal on picks out the picture's main subjects. If you turn it off, you get exactly what's inside the loop.
- **Sticker look**: the cut-out gets an anti-aliased white border (none, thin or thick) that follows its shape, like a real die-cut sticker. Gaps too small to cut are filled; bigger ones stay open.
- **Collection**: stickers are stored on the device in IndexedDB and work offline. Open one to share it, copy it to the clipboard, download it as a PNG, or delete it.
- **Grouped by topic**: stickers are sorted automatically into topics such as People, Dogs, Food & drinks and Cartoons & art, using small on-device models. Nothing leaves the phone. Tap a topic chip to filter, or move a sticker to another topic by hand from its detail view.
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

The on-device models (about 42 MB in total) aren't stored in git. They're listed in `scripts/models.json` with pinned URLs and SHA-256 checksums. Before `dev` and `build`, `scripts/fetch-models.mjs` downloads them from Google's model storage into `public/models/`.

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
| Background removal: model loading, caching, inference | `src/workers/cutout.worker.ts`, `src/lib/cutout.ts` |
| Mask cleanup (stray specks, crisp edges) | `src/lib/mask.ts` |
| Edge refinement: colour matte, backdrop keying, decontamination | `src/lib/refine.ts` |
| Plain-backdrop matting (exact cut-outs on flat backgrounds) | `src/lib/backdrop.ts` |
| Cut-out and export | `src/lib/sticker.ts` |
| Border: distance transform, gap filling, compositing | `src/lib/outline.ts` |
| Topic analysis: classifier, embedder, face detector | `src/workers/analysis.worker.ts`, `src/lib/analysis.ts` |
| Topics: class-to-topic mapping and grouping | `src/lib/topics.ts`, `src/lib/drawings.ts` |
| Shared MediaPipe runtime loading and caching | `src/workers/vision-runtime.ts` |
| Storage | `src/lib/db.ts` |
| Service worker and share target | `src/sw.ts` |

**Background removal** uses Google's [MediaPipe Interactive Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter) v2 ("Magic Touch"), which accepts a lasso stroke as the prompt. It runs in a Web Worker so the UI stays responsive. It uses the GPU when there's a real one, and falls back to the CPU (WebAssembly) otherwise.

**Plain backdrops** (clip art, stickers on white or flat colour) skip the model entirely. A smooth backdrop is fitted to the pixels outside the loop, backdrop-coloured pixels reachable from outside are cut away, and enclosed coloured gaps become holes while white areas inside the outline (eyes, gloves) are kept. Edge pixels are un-blended against the backdrop, so thin lines and handles stay intact without halos.

On busy pictures the worker gets the part of the picture around the loop plus some margin, so subjects that stick out of a quick loop still come out whole. If the model's lasso answer spills well outside the loop (it often grabs a bigger object behind the subject), it also asks with a point at the loop's center and keeps whichever result fits the loop better. The mask is then cleaned up by dropping specks and faint haze.

On first use the model and runtime (about 44 MB, or roughly 35 MB over the wire) download with a progress bar and are stored in Cache Storage. The app starts this download as soon as you open a picture, so it's usually done by the time you finish drawing. Check the model's card for license terms before using it commercially.

**Edge refinement**: the model's mask is coarse, so its edge is re-estimated at sticker resolution. Near the edge, each pixel's colour is placed between the nearby subject colour and the nearby background colour. This is trusted only where the two clearly differ, so busy backgrounds fall back to the model. On a flat backdrop, backdrop-coloured pixels connected to the outside are cut away. Regions of the same colour enclosed by the subject's outline, like white gloves, are kept. Background tint is then cleaned out of the edge pixels.

**The sticker** is the refined cut-out, outlined. A Euclidean distance transform on the alpha mask draws a border of exact width. Enclosed gaps are filled only if a circle a third of the border's width can't fit in them. The result is trimmed and saved as a transparent PNG, between 512 and 1024 px on its longest side.

**Topics**: after a sticker is saved, a background worker runs three small MediaPipe models on it: an EfficientNet-Lite2 ImageNet classifier, a MobileNet-V3 embedder and the BlazeFace face detector (about 12 MB, downloaded on first use). Classifier probabilities are summed into about a dozen topics. A confident real face means People, and similarity to a few cartoon drawings the app renders itself counts as Cartoons & art. Stickers that look alike (by embedding) share evidence, so a set of drawings in the same style ends up together. The analysis is stored with the sticker, and topics are recomputed whenever the collection changes. A topic you pick by hand always wins.

## Platform notes

- **Share target** (sharing an image straight into the app) only works on Android with the PWA installed. On iOS, long-press the image, tap *Copy*, then tap *Paste* in the app, or save it to Photos and upload it.
- **Background removal speed** depends on the device: it's fastest on the GPU. On CPU-only devices a cut can take several seconds.
- Large photos are downscaled to 3072 px on their longest side when opened, to stay within mobile Safari's canvas memory limits.
