// Turning records into plain JSON and back, for backup files and the sync server.

import type { StickerAnalysis } from './topics'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // fromCharCode takes its arguments on the stack, so feed it in chunks.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** An analysis as plain JSON: the embedding becomes base64 of its float bytes. */
export type EncodedAnalysis = Omit<StickerAnalysis, 'embedding'> & { embedding: string }

export function encodeAnalysis(analysis: StickerAnalysis): EncodedAnalysis {
  const { embedding } = analysis
  return {
    ...analysis,
    embedding: bytesToBase64(new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength)),
  }
}

/** Reads an encoded analysis back. Anything malformed comes back undefined, so it's simply redone. */
export function decodeAnalysis(value: unknown): StickerAnalysis | undefined {
  const encoded = value as EncodedAnalysis | null | undefined
  if (typeof encoded?.embedding !== 'string' || typeof encoded.version !== 'number') return undefined
  try {
    const bytes = base64ToBytes(encoded.embedding)
    if (bytes.byteLength % 4) return undefined
    return { ...encoded, embedding: new Float32Array(bytes.buffer) }
  } catch {
    return undefined
  }
}
