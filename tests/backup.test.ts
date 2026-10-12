import { describe, expect, it } from 'vitest'
import { backupFilename, base64ToBytes, bytesToBase64, BackupError, createBackup, readBackup } from '../src/lib/backup'

const png = (...bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })
const bytesOf = async (blob: Blob) => Array.from(new Uint8Array(await blob.arrayBuffer()))

describe('base64', () => {
  it('round-trips every byte value, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 7).map((_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('backup', () => {
  it('round-trips a collection with its pictures', async () => {
    const file = await createBackup({
      stickers: [
        { id: 'a', blob: png(1, 2, 3), width: 10, height: 20, createdAt: 5, effect: 'holo', topic: 'dogs' },
        { id: 'b', blob: png(255, 0), width: 1, height: 1, createdAt: 4 },
      ],
      folders: [{ key: 'dogs', color: 'mint' }],
      book: [
        {
          id: 'p',
          stickerId: 'a',
          sticker: png(9),
          page: png(8, 7),
          detail: 'medium',
          position: 0,
          createdAt: 6,
        },
      ],
      bookTitle: 'Rex & friends',
    })
    expect(file.type).toBe('application/json')

    const back = await readBackup(file)
    expect(back.stickers.map((s) => [s.id, s.width, s.effect, s.topic])).toEqual([
      ['a', 10, 'holo', 'dogs'],
      ['b', 1, undefined, undefined],
    ])
    expect(await bytesOf(back.stickers[0].blob)).toEqual([1, 2, 3])
    expect(back.stickers[0].blob.type).toBe('image/png')
    expect(await bytesOf(back.stickers[1].blob)).toEqual([255, 0])
    expect(back.folders).toEqual([{ key: 'dogs', color: 'mint' }])
    expect(await bytesOf(back.book[0].page)).toEqual([8, 7])
    expect(await bytesOf(back.book[0].sticker)).toEqual([9])
    expect(back.book[0].detail).toBe('medium')
    expect(back.bookTitle).toBe('Rex & friends')
  })

  it('handles an empty collection', async () => {
    const back = await readBackup(await createBackup({ stickers: [], folders: [], book: [], bookTitle: null }))
    expect(back).toEqual({ stickers: [], folders: [], book: [], bookTitle: null })
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
