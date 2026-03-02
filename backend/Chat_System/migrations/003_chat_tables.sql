-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLE: chat_rooms
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES events(id) ON DELETE SET NULL,
  room_type       VARCHAR(20) NOT NULL DEFAULT 'direct',
  room_name       VARCHAR(200),
  room_photo      VARCHAR(500),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_room_type CHECK (room_type IN ('direct', 'group'))
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_event ON chat_rooms(event_id);
CREATE INDEX IF NOT EXISTS idx_chatrooms_last_msg ON chat_rooms(last_message_at DESC);

COMMENT ON TABLE chat_rooms IS 'Chat rooms for direct messaging and group event coordination. Direct rooms have exactly 2 members and no event_id. Group rooms have 2+ members and are tied to an event_id.';
COMMENT ON COLUMN chat_rooms.event_id IS 'Foreign key to events table. NULL for direct (1:1) chat rooms.';
COMMENT ON COLUMN chat_rooms.room_type IS 'Type of room: "direct" for 1:1 chats, "group" for event-based group chats.';
COMMENT ON COLUMN chat_rooms.room_name IS 'Display name for the room. For group rooms, this is the event title at the time of room creation.';
COMMENT ON COLUMN chat_rooms.room_photo IS 'Avatar/cover photo URL for the room. For group rooms, this is the event cover photo at the time of creation. Must be CloudFront CDN URL.';
COMMENT ON COLUMN chat_rooms.last_message_at IS 'Timestamp of the most recent message in this room. Used for sorting rooms by recency in the GET /rooms endpoint.';

-- ============================================================================
-- TABLE: chat_room_members
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_room_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMP,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_room ON chat_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_user_active ON chat_room_members(user_id, is_active);

COMMENT ON TABLE chat_room_members IS 'Membership table tracking which users are members of which chat rooms. Supports future soft-leave feature (is_active = false).';
COMMENT ON COLUMN chat_room_members.last_read_at IS 'Timestamp when this user last read messages in this room. Used to calculate unread message count.';
COMMENT ON COLUMN chat_room_members.is_active IS 'Whether the user is an active member of this room. false indicates the user has left the group (future feature).';

-- ============================================================================
-- TABLE: messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT,
  message_type  VARCHAR(20) NOT NULL DEFAULT 'text',
  media_url     VARCHAR(500),
  media_thumb   VARCHAR(500),
  media_size_kb INTEGER,
  reply_to_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_deleted    BOOLEAN NOT NULL DEFAULT false,
  deleted_at    TIMESTAMP,
  sent_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  read_by       UUID[] NOT NULL DEFAULT '{}',
  
  CONSTRAINT check_message_type CHECK (message_type IN ('text', 'image', 'video', 'voice', 'system')),
  CONSTRAINT check_content_or_media CHECK (content IS NOT NULL OR media_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

COMMENT ON TABLE messages IS 'All chat messages across all rooms. Supports text, media (images/videos), voice notes, and system messages. Messages are soft-deleted, never hard-deleted.';
COMMENT ON COLUMN messages.sender_id IS 'User who sent the message. NULL for system messages (e.g., "User joined the group").';
COMMENT ON COLUMN messages.content IS 'Text content of the message. NULL for media-only messages or soft-deleted messages.';
COMMENT ON COLUMN messages.message_type IS 'Type of message: "text" for text, "image"/"video"/"voice" for media, "system" for auto-generated messages by the server.';
COMMENT ON COLUMN messages.media_url IS 'CloudFront CDN URL to the media file (image, video, or voice note). Never raw S3 URL. NULL for text messages or soft-deleted messages.';
COMMENT ON COLUMN messages.media_thumb IS 'CloudFront CDN URL to a thumbnail image (for images and videos). Used for media preview in chat UI.';
COMMENT ON COLUMN messages.media_size_kb IS 'Size of the original media file in kilobytes. Displayed in the UI for user information.';
COMMENT ON COLUMN messages.reply_to_id IS 'UUID of the message this is replying to (quoted reply). NULL if this is not a reply.';
COMMENT ON COLUMN messages.is_deleted IS 'Soft delete flag. When true, content and media_url are nullified, but the row remains for reply threading and read receipt integrity.';
COMMENT ON COLUMN messages.deleted_at IS 'Timestamp when the message was soft-deleted. NULL if the message has not been deleted.';
COMMENT ON COLUMN messages.read_by IS 'Array of user UUIDs who have read this message. Updated when users emit the mark_read socket event.';
