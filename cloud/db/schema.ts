import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), email: text('email').notNull(), displayName: text('display_name').notNull(),
  googleSubject: text('google_subject').notNull(), role: text('role').notNull().default('member'),
  status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email), uniqueIndex('users_google_subject_unique').on(t.googleSubject)]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull(), csrfToken: text('csrf_token').notNull(),
  expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('idx_sessions_user').on(t.userId), index('idx_sessions_expires').on(t.expiresAt)]);

export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(), codeVerifier: text('code_verifier').notNull(), nonce: text('nonce').notNull(),
  nextPath: text('next_path').notNull().default('/'), expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('idx_oauth_states_expires').on(t.expiresAt)]);

export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), title: text('title').notNull(),
  description: text('description').notNull().default(''), url: text('url'), storageKey: text('storage_key'),
  originalName: text('original_name'), mimeType: text('mime_type'), sizeBytes: integer('size_bytes'),
  ownerId: text('owner_id').notNull(), parentId: text('parent_id'), accessLevel: text('access_level').notNull().default('private'),
  revision: integer('revision').notNull().default(1), trashedAt: text('trashed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('idx_resources_parent').on(t.parentId), index('idx_resources_owner').on(t.ownerId), index('idx_resources_trash').on(t.trashedAt)]);

export const resourceMembers = sqliteTable('resource_members', {
  resourceId: text('resource_id').notNull(), userId: text('user_id').notNull(), role: text('role').notNull(),
}, (t) => [primaryKey({ columns: [t.resourceId, t.userId] }), index('idx_resource_members_user').on(t.userId)]);

export const shareLinks = sqliteTable('share_links', {
  resourceId: text('resource_id').primaryKey(), tokenHash: text('token_hash').notNull(), role: text('role').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('share_links_token_hash_unique').on(t.tokenHash)]);

export const resourceVersions = sqliteTable('resource_versions', {
  resourceId: text('resource_id').notNull(), revision: integer('revision').notNull(), kind: text('kind').notNull(),
  title: text('title').notNull(), description: text('description').notNull(), url: text('url'), storageKey: text('storage_key'),
  originalName: text('original_name'), mimeType: text('mime_type'), sizeBytes: integer('size_bytes'), parentId: text('parent_id'),
  event: text('event').notNull(), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.resourceId, t.revision] }), index('idx_resource_versions_created').on(t.resourceId, t.createdAt)]);

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }), actorId: text('actor_id'), action: text('action').notNull(),
  targetId: text('target_id'), details: text('details').notNull().default('{}'), createdAt: text('created_at').notNull(),
}, (t) => [index('idx_audit_log_created').on(t.createdAt)]);
