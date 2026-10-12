import { attachDatabasePool } from '@vercel/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { requireEnv } from '../env.js'
import * as schema from './schema.js'

function createDb() {
  // Neon's pooled connection string works with the standard driver, and so does Postgres in Docker.
  const pool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 5, idleTimeoutMillis: 10_000 })
  // On Vercel, lets idle connections close before a function instance is suspended.
  attachDatabasePool(pool)
  return drizzle(pool, { schema })
}

let db: ReturnType<typeof createDb> | undefined

/** Created on first use, so importing this never needs DATABASE_URL (e.g. while building). */
export function getDb() {
  db ??= createDb()
  return db
}

export type Db = ReturnType<typeof getDb>
