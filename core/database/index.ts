/**
 * Database exports
 */

export {
  closeDatabase,
  cosineSimilarity,
  type DatabaseConfig,
  deserializeVector,
  getDatabase,
  getDb,
  initDatabase,
  isDatabaseConnected,
  serializeVector,
  transaction,
} from './client';
export {
  type CreateMemoryParams,
  clearMemories,
  deleteMemory,
  formatMemoriesForPrompt,
  getMemories,
  getMemoriesByType,
  getMemoriesForPrompt,
  getMemoryCount,
  type MemorySource,
  type MemoryType,
  type SimilarMemory as SimilarMemoryResult,
  type StoredMemory,
  saveMemory,
  searchMemories,
  updateMemory,
} from './memories';

export {
  getMessageCount,
  getRecentMessages,
  insertMessage,
  type MessageInsert,
  messageExists,
  type SearchOptions,
  type SimilarMessage,
  type StoredMessage,
  searchSimilar,
  updateMessageEmbedding,
} from './messages';
export {
  getMigrationStatus,
  loadMigrations,
  type Migration,
  type MigrationRecord,
  type MigrationStatus,
  migrate,
  reset,
  rollback,
} from './migrator';
export {
  getLastSeen,
  getRecentUsers,
  getUserById,
  getUserByPlatformId,
  incrementMessageCount,
  type StoredUser,
  searchUsers,
  type UpsertUserParams,
  upsertUser,
} from './users';
