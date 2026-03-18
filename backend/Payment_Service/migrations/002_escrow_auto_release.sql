-- ============================================================================
-- Migration 002: Escrow Auto-Release (REQ-9)
-- Adds locked/dispute states, auto_release_jobs table, processed_events table
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Extend escrow_ledger status enum
-- --------------------------------------------------------------------------

-- Drop old constraint and add new one with locked + dispute_raised
ALTER TABLE escrow_ledger
  DROP CONSTRAINT IF EXISTS chk_status;

ALTER TABLE escrow_ledger
  ADD CONSTRAINT chk_status CHECK (
    status IN (
      'created', 'authorized', 'captured',
      'locked', 'dispute_raised',
      'released', 'refunded', 'partially_refunded', 'failed'
    )
  );

-- --------------------------------------------------------------------------
-- 2. Add new columns to escrow_ledger for locking and auto-release tracking
-- --------------------------------------------------------------------------

ALTER TABLE escrow_ledger
  ADD COLUMN IF NOT EXISTS locked_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_delivered_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_release_due_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_release_job_id    UUID;

COMMENT ON COLUMN escrow_ledger.locked_at IS 'Timestamp when escrow was locked after OrderDelivered.';
COMMENT ON COLUMN escrow_ledger.order_delivered_at IS 'Timestamp of the original OrderDelivered event.';
COMMENT ON COLUMN escrow_ledger.auto_release_due_at IS 'Scheduled auto-release time (delivered_at + 24h).';
COMMENT ON COLUMN escrow_ledger.auto_release_job_id IS 'FK to auto_release_jobs for the pending release job.';

-- --------------------------------------------------------------------------
-- 3. Create auto_release_jobs table
-- --------------------------------------------------------------------------

CREATE TABLE auto_release_jobs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id               UUID NOT NULL REFERENCES escrow_ledger(id) ON DELETE CASCADE,
    order_id                UUID NOT NULL,

    status                  VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    due_at                  TIMESTAMPTZ NOT NULL,
    scheduled_from_event_at TIMESTAMPTZ NOT NULL,

    cancelled_reason        TEXT,
    attempts                INT NOT NULL DEFAULT 0,
    last_error              TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,

    CONSTRAINT chk_job_status CHECK (
        status IN ('scheduled', 'processing', 'completed', 'cancelled', 'skipped', 'failed')
    )
);

COMMENT ON TABLE auto_release_jobs IS 'Tracks scheduled 24h auto-release jobs for locked escrows.';

-- Index for worker polling: find due scheduled jobs
CREATE INDEX idx_auto_release_jobs_due_status
  ON auto_release_jobs (status, due_at);

-- Unique partial index: only one open job per escrow at a time
CREATE UNIQUE INDEX idx_auto_release_jobs_unique_open
  ON auto_release_jobs (escrow_id)
  WHERE status IN ('scheduled', 'processing');

-- --------------------------------------------------------------------------
-- 4. Extend payment_transactions type check
-- --------------------------------------------------------------------------

ALTER TABLE payment_transactions
  DROP CONSTRAINT IF EXISTS chk_txn_type;

ALTER TABLE payment_transactions
  ADD CONSTRAINT chk_txn_type CHECK (
    type IN (
      'authorization', 'capture', 'release', 'refund', 'failure',
      'lock', 'auto_release_scheduled', 'auto_release_cancelled',
      'auto_release', 'dispute'
    )
  );

-- --------------------------------------------------------------------------
-- 5. Create processed_events table (idempotency)
-- --------------------------------------------------------------------------

CREATE TABLE processed_events (
    event_id        UUID PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,
    order_id        UUID NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE processed_events IS 'Idempotency table — prevents duplicate event processing.';

CREATE INDEX idx_processed_events_order
  ON processed_events (order_id);
