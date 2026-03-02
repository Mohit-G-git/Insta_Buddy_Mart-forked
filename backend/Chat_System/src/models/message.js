/**
 * Message Model
 * NOTE: This is a placeholder file. The actual database queries are handled by messageService.js
 * and the messages table in PostgreSQL.
 * 
 * Messages Schema (PostgreSQL):
 * - id: UUID (primary key)
 * - room_id: UUID (FK to chat_rooms)
 * - sender_id: UUID (FK to users, nullable for system messages)
 * - content: TEXT
 * - message_type: ENUM('text', 'image', 'video', 'voice', 'location', 'system')
 * - media_url: VARCHAR (S3 URL)
 * - media_thumb: VARCHAR (S3 thumbnail URL)
 * - media_size_kb: INTEGER
 * - reply_to_id: UUID (FK to messages, nullable)
 * - is_deleted: BOOLEAN (soft delete)
 * - deleted_at: TIMESTAMP
 * - sent_at: TIMESTAMP
 * - read_by: UUID[] (array of user IDs who have read)
 */

module.exports = {};
