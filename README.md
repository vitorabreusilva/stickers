# Stickers

A mobile-first PWA for collecting stickers from pictures you find online. Pick a picture and draw a loop around the thing you want. An on-device model cuts it out of its background, and it becomes a die-cut sticker with a white border, saved to your collection.

## Features

- **Get pictures in**: upload from the camera roll or files, paste a copied image (Paste button or Ctrl/Cmd+V), drag and drop on desktop, or share an image to the installed app from the Android share sheet.
- **Circle to cut**: draw a freehand loop with your finger, mouse or pen. Pinch or scroll to zoom, then redraw as many times as you like.
- **Background removal**: the loop doesn't need to be precise. An on-device segmentation model finds the subject you circled and drops the background, even when the loop cuts through the subject. The cut line is then snapped to the real edges in the picture. On flat backdrops like white clip-art pages, gaps such as the space between legs are cut out, and floating watermarks are dropped. *Use whole picture* with background removal on picks out the picture's main subjects. If you turn it off, you get exactly what's inside the loop.
- **Sticker look**: the cut-out gets an anti-aliased white border (none, thin or thick) that follows its shape, like a real die-cut sticker. Gaps too small to cut are filled; bigger ones stay open.
- **Collection**: stickers are stored on the device in IndexedDB and work offline. The home screen shows your latest few up top, then your folders. Open one to share it, copy it to the clipboard, download it as a PNG, or delete it.
- **Grouped by topic**: stickers are sorted automatically into topics such as People, Dogs, Food & drinks and Cartoons & art, using small on-device models. Nothing leaves the phone. Tap a topic chip to filter, or move a sticker to another topic by hand from its detail view.
- **Coloring book** *(beta)*: open a sticker and tap *Color* to turn it into line art on an A5 page (148 × 210 mm), ready to print and colour in with pencils. **✨ AI** has an image model redraw the sticker as clean, professional line art: OpenAI GPT Image, Google Nano Banana 2, FLUX Kontext Pro, Seedream 4 and Qwen Image Edit on fal.ai, or QuiverAI's Arrow 2, which draws true vector (SVG) line art. It uses your own API keys (set them in *AI settings*; they're stored only on your device, and you pay the provider per page). When a model declines a sticker, the page offers the others you've set up. **Free** traces the lines on the device, offline. Pick Simple, Medium or Detailed, and optionally put the original sticker in the corner as a colour guide. Print the page or save it as a PDF, or add it to a coloring book.
- **Coloring books** *(beta)*: the home screen has a shelf of them under your stickers, and you can keep as many as you like. Each book is laid out for printing as a folded booklet: a cover made from the stickers inside, a "This book belongs to" page inside the cover, your pages with the book's title along the top and page numbers at the foot, blank pages to draw on so the count comes out in whole sheets (a multiple of four), and the inside and outside of the back cover. Pick the cover's colour and how the stickers sit on it (Playful, Tidy, Wild or Spotlight). Tap any page to leaf through the book, as facing pages on a wide screen. Print it, save it as A5 pages for a print shop, or save a booklet PDF with two pages on each A4 sheet, in the order that folds into the book.
- **Sync across devices**: sign in with Google (invited emails only) from the banner on first open or from *Settings* and the collection, folder colours and coloring books follow you to every device. It's local-first: everything is saved on the device and works offline or signed out, and changes sync in the background when there's a connection.
- **Backup**: *Settings* (the cog on the home screen) also saves the whole collection (stickers, folder colours, coloring books) to one JSON file, and restores one. Restoring adds to what's there and never deletes. AI keys aren't included.
- **Private**: cutting out, sorting and line tracing run on the device. When you sign in, stickers are stored in your account (a private Blob store, readable only through your signed-in session). AI keys stay on the device and never sync.

## Development

The app is a Vite + React PWA. The API lives in `server/` (Hono, Better Auth, Drizzle), runs as one Vercel Function (`api/index.ts`), and is served by the Vite dev and preview servers too, so `npm run dev` gives you everything on one port.

```bash
npm install
cp .env.example .env.local   # then fill in BETTER_AUTH_SECRET (openssl rand -base64 32) and ALLOWED_EMAILS
npm run db:up                # Postgres in Docker, on port 5433
npm run db:migrate           # create the tables
npm run dev                  # app and API on http://localhost:5173
```

Other commands:

```bash
npm run build        # production build in dist/
npm run preview      # serve the production build (API included)
npm run typecheck
npm test             # unit tests, plus API tests against Postgres when DATABASE_URL is set
npm run test:e2e     # end-to-end flows in Chromium, including two-device sync
npm run db:generate  # write a migration after changing server/db/schema.ts
npm run icons        # re-render PWA icons from public/favicon.svg and scripts/icon-maskable.svg
```

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` everything runs, but signing in fails. Tests don't need Google: they create sessions directly. Without a Blob token, pictures are kept in `.data/images/`.

The on-device models (about 42 MB in total) aren't stored in git. They're listed in `scripts/models.json` with pinned URLs and SHA-256 checksums. Before `dev` and `build`, `scripts/fetch-models.mjs` downloads them from Google's model storage into `public/models/`.

To use a Chromium you already have instead of Playwright's download, set `CHROMIUM_PATH=/path/to/chrome` when running the e2e tests.

Service workers, clipboard access and installation need a secure context. They work on `localhost` and over HTTPS, but not over plain `http://<lan-ip>`.

## Deploying to Vercel

Vercel builds every push through its Git integration: production from `main`, previews from other branches. The build runs the database migrations first (`vercel.json`). `.github/workflows/check.yml` typechecks and tests every push and pull request against a throwaway Postgres.

One-time setup:

1. **Project**: import the repository at [vercel.com/new](https://vercel.com/new). The settings come from `vercel.json`, so keep the defaults.
2. **Database**: in the project, open **Storage → Create → Neon**, and connect it to all environments. This sets `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`, which migrations use).
3. **Pictures**: **Storage → Create → Blob**, with **Private** access, connected to all environments.
4. **Google sign-in**: in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an *OAuth client ID* of type *Web application*:
   - Authorised JavaScript origins: `https://<your-domain>` and `http://localhost:5173`
   - Authorised redirect URIs: `https://<your-domain>/api/auth/callback/google` and `http://localhost:5173/api/auth/callback/google`
5. **Environment variables** (Settings → Environment Variables):
   - `BETTER_AUTH_SECRET`: `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: from step 4
   - `ALLOWED_EMAILS`: the Google emails that may sign in, comma-separated (`*` for anyone; empty lets no one in)
   - `BETTER_AUTH_URL`: `https://<your-domain>`. Optional on the default `*.vercel.app` production domain.
6. Redeploy so the build picks everything up.

Sign-in works on the production domain. Preview deployments get their own URLs that Google doesn't know, so sign in there only if you add them to the OAuth client.

**Moving from the GitHub Pages version**: the browser keeps each site's data separately, so the collection on `github.io` doesn't appear on the new domain by itself. On the old app, tap the box icon and download a backup. On the new one, sign in, then *Restore from a backup*, and it syncs to your account.

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
| Coloring pages: segmentation and line tracing | `src/lib/coloring.ts`, `src/workers/coloring.worker.ts` |
| AI coloring pages (OpenAI) and print cleanup | `src/lib/ai-coloring.ts`, `src/lib/line-art.ts`, `src/components/AiSettingsSheet.tsx` |
| A5 pages, cover collage, printing | `src/lib/book-layout.ts`, `src/lib/book-render.ts` |
| PDF export | `src/lib/pdf.ts` |
| Storage, outbox of unsynced changes | `src/lib/db.ts` |
| Sync engine (push outbox, pull changes) and Google sign-in | `src/lib/sync.ts`, `src/lib/account.ts`, `src/hooks/useAccount.ts` |
| Sync protocol shared by app and server | `src/lib/sync-protocol.ts` |
| API: auth, sync, pictures | `server/app.ts`, `server/auth.ts`, `server/sync.ts`, `server/images.ts` |
| Database schema and migrations | `server/db/schema.ts`, `drizzle/` |
| Backup file format, export and restore | `src/lib/backup.ts`, `src/components/BackupSheet.tsx` |
| Service worker and share target | `src/sw.ts` |

**Background removal** uses Google's [MediaPipe Interactive Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter) v2 ("Magic Touch"), which accepts a lasso stroke as the prompt. It runs in a Web Worker so the UI stays responsive. It uses the GPU when there's a real one, and falls back to the CPU (WebAssembly) otherwise.

**Plain backdrops** (clip art, stickers on white or flat colour) skip the model entirely. A smooth backdrop is fitted to the pixels outside the loop, backdrop-coloured pixels reachable from outside are cut away, and enclosed coloured gaps become holes while white areas inside the outline (eyes, gloves) are kept. Edge pixels are un-blended against the backdrop, so thin lines and handles stay intact without halos.

On busy pictures the worker gets the part of the picture around the loop plus some margin, so subjects that stick out of a quick loop still come out whole. If the model's lasso answer spills well outside the loop (it often grabs a bigger object behind the subject), it also asks with a point at the loop's center and keeps whichever result fits the loop better. The mask is then cleaned up by dropping specks and faint haze.

On first use the model and runtime (about 44 MB, or roughly 35 MB over the wire) download with a progress bar and are stored in Cache Storage. The app starts this download as soon as you open a picture, so it's usually done by the time you finish drawing. Check the model's card for license terms before using it commercially.

**Edge refinement**: the model's mask is coarse, so its edge is re-estimated at sticker resolution. Near the edge, each pixel's colour is placed between the nearby subject colour and the nearby background colour. This is trusted only where the two clearly differ, so busy backgrounds fall back to the model. On a flat backdrop, backdrop-coloured pixels connected to the outside are cut away. Regions of the same colour enclosed by the subject's outline, like white gloves, are kept. Background tint is then cleaned out of the edge pixels.

**The sticker** is the refined cut-out, outlined. A Euclidean distance transform on the alpha mask draws a border of exact width. Enclosed gaps are filled only if a circle a third of the border's width can't fit in them. The result is trimmed and saved as a transparent PNG, between 512 and 1024 px on its longest side.

**Topics**: after a sticker is saved, a background worker runs three small MediaPipe models on it: an EfficientNet-Lite2 ImageNet classifier, a MobileNet-V3 embedder and the BlazeFace face detector (about 12 MB, downloaded on first use). Classifier probabilities are summed into about a dozen topics. A confident real face means People, and similarity to a few cartoon drawings the app renders itself counts as Cartoons & art. Stickers that look alike (by embedding) share evidence, so a set of drawings in the same style ends up together. The analysis is stored with the sticker, and topics are recomputed whenever the collection changes. A topic you pick by hand always wins.

**AI coloring pages** (`src/lib/ai-coloring.ts`) send the sticker, laid on white in the closest supported shape (square, 3:2 or 2:3), straight from the browser to the chosen provider: OpenAI's image edits endpoint, Google's Gemini `generateContent` with image output, fal.ai's synchronous model endpoints, or QuiverAI's SVG generation endpoint (the sticker as a reference image; the SVG is rendered at print resolution, so its lines stay perfectly sharp). Every model gets the same prompt, asking for closed, even-weight black outlines with no colour or shading. Refusals are recognised per provider (safety errors, blocked prompts, answers with no picture) so the page can offer another model. Nothing is drawn until you tap *Draw with AI*, since each page costs money; drawings are kept while the page is open. The result is tidied for print in the worker (`src/lib/line-art.ts`): light greys drop out, it's cropped to the drawing, enlarged to fill the page, and its edges are sharpened. OpenAI's image models need a [verified organization](https://platform.openai.com/settings/organization/general); Google's need billing on the key's project; all need credit. fal.ai advises calling it from a server; if a browser call is blocked, the app says it couldn't reach fal.ai.

**Free coloring pages** are made on the device in a Web Worker, in one to three seconds. Stickers are often small cut-outs of low-resolution cartoons, so the sticker is first enlarged up to 3× (bicubic) and lines are found on the enlarged picture, where edges fall between the original pixels:

- **Strokes**: the artwork's own lines are found with a grey-level closing (black top-hat), which picks out anything darker than both of its sides but not the edge between two colour areas. Each stroke is cut at half its depth, so pale thin lines keep their width, and small gaps from compression are closed. Small black shapes such as pupils stay filled in, like in a printed coloring book; big ones are hollowed out to their outline.
- **Background**: white pixels reachable from outside the sticker are flooded. When the flood stops on ink (an outlined drawing), all of it is backing and is dropped, including white page background that came with the cut-out. Otherwise only a border-thick band is dropped, so white subjects aren't eaten.
- **Colour areas**: for parts without strokes, the original pixels are smoothed with edge-preserving diffusion and split into flat areas (k-means in Lab). Neighbouring areas that look alike or have no visible edge between them are merged, so a shaded gradient stays one area. Lines go where areas meet, but not right beside a stroke. The silhouette gets a thicker outline wherever the artwork has none of its own.
- **Drawing**: lines are kept as smoothed distance fields (signed for strokes) and drawn at 300 dpi, so they come out anti-aliased and keep the same width in millimetres on paper whatever the sticker's size.

**Sync** is local-first. Every edit is saved to IndexedDB together with an entry in an *outbox* (one per record, in the same transaction). When signed in, the app sends the outbox: pictures first (`PUT /api/images/…`, kept in a private Blob store under the user's id), then the records (`POST /api/sync`). Then it asks for everything that changed since the last revision it saw (`GET /api/sync?since=`). Every write on the server takes the next number from one Postgres sequence, and one person's writes are serialised with an advisory lock, so "everything after N" never skips a row. Deletions are kept as tombstones. A change from the server never overwrites a record with unsent local edits: those go up next and win. Pictures never change after they're made, so only new records download theirs. The first time an account syncs on a device, the whole local collection is uploaded to it. Sync runs on start, a moment after each edit, when the app comes back to the foreground or online, and every couple of minutes while it's open. The allowlist is checked on every request, so removing an email locks that person out straight away.

PDFs are written by a small built-in writer: greyscale pages compressed with the browser's `CompressionStream`, and a JPEG cover.

## Platform notes

- **Share target** (sharing an image straight into the app) only works on Android with the PWA installed. On iOS, long-press the image, tap *Copy*, then tap *Paste* in the app, or save it to Photos and upload it.
- **Background removal speed** depends on the device: it's fastest on the GPU. On CPU-only devices a cut can take several seconds.
- Large photos are downscaled to 3072 px on their longest side when opened, to stay within mobile Safari's canvas memory limits.
