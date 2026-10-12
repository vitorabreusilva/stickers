# Stickers

A mobile-first PWA for collecting stickers from pictures you find online. Pick a picture, draw a loop around the part you want, and it becomes a die-cut sticker with a white border, saved to your collection.

## Features

- **Get pictures in**: upload from the camera roll or files, paste a copied image (Paste button or Ctrl/Cmd+V), drag and drop on desktop, or share an image to the installed app from the Android share sheet.
- **Circle to cut**: draw a freehand loop with your finger, mouse or pen. Pinch or scroll to zoom, then redraw as many times as you like. You can also use the whole picture, which works well for PNGs that already have a transparent background.
- **Sticker look**: the cut-out gets an anti-aliased white border (none, thin or thick) that follows its shape and fills enclosed gaps, like a real die-cut sticker.
- **Collection**: stickers are stored on the device in IndexedDB and work offline. Open one to share it, copy it to the clipboard, download it as a PNG, or delete it.
- **Installable**: there's a web app manifest, icons, and a service worker that precaches the app.

## Development

```bash
npm install
npm run dev          # local dev server
npm run build        # production build in dist/
npm run preview      # serve the production build
npm run typecheck
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end flow in Chromium (Playwright)
npm run icons        # re-render PWA icons from public/favicon.svg and scripts/icon-maskable.svg
```

To use a Chromium you already have instead of Playwright's download, set `CHROMIUM_PATH=/path/to/chrome` when running the e2e tests.

Service workers, clipboard access and installation need a secure context. They work on `localhost` and over HTTPS, but not over plain `http://<lan-ip>`. To try the app on a phone, deploy it or use an HTTPS tunnel.

## Deploying

`npm run build` produces a static site in `dist/` that any static host can serve. If the app lives under a sub-path (for example GitHub Pages at `/stickers/`), build with `BASE_PATH=/stickers/ npm run build`.

## How it works

| Piece | File |
| --- | --- |
| Lasso editor (drawing, pinch/zoom, marching ants) | `src/components/LassoEditor.tsx` |
| Loop cleanup (decimation and Chaikin smoothing) | `src/lib/geometry.ts` |
| Cut-out and export | `src/lib/sticker.ts` |
| Border: distance transform, hole fill, compositing | `src/lib/outline.ts` |
| Storage | `src/lib/db.ts` |
| Service worker and share target | `src/sw.ts` |

A sticker is made by clipping the picture to the loop, then running a Euclidean distance transform on the alpha mask to draw a border of exact width around whatever is visible. The result is trimmed and saved as a transparent PNG, between 512 and 1024 px on its longest side.

## Platform notes

- **Share target** (sharing an image straight into the app) only works on Android with the PWA installed. On iOS, long-press the image, tap *Copy*, then tap *Paste* in the app, or save it to Photos and upload it.
- Large photos are downscaled to 3072 px on their longest side when opened, to stay within mobile Safari's canvas memory limits.
