-- Create connections table for user relationships
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending: awaiting receiver's action
    -- accepted: both users connected
    -- blocked: receiver blocked requester
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Ensure no duplicate connections (prevents A→B and B→A separately)
  UNIQUE(requester_id, receiver_id),
  
  -- Index for faster lookups
  CONSTRAINT different_users CHECK (requester_id != receiver_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_receiver ON connections(receiver_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);

COMMENT ON TABLE connections IS 'User-to-user connections (like LinkedIn connections). Required for direct messaging.';
COMMENT ON COLUMN connections.status IS 'pending: awaiting response | accepted: both connected | blocked: connection rejected/blocked';