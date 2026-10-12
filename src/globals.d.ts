/** Paths of the on-device models under the site's base URL (see scripts/models.json). */
declare const __MODELS__: { cutout: string; classifier: string; embedder: string; face: string }
/** Combined size of the cutout model and the vision runtime, for download progress. 0 if unknown. */
declare const __CUTOUT_BYTES__: number
