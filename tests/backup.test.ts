import { describe, expect, it } from 'vitest'
import { backupFilename, BackupError, createBackup, readBackup } from '../src/lib/backup'
import { base64ToBytes, bytesToBase64 } from '../src/lib/codec'

const png = (...bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })
const bytesOf = async (blob: Blob) => Array.from(new Uint8Array(await blob.arrayBuffer()))

describe('base64', () => {
  it('round-trips every byte value, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 7).map((_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

// Not a multiple of 3 bytes, so base64 padding is exercised too.
const embedding = Float32Array.from([0.5, -0.25, 1e-7, 3.14159, -0])

describe('backup', () => {
  it('round-trips a collection with its pictures', async () => {
    const file = await createBackup({
      stickers: [
        {
          id: 'a',
          blob: png(1, 2, 3),
          width: 10,
          height: 20,
          createdAt: 5,
          effect: 'holo',
          topic: 'dogs',
          analysis: { version: 1, classes: [{ index: 207, name: 'golden retriever', score: 0.9 }], face: 0, drawn: 0.12, embedding },
        },
        {
          id: 'b',
          blob: png(255, 0),
          width: 1,
          height: 1,
          createdAt: 4,
          kind: 'stamp',
          original: new Blob([new Uint8Array([0xff, 0xd8, 7])], { type: 'image/jpeg' }),
          originalSize: { width: 4032, height: 3024 },
        },
      ],
      folders: [{ key: 'dogs', color: 'mint' }],
      book: [
        {
          id: 'p',
          bookId: 'b1',
          stickerId: 'a',
          sticker: png(9),
          page: png(8, 7),
          detail: 'medium',
          position: 0,
          createdAt: 6,
        },
      ],
      books: [{ id: 'b1', title: 'Rex & friends', background: 'mint', layout: 'tidy', createdAt: 6 }],
      bookTitle: 'Rex & friends',
    })
    expect(file.type).toBe('application/json')

    const back = await readBackup(file)
    expect(back.stickers.map((s) => [s.id, s.width, s.effect, s.topic])).toEqual([
      ['a', 10, 'holo', 'dogs'],
      ['b', 1, undefined, undefined],
    ])
    expect(back.stickers[0].analysis!.embedding).toBeInstanceOf(Float32Array)
    expect(back.stickers[0].analysis!.embedding).toEqual(embedding)
    expect(back.stickers[0].analysis!.classes[0].name).toBe('golden retriever')
    expect('analysis' in back.stickers[1]).toBe(false)
    expect(await bytesOf(back.stickers[0].blob)).toEqual([1, 2, 3])
    expect(back.stickers[0].blob.type).toBe('image/png')
    expect(await bytesOf(back.stickers[1].blob)).toEqual([255, 0])
    // Stamps stay stamps, and keep the picture they were made from.
    expect(back.stickers[1].kind).toBe('stamp')
    expect(back.stickers[1].originalSize).toEqual({ width: 4032, height: 3024 })
    expect(await bytesOf(back.stickers[1].original!)).toEqual([0xff, 0xd8, 7])
    expect(back.stickers[1].original!.type).toBe('image/jpeg')
    expect('original' in back.stickers[0]).toBe(false)
    expect(back.folders).toEqual([{ key: 'dogs', color: 'mint' }])
    expect(await bytesOf(back.book[0].page)).toEqual([8, 7])
    expect(await bytesOf(back.book[0].sticker)).toEqual([9])
    expect(back.book[0].detail).toBe('medium')
    expect(back.book[0].bookId).toBe('b1')
    expect(back.books).toEqual([{ id: 'b1', title: 'Rex & friends', background: 'mint', layout: 'tidy', createdAt: 6 }])
    expect(back.bookTitle).toBe('Rex & friends')
  })

  it('handles an empty collection', async () => {
    const back = await readBackup(await createBackup({ stickers: [], folders: [], book: [], books: [], bookTitle: null }))
    expect(back).toEqual({ stickers: [], folders: [], book: [], books: [], bookTitle: null })
  })

  it('reads backups from before there could be several books', async () => {
    const old = { format: 'stickers-backup', version: 1, exportedAt: '', stickers: [], folders: [], book: [], bookTitle: 'Old' }
    const back = await readBackup(new Blob([JSON.stringify(old)]))
    expect(back.books).toEqual([])
    expect(back.bookTitle).toBe('Old')
  })

  it('rejects files that are not backups', async () => {
    await expect(readBackup(new Blob(['not json']))).rejects.toBeInstanceOf(BackupError)
    await expect(readBackup(new Blob(['{"hello":1}']))).rejects.toBeInstanceOf(BackupError)
    await expect(readBackup(new Blob(['{"format":"stickers-backup","version":99}']))).rejects.toThrow(/newer/)
  })

  it('names the file after the local date', () => {
    expect(backupFilename(new Date(2026, 0, 5, 23, 59))).toBe('stickers-backup-2026-01-05.json')
  })
})
