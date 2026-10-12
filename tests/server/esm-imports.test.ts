import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// On Vercel the API runs as plain Node ES modules, where a relative import needs its file
// extension ('./topics.js', not './topics'). Vite and Vitest resolve either, so a missing one
// only shows up in production, as every API request failing. This walks everything the Vercel
// Function loads and checks each import that survives compilation (type-only ones don't).

const ROOT = resolve(__dirname, '../..')
const ENTRY = resolve(ROOT, 'api/index.ts')

/** Relative imports and re-exports in `source` that are kept at runtime. */
function runtimeImports(source: string): string[] {
  const specs: string[] = []
  const statement = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/gms
  for (const [, , typeOnly, clause, spec] of source.matchAll(statement)) {
    if (typeOnly) continue
    // `import { type A, type B } from` is erased too.
    const names = clause.match(/^\{([^}]*)\}$/s)?.[1]
    if (names && names.split(',').every((n) => !n.trim() || n.trim().startsWith('type '))) continue
    specs.push(spec)
  }
  for (const [, spec] of source.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) specs.push(spec)
  return specs
}

describe('the API as Node ES modules', () => {
  it('imports every relative module with its .js extension', () => {
    const problems: string[] = []
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of runtimeImports(readFileSync(file, 'utf8'))) {
        const where = `${relative(ROOT, file)} imports '${spec}'`
        if (!spec.endsWith('.js')) {
          problems.push(`${where} without .js`)
          continue
        }
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'))
        if (!existsSync(target)) problems.push(`${where}, which doesn't exist`)
        else visit(target)
      }
    }
    visit(ENTRY)
    expect(problems).toEqual([])
    // The walk reaches the shared modules, so it's checking what it should.
    expect([...seen].map((f) => relative(ROOT, f))).toContain('src/lib/topics.ts')
  })
})
