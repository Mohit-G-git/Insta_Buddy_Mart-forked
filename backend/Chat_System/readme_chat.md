# BuddyUp Chat System — Complete Technical README
> **For AI Copilot Use:** This document contains the full specification, architecture, database schema, API contracts, and business logic for the BuddyUp real-time chat system. Use this as the single source of truth to generate, review, and extend all chat-related backend code.

---

## 1. Project Context

**BuddyUp** is a location-first social platform that matches people for real-world offline events and activities in Mumbai, India. The chat system is a **Phase 2 feature** that activates after users have been matched through events.

### Why Chat Exists in This App
- Chat is NOT a standalone messenger. It is **event-driven**.
- When a user's join request to an event is **accepted**, a chat room is **automatically created** between the event creator and the joiner.
- For **group events** (max_participants > 2), a group chat room is created and all accepted participants are automatically added.
- Users can also initiate **direct (1:1) chats** with their accepted connections (LinkedIn-style connections).
- Chat is a trust-building mechanism — it enables coordination before the offline meetup happens.

### Core Principle
> Chat rooms are created by the system automatically based on event acceptance. Users do NOT manually create chat rooms. The only exception is direct messaging between established connections.

---

## 2. Technology Stack for Chat

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Server runtime |
| Framework | Express.js | ^4.18 | REST API framework |
| Real-time | Socket.io | ^4.6 | WebSocket connections |
| Primary DB | PostgreSQL | 15 | Permanent message storage |
| Cache / Pub-Sub | Redis (ioredis) | ^5.3 | Last 50 messages, online presence, typing, pub-sub |
| File Storage | AWS S3 + CloudFront | latest SDK | Media messages (images, videos, voice notes) |
| Image Processing | Sharp | ^0.32 | Compress images before S3 upload |
| Job Queue | Bull | ^4.11 | Push notification jobs via Redis |
| Push Notifications | Firebase Admin (FCM) | ^11 | Offline push to Android + iOS |
| Auth | jsonwebtoken | ^9 | JWT verification on REST + WebSocket |
| Validation | Joi | ^17 | Input sanitization on all endpoints |
| ORM/Query | pg (node-postgres) | ^8.11 | Raw SQL with parameterized queries |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                                │
│  Flutter App (Android + iOS)                                    │
│  ├── HTTP requests  →  REST API (Express.js)                    │
│  └── WebSocket      →  Socket.io Server                         │
└────────────────────┬───────────────────────┬────────────────────┘
                     │ REST                  │ WS
┌────────────────────▼───────────────────────▼────────────────────┐
│                  NODE.JS APPLICATION SERVER                     │
│  ┌─────────────────┐    ┌──────────────────────────────────┐    │
│  │  Express.js API │    │     Socket.io Chat Handler       │    │
│  │  /api/v1/chat/* │    │  - Connection auth (JWT)         │    │
│  │  - REST routes  │    │  - join_room                     │    │
│  │  - Pagination   │    │  - send_message                  │    │
│  │  - Room mgmt    │    │  - typing_start / typing_stop    │    │
│  │  - S3 uploads   │    │  - mark_read                     │    │
│  └────────┬────────┘    └──────────────┬───────────────────┘    │
└───────────┼─────────────────────────────┼───────────────────────┘
            │                             │
┌───────────▼──────────┐     ┌────────────▼──────────────────────┐
│   PostgreSQL (RDS)   │     │         Redis (ElastiCache)        │
│  - chat_rooms        │     │  - chat:{roomId}:recent (List)     │
│  - chat_room_members │     │  - online:{userId} (String+TTL)    │
│  - messages          │     │  - typing:{roomId} (Set+TTL)       │
│  Indexed by:         │     │  - ratelimit:{userId} (Counter)    │
│  (room_id, sent_at)  │     │  - Bull job queues for FCM         │
└──────────────────────┘     └───────────────────────────────────┘
                                          │
                             ┌────────────▼──────────────────────┐
                             │    Firebase Admin SDK (FCM)        │
                             │  - Push to offline Android users   │
                             │  - Push to offline iOS users       │
                             │    (routed through APNs by FCM)    │
                             └───────────────────────────────────┘
```

### Scalability Note
- Phase 1 (0–10K users): Single Node.js process. Socket.io without adapter is fine.
- Phase 2 (10K–100K): Add `@socket.io/redis-adapter` so multiple Node.js instances share WebSocket state via Redis Pub/Sub.
- Phase 4 (500K+): Migrate messages table to Cassandra/ScyllaDB for write-heavy time-series performance.

---

## 4. Database Schema

### 4.1 Table: `chat_rooms`
```sql
CREATE TABLE chat_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES events(id) ON DELETE SET NULL,  -- NULL for direct DMs
  room_type       VARCHAR(20) NOT NULL DEFAULT 'direct',          -- 'direct' | 'group'
  room_name       VARCHAR(200),                                   -- only for group rooms, = event title
  room_photo      VARCHAR(500),                                   -- S3 URL, only for group rooms
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chatrooms_event ON chat_rooms(event_id);
CREATE INDEX idx_chatrooms_last_msg ON chat_rooms(last_message_at DESC);
```

**Business Rules:**
- `room_type = 'direct'` → always exactly 2 members, `event_id` is NULL
- `room_type = 'group'` → 2+ members, always tied to an `event_id`
- `room_name` and `room_photo` are only populated for group rooms (copy event title and cover_photo at creation time)

---

### 4.2 Table: `chat_room_members`
```sql
CREATE TABLE chat_room_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMP,                                          -- for unread count calculation
  is_active    BOOLEAN NOT NULL DEFAULT true,                      -- false = left the group (future feature)
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_members_room ON chat_room_members(room_id);
CREATE INDEX idx_members_user ON chat_room_members(user_id);
CREATE INDEX idx_members_user_active ON chat_room_members(user_id, is_active);
```

---

### 4.3 Table: `messages`
```sql
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT,                                              -- NULL for media-only messages
  message_type  VARCHAR(20) NOT NULL DEFAULT 'text',              -- 'text'|'image'|'video'|'voice'|'system'
  media_url     VARCHAR(500),                                     -- CloudFront CDN URL (NOT S3 direct)
  media_thumb   VARCHAR(500),                                     -- thumbnail URL for images/videos
  media_size_kb INTEGER,                                          -- for display in UI
  reply_to_id   UUID REFERENCES messages(id) ON DELETE SET NULL,  -- for quoted replies
  is_deleted    BOOLEAN NOT NULL DEFAULT false,
  deleted_at    TIMESTAMP,
  sent_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  read_by       UUID[] NOT NULL DEFAULT '{}'                      -- array of user_ids who have read
);

-- CRITICAL: This index is essential for paginated chat history queries
CREATE INDEX idx_messages_room_time ON messages(room_id, sent_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_reply ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
```

**Business Rules:**
- `message_type = 'system'` → auto-generated messages like `"Rahul joined the event chat"`, `sender_id` is NULL
- `content` and `media_url` cannot BOTH be NULL at the same time
- When a message is deleted (`is_deleted = true`), set `content = NULL` and `media_url = NULL`, but keep the row — the row is needed for reply threading and read receipt integrity
- `read_by` is updated by the server when a user emits `mark_read`. It is an array of UUIDs (user IDs).
- `media_url` must always be the **CloudFront CDN URL**, never the raw S3 URL

---

### 4.4 Redis Data Structures

| Key Pattern | Type | Value | TTL | Purpose |
|---|---|---|---|---|
| `online:{userId}` | String | Unix timestamp (ms) | 5 min | Online presence / last seen |
| `chat:{roomId}:recent` | List | JSON-serialized message objects | No TTL | Last 50 messages for instant load |
| `typing:{roomId}` | Set | `{userId}` strings | 8 sec | Active typers in a room |
| `ratelimit:msg:{userId}` | String | counter | 1 min | Rate limit: 60 messages per minute |
| `fcm_token:{userId}` | String | FCM device token | 30 days | Latest FCM token for push |

---

## 5. REST API Endpoints

**Base path:** `/api/v1/chat`  
**All routes require:** `Authorization: Bearer <JWT>` header  
**Auth middleware** decodes the token and sets `req.userId` (UUID of authenticated user)

---

### 5.1 `GET /rooms`
**Get all chat rooms for the authenticated user, ordered by most recent activity.**

**Response:**
```json
[
  {
    "id": "uuid",
    "room_type": "direct",
    "room_name": null,
    "room_photo": null,
    "event_id": null,
    "last_message_at": "2025-06-01T08:30:00Z",
    "last_message": {
      "content": "See you tomorrow at 6am!",
      "message_type": "text",
      "sender_id": "uuid",
      "sent_at": "2025-06-01T08:30:00Z"
    },
    "unread_count": 3,
    "other_member": {
      "id": "uuid",
      "full_name": "Priya Sharma",
      "username": "priya_runs",
      "profile_photo": "https://cdn.buddyup.in/photos/priya.jpg",
      "is_online": true
    }
  }
]
```

**SQL Logic:**
```sql
SELECT 
  cr.*,
  (
    SELECT row_to_json(m) FROM (
      SELECT content, message_type, sender_id, sent_at
      FROM messages 
      WHERE room_id = cr.id AND is_deleted = false
      ORDER BY sent_at DESC LIMIT 1
    ) m
  ) AS last_message,
  (
    SELECT COUNT(*) FROM messages
    WHERE room_id = cr.id
    AND sent_at > COALESCE(crm.last_read_at, '1970-01-01')
    AND sender_id != $userId
    AND is_deleted = false
  ) AS unread_count
FROM chat_rooms cr
JOIN chat_room_members crm ON crm.room_id = cr.id AND crm.user_id = $userId AND crm.is_active = true
ORDER BY cr.last_message_at DESC;
```

---

### 5.2 `GET /rooms/:roomId/messages?page=1&limit=50`
**Get paginated message history for a room. Page 1 = most recent messages.**

**Access Control:** Reject with 403 if `req.userId` is not in `chat_room_members` for this `roomId`.

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "room_id": "uuid",
      "sender_id": "uuid",
      "sender": {
        "full_name": "Rahul Mehta",
        "username": "rahul_m",
        "profile_photo": "https://cdn.buddyup.in/photos/rahul.jpg"
      },
      "content": "I'll bring water bottles",
      "message_type": "text",
      "media_url": null,
      "media_thumb": null,
      "reply_to_id": null,
      "reply_to": null,
      "is_deleted": false,
      "sent_at": "2025-06-01T08:25:00Z",
      "read_by": ["uuid1", "uuid2"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "has_more": true
  }
}
```

**Caching Logic:**
- If `page == 1`: Check Redis `chat:{roomId}:recent`. If populated (length > 0), return from cache (parse JSON, reverse for chronological order, include sender details from a secondary lookup or join).
- If cache miss or `page > 1`: Query PostgreSQL with OFFSET pagination.
- Update `last_read_at` in `chat_room_members` for `req.userId` when fetching page 1.

---

### 5.3 `POST /rooms/:roomId/media`
**Upload an image or video to a chat room. Returns a pre-signed URL or directly uploads to S3.**

**Request:** `multipart/form-data`
```
file: <binary>
message_type: "image" | "video" | "voice"
reply_to_id: "uuid" (optional)
```

**Processing Pipeline:**
1. Validate file: image max 10MB, video max 100MB, voice max 5MB
2. Validate `req.userId` is a member of `roomId`
3. If image: use `sharp` to compress and resize to max 1200px width, generate 300px thumbnail
4. Upload original (or compressed) to `s3://buddyup-media/chat/{roomId}/{uuid}.{ext}`
5. Upload thumbnail to `s3://buddyup-media/chat/{roomId}/thumb_{uuid}.jpg`
6. Construct CloudFront URLs: `https://cdn.buddyup.in/chat/{roomId}/{filename}`
7. Insert message row into `messages` table
8. Emit `new_message` via Socket.io to all room members
9. Push to Redis recent cache
10. Return the saved message object

**Response:** `201 Created` — same message object shape as in `GET /messages`

---

### 5.4 `POST /rooms/direct`
**Create or retrieve an existing direct chat room between two connected users.**

**Request Body:**
```json
{ "target_user_id": "uuid" }
```

**Business Rules:**
- Both users must have an `accepted` connection in the `connections` table. Return 403 if not connected.
- If a direct room already exists between these two users, return the existing room (do NOT create a duplicate).
- Use `UPSERT` logic: query for existing direct room first, create only if none exists.

**SQL to find existing direct room:**
```sql
SELECT cr.id FROM chat_rooms cr
JOIN chat_room_members m1 ON m1.room_id = cr.id AND m1.user_id = $myUserId
JOIN chat_room_members m2 ON m2.room_id = cr.id AND m2.user_id = $targetUserId
WHERE cr.room_type = 'direct'
LIMIT 1;
```

**Response:** `200 OK` with existing room, or `201 Created` with new room.

---

### 5.5 `DELETE /rooms/:roomId/messages/:messageId`
**Soft-delete a message. Only the sender can delete their own message.**

**Business Rules:**
- Set `is_deleted = true`, `content = NULL`, `media_url = NULL`, `deleted_at = NOW()`
- Do NOT delete the database row
- Emit `message_deleted` Socket.io event to all room members with `{ messageId, roomId }`
- Remove from Redis cache by re-fetching and re-caching the last 50 non-deleted messages

**Response:** `200 OK` `{ "message": "Message deleted" }`

---

### 5.6 `GET /rooms/:roomId/members`
**Get all members of a chat room (for group chat UI — showing participants).**

**Response:**
```json
[
  {
    "user_id": "uuid",
    "full_name": "Priya Sharma",
    "username": "priya_runs",
    "profile_photo": "https://cdn.buddyup.in/...",
    "is_online": true,
    "last_read_at": "2025-06-01T08:00:00Z",
    "joined_at": "2025-05-30T10:00:00Z"
  }
]
```

---

## 6. WebSocket API (Socket.io Events)

### Connection & Authentication

**Client connects with JWT in auth header:**
```javascript
// Client-side (Flutter via socket_io_client)
socket = io('https://api.buddyup.in', {
  auth: { token: 'Bearer <jwt>' }
});
```

**Server-side middleware — validates JWT on every connection:**
```javascript
io.use((socket, next) => {
  const token = socket.handshake.auth?.token?.replace('Bearer ', '');
  if (!token) return next(new Error('AUTH_REQUIRED'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('INVALID_TOKEN'));
  }
});
```

On connection: set `online:{userId}` in Redis with 5-minute TTL. Refresh TTL on every emit from this socket.

---

### Events Reference Table

| Direction | Event Name | Payload | Description |
|---|---|---|---|
| Client → Server | `join_room` | `{ roomId: string }` | Subscribe to real-time updates for a room |
| Client → Server | `leave_room` | `{ roomId: string }` | Unsubscribe from a room |
| Client → Server | `send_message` | `{ roomId, content, type, mediaUrl?, replyToId? }` | Send a text or media message |
| Client → Server | `typing_start` | `{ roomId: string }` | User started typing |
| Client → Server | `typing_stop` | `{ roomId: string }` | User stopped typing |
| Client → Server | `mark_read` | `{ roomId: string }` | User has read all messages up to now |
| Server → Client | `new_message` | Full message object (see schema below) | A new message arrived in a room |
| Server → Client | `message_deleted` | `{ messageId, roomId }` | A message was soft-deleted |
| Server → Client | `user_typing` | `{ userId, roomId }` | Someone is typing in a room |
| Server → Client | `user_stopped_typing` | `{ userId, roomId }` | Someone stopped typing |
| Server → Client | `message_read` | `{ userId, roomId, readAt }` | A user marked messages as read |
| Server → Client | `user_online` | `{ userId }` | A connected user came online |
| Server → Client | `user_offline` | `{ userId }` | A connected user went offline |
| Server → Client | `error` | `{ code, message }` | An error occurred (auth, permission, etc.) |

---

### Event Handlers — Detailed Implementation

#### `join_room`
```
1. Verify req.userId is a member of roomId (check chat_room_members table or Redis cache)
2. socket.join(roomId) — adds socket to Socket.io room
3. Optionally emit 'user_online' to room members
4. Refresh online:{userId} TTL in Redis
```

#### `send_message`
```
1. Rate limit check: Redis ratelimit:msg:{userId} — max 60 messages/minute. Reject with error if exceeded.
2. Validate payload: roomId is valid UUID, content is non-empty string (or mediaUrl provided), type is valid enum
3. Validate sender is a member of roomId
4. INSERT into messages table, get back the saved row with id and sent_at
5. JOIN user data (full_name, profile_photo) for sender to include in broadcast
6. UPDATE chat_rooms SET last_message_at = NOW() WHERE id = roomId
7. LPUSH to Redis chat:{roomId}:recent — store full JSON of message object
8. LTRIM chat:{roomId}:recent 0 49 — keep only last 50
9. io.to(roomId).emit('new_message', fullMessageObject) — broadcast to ALL in room including sender
10. Enqueue FCM push notification for offline members (Bull job queue)
```

**Message object shape broadcast on `new_message`:**
```json
{
  "id": "uuid",
  "room_id": "uuid",
  "sender_id": "uuid",
  "sender": {
    "id": "uuid",
    "full_name": "Rahul Mehta",
    "username": "rahul_m",
    "profile_photo": "https://cdn.buddyup.in/photos/rahul.jpg"
  },
  "content": "See you at the gate!",
  "message_type": "text",
  "media_url": null,
  "media_thumb": null,
  "reply_to_id": null,
  "reply_to": null,
  "is_deleted": false,
  "sent_at": "2025-06-01T08:30:00.000Z",
  "read_by": []
}
```

#### `typing_start`
```
1. Verify sender is a member of roomId
2. SADD typing:{roomId} {userId}, EXPIRE typing:{roomId} 8 — auto-clears if client crashes
3. socket.to(roomId).emit('user_typing', { userId, roomId }) — broadcast to others (not sender)
```

#### `typing_stop`
```
1. SREM typing:{roomId} {userId}
2. socket.to(roomId).emit('user_stopped_typing', { userId, roomId })
```

#### `mark_read`
```
1. UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = $roomId AND user_id = $userId
2. Update read_by array: UPDATE messages SET read_by = array_append(read_by, $userId)
   WHERE room_id = $roomId AND sent_at <= NOW() AND NOT ($userId = ANY(read_by))
3. socket.to(roomId).emit('message_read', { userId, roomId, readAt: new Date() })
```

#### `disconnect`
```
1. DEL online:{userId} from Redis
2. Record last_active_at in users table (UPDATE users SET last_active_at = NOW() WHERE id = $userId)
3. Broadcast 'user_offline' to all rooms this user was in (use socket.rooms to get room list)
```

---

## 7. Room Creation Logic (Triggered by Event Service)

Chat rooms are **never** created directly by user REST calls to the chat service. They are created by the **Event Service** as a side effect of event acceptance. The chat service exposes an internal function that the event service calls.

### Trigger 1: 1:1 Event Join Accepted
```
WHEN: event_participants status changes from 'pending' → 'accepted'
      AND event.event_type = 'one_to_one' (max_participants = 2)
DO:
  1. Create chat_rooms row: { event_id, room_type: 'group', room_name: event.title, room_photo: event.cover_photo }
  2. Insert two chat_room_members rows: event creator + accepted joiner
  3. Insert a 'system' message: "You're matched! Chat to plan your [event.title] meetup 🎉"
  4. Emit 'new_room_created' to both user sockets if online
  5. Send FCM push: "Your join request was accepted! Start chatting with [creatorName]"
```

### Trigger 2: Group Event — Each New Participant Accepted
```
WHEN: event_participants status changes to 'accepted'
      AND event.event_type = 'group'
DO:
  1. Check if a chat_rooms row already exists for this event_id
     - If NO: create chat_rooms row and add creator as first member
     - If YES: retrieve existing room
  2. Add newly accepted user to chat_room_members
  3. Insert 'system' message: "[NewUser.full_name] joined the group 👋"
  4. Emit 'new_message' with system message to all existing room members
  5. Send FCM push to new joiner: "You're in! Chat with the group for [event.title]"
```

### Trigger 3: Direct Message (User-initiated)
```
WHEN: User calls POST /api/v1/chat/rooms/direct with { target_user_id }
PRECONDITION: Both users must have an 'accepted' connection in the connections table
DO:
  1. Query for existing direct room between these two users (idempotent)
  2. If none exists: create chat_rooms { room_type: 'direct', event_id: null }
  3. Insert two chat_room_members rows
  4. Return room object
```

---

## 8. Push Notifications for Chat (FCM via Bull Queue)

When a message is sent and a room member is **offline** (not in `online:{userId}` Redis key), a Bull job is queued to send them an FCM push notification.

### Bull Queue: `chat-notifications`
```javascript
// Job payload
{
  roomId: "uuid",
  messageId: "uuid",
  senderId: "uuid",
  senderName: "Rahul Mehta",
  senderPhoto: "https://cdn.buddyup.in/...",
  content: "See you at the gate!",       // truncate to 100 chars
  messageType: "text",                    // "text" | "image" | "video" | "voice"
  roomType: "direct",                     // "direct" | "group"
  roomName: "Morning Jog - Aarey",        // null for direct chats
  recipientUserIds: ["uuid1", "uuid2"]    // offline members only
}
```

### FCM Notification Shape
```json
{
  "notification": {
    "title": "Rahul Mehta",
    "body": "See you at the gate!"
  },
  "data": {
    "type": "chat_message",
    "room_id": "uuid",
    "message_id": "uuid",
    "sender_id": "uuid",
    "click_action": "OPEN_CHAT_ROOM"
  },
  "android": {
    "notification": {
      "channel_id": "buddyup_chat",
      "priority": "high",
      "small_icon": "ic_notification"
    }
  },
  "apns": {
    "payload": {
      "aps": {
        "badge": 1,
        "sound": "default",
        "mutable-content": 1
      }
    }
  }
}
```

**For media messages:** Title = sender name, body = `"📷 Sent a photo"` / `"🎥 Sent a video"` / `"🎙️ Sent a voice message"`

---

## 9. Security & Access Control

### Authentication
- All REST endpoints and Socket.io connections require a valid JWT
- JWT contains: `{ userId: "uuid", iat, exp }`
- Access token expires in **15 minutes**. Client must use refresh token to get a new one.
- On WebSocket, verify JWT on connection. Do NOT re-verify on every event (performance) but DO verify room membership on every `join_room` and `send_message`.

### Authorization Rules
| Action | Rule |
|---|---|
| Read messages in a room | Must be an active member of that room |
| Send messages | Must be an active member of that room |
| Delete a message | Must be the `sender_id` of that message |
| Create direct room | Both users must have `accepted` connection |
| Join a room (socket) | Must be in `chat_room_members` |
| View other member's profile | Already connected as room members |

### Rate Limiting
- **REST endpoints:** 100 requests/min per authenticated user (express-rate-limit + Redis store)
- **WebSocket `send_message`:** 60 messages/min per user (Redis counter with 60s TTL)
- **Media upload:** 20 uploads/hour per user

### Input Validation (Joi schemas)
```javascript
// send_message socket event
{
  roomId: Joi.string().uuid().required(),
  content: Joi.string().max(4000).allow(null),
  type: Joi.string().valid('text', 'image', 'video', 'voice', 'system').required(),
  mediaUrl: Joi.string().uri().max(500).allow(null),
  replyToId: Joi.string().uuid().allow(null)
}

// Must satisfy: content OR mediaUrl must be present (not both null)
```

### Content Safety
- All uploaded images run through **AWS Rekognition** (`DetectModerationLabels`). If explicit content is detected (confidence > 80%), the message is deleted and the sender receives a warning.
- Users can **report** any message. 3 reports on a user trigger an admin review.
- Users can **block** another user. Blocking prevents messages in direct rooms (server should check block status on `send_message`).

---

## 10. File Structure

```
buddyup-chat-service/
│
├── src/
│   ├── config/
│   │   ├── db.js                 ← PostgreSQL pool (pg library)
│   │   ├── redis.js              ← ioredis client
│   │   └── firebase.js           ← Firebase Admin SDK init (for FCM)
│   │
│   ├── middleware/
│   │   ├── auth.js               ← JWT decode, sets req.userId
│   │   ├── rateLimiter.js        ← express-rate-limit with Redis store
│   │   └── memberCheck.js        ← verify user is room member (reusable)
│   │
│   ├── routes/
│   │   └── chat.js               ← All /api/v1/chat/* REST routes
│   │
│   ├── socket/
│   │   ├── chatHandler.js        ← All Socket.io event handlers
│   │   └── socketAuth.js         ← Socket.io JWT middleware
│   │
│   ├── services/
│   │   ├── messageService.js     ← DB operations for messages
│   │   ├── roomService.js        ← Room creation, member management
│   │   ├── mediaService.js       ← S3 upload, Sharp compression
│   │   ├── notificationService.js← FCM push + Bull queue jobs
│   │   └── presenceService.js    ← Online status, last seen (Redis)
│   │
│   ├── queues/
│   │   └── chatNotifQueue.js     ← Bull queue definition + processor
│   │
│   ├── utils/
│   │   ├── validators.js         ← Joi schemas
│   │   └── errors.js             ← Custom error classes + error handler
│   │
│   └── app.js                    ← Express + Socket.io server setup
│
├── migrations/
│   └── 001_chat_tables.sql       ← Database migration SQL
│
├── tests/
│   ├── chat.rest.test.js         ← Jest tests for REST endpoints
│   └── chat.socket.test.js       ← Socket.io integration tests
│
├── .env.example                  ← Template for environment variables
├── docker-compose.yml            ← Local Postgres + Redis
├── Dockerfile                    ← Production Docker image
└── package.json
```

---

## 11. Environment Variables

```env
# Server
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=postgresql://buddyup:password@localhost:5432/buddyup_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_32_char_minimum_secret_key_here

# AWS S3 + CloudFront
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
S3_BUCKET_NAME=buddyup-media
CLOUDFRONT_BASE_URL=https://cdn.buddyup.in

# Firebase (FCM)
FIREBASE_PROJECT_ID=buddyup-app
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@buddyup-app.iam.gserviceaccount.com

# AWS Rekognition (content moderation)
REKOGNITION_REGION=ap-south-1
MODERATION_CONFIDENCE_THRESHOLD=80
```

---

## 12. Key Business Rules Summary

> This section is a quick reference for the copilot to check business logic before implementing any feature.

1. **Chat rooms are system-created**, not user-created. The only user-created room is a direct message via `POST /rooms/direct`.
2. **Users must be connected** (accepted connection in `connections` table) to start a DM.
3. **Users must be event participants** (accepted in `event_participants`) to be in a group chat.
4. **Messages are never hard deleted** — always soft delete (`is_deleted = true`, nullify content).
5. **Media URLs in DB are always CloudFront CDN URLs**, never raw S3 URLs.
6. **System messages** (type = 'system') have `sender_id = NULL` and cannot be deleted.
7. **Unread count** = count of messages in room WHERE `sent_at > user's last_read_at` AND `sender_id != current_user`.
8. **Online status** expires automatically after 5 minutes in Redis. Client should refresh by sending a heartbeat (any event) every 2 minutes.
9. **Group chat name** = event title at the time the room is created. It does NOT update if the event title changes.
10. **Typing indicators auto-expire** in 8 seconds (Redis TTL) to handle client crashes gracefully.
11. **Blocked users** cannot send messages in direct rooms. Check `connections` table for `status = 'blocked'` before processing `send_message`.
12. **Rate limit** is per-user, not per-IP. A user with multiple devices shares the same limit.

---

## 13. Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No token provided |
| `INVALID_TOKEN` | 401 | JWT is invalid or expired |
| `NOT_MEMBER` | 403 | User is not a member of this room |
| `NOT_CONNECTED` | 403 | Users are not connected — cannot DM |
| `BLOCKED` | 403 | User is blocked |
| `MESSAGE_NOT_FOUND` | 404 | Message does not exist |
| `ROOM_NOT_FOUND` | 404 | Room does not exist |
| `NOT_OWNER` | 403 | Cannot delete another user's message |
| `RATE_LIMITED` | 429 | Too many messages — slow down |
| `INVALID_FILE_TYPE` | 400 | Unsupported media type for upload |
| `FILE_TOO_LARGE` | 400 | File exceeds size limit |
| `CONTENT_FLAGGED` | 400 | Media failed content moderation |

---

## 14. Testing Checklist

When implementing, verify these flows work end-to-end before marking any feature done:

- [ ] Two users can connect via WebSocket with valid JWT tokens
- [ ] A user with an invalid token is rejected on connection
- [ ] A user can join a room they are a member of
- [ ] A user cannot join a room they are NOT a member of
- [ ] User A sends a text message → User B receives `new_message` event in real time
- [ ] Message is saved in PostgreSQL with correct `room_id`, `sender_id`, `sent_at`
- [ ] Message is pushed to Redis `chat:{roomId}:recent` list
- [ ] `GET /rooms/:roomId/messages?page=1` returns from Redis cache on first call
- [ ] Typing indicator is received by other room members and clears after 8 seconds
- [ ] `mark_read` updates `last_read_at` in DB and broadcasts `message_read` to others
- [ ] Unread count in `GET /rooms` is accurate
- [ ] Soft delete removes content but keeps row in DB
- [ ] `message_deleted` event is broadcast to all room members
- [ ] Uploading an image compresses it and stores the CloudFront URL (not S3 URL)
- [ ] A blocked user cannot send messages to the user who blocked them
- [ ] Rate limit rejects after 60 messages in 1 minute
- [ ] System message is inserted when a new member joins a group event chat
- [ ] FCM push notification job is queued when a message is sent to an offline user

---

*This README is the authoritative specification for the BuddyUp Chat System backend. All implementation decisions should align with the business rules and architecture described here. When in doubt, refer to Section 12 (Business Rules) and Section 9 (Security).*