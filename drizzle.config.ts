import { defineConfig } from 'drizzle-kit'

// drizzle-kit doesn't read .env files itself.
try {
  process.loadEnvFile('.env.local')
} catch {
  // Fine on CI and Vercel, where the environment is already set.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  // Migrations go over a direct connection when there is one (Neon's integration sets both).
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)! },
})
