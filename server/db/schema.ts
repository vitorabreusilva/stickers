import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

// Auth tables, in the shape Better Auth expects.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// The collection. Every write takes the next number from one sequence, so a device can ask for
// "everything after the last number I saw". Deleted rows stay as tombstones so the deletion syncs.

export const revisions = pgSequence('sync_rev')
const nextRev = sql`nextval('sync_rev')`

const owner = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
const rev = () => bigint('rev', { mode: 'number' }).notNull().default(nextRev)

export const stickers = pgTable(
  'stickers',
  {
    userId: owner(),
    id: text('id').notNull(),
    rev: rev(),
    deleted: boolean('deleted').notNull().default(false),
    width: integer('width').notNull().default(0),
    height: integer('height').notNull().default(0),
    /** Milliseconds since the epoch, as on the device. */
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
    analysis: jsonb('analysis'),
    topic: text('topic'),
    effect: text('effect'),
    /** What the AI says the sticker shows, and its AI folder. */
    ai: jsonb('ai'),
    /** Where the sticker sits in the picture it was cut from; null when that picture isn't kept. */
    sourceRect: jsonb('source_rect'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('stickers_rev_idx').on(t.userId, t.rev)],
)

export const folders = pgTable(
  'folders',
  {
    userId: owner(),
    key: text('key').notNull(),
    rev: rev(),
    /** '' until a colour is picked. */
    color: text('color').notNull(),
    /** The name the user gave it, if any. */
    name: text('name'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index('folders_rev_idx').on(t.userId, t.rev)],
)

export const bookPages = pgTable(
  'book_pages',
  {
    userId: owner(),
    id: text('id').notNull(),
    rev: rev(),
    deleted: boolean('deleted').notNull().default(false),
    /** Pages from before there could be several books are in the book called 'default'. */
    bookId: text('book_id').notNull().default('default'),
    stickerId: text('sticker_id').notNull().default(''),
    effect: text('effect'),
    detail: text('detail').notNull().default('medium'),
    hideGuide: boolean('hide_guide').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('book_pages_rev_idx').on(t.userId, t.rev)],
)

export const books = pgTable(
  'books',
  {
    userId: owner(),
    id: text('id').notNull(),
    rev: rev(),
    deleted: boolean('deleted').notNull().default(false),
    title: text('title').notNull().default(''),
    background: text('background').notNull().default('cream'),
    layout: text('layout').notNull().default('playful'),
    /** One sticker on the cover instead of the layout. */
    cover: jsonb('cover'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('books_rev_idx').on(t.userId, t.rev)],
)

export const settings = pgTable('settings', {
  userId: owner().primaryKey(),
  rev: rev(),
  bookTitle: text('book_title'),
})

export { nextRev }
