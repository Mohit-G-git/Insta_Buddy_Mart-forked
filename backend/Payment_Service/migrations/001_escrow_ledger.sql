-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Escrow Ledger
-- Holds every payment authorization with item cost breakdown
-- ============================================================================
CREATE TABLE escrow_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL,
    payer_user_id   UUID NOT NULL,
    payee_user_id   UUID,                                   -- helper who will receive payout

    -- Amount breakdown
    item_cost       NUMERIC(10,2) NOT NULL,                 -- original item cost
    buffer_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,       -- 15% buffer on item_cost
    platform_fee    NUMERIC(10,2) NOT NULL DEFAULT 0,       -- service fee
    total_authorized NUMERIC(10,2) NOT NULL,                -- (item_cost * 1.15) + platform_fee
    currency        VARCHAR(3) NOT NULL DEFAULT 'INR',

    -- Razorpay fields
    razorpay_order_id   VARCHAR(255) UNIQUE,
    razorpay_payment_id VARCHAR(255),
    razorpay_signature  VARCHAR(255),

    -- Lifecycle
    status          VARCHAR(20) NOT NULL DEFAULT 'created',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    authorized_at   TIMESTAMPTZ,
    captured_at     TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    refunded_at     TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,

    metadata        JSONB DEFAULT '{}',

    -- Constraints
    CONSTRAINT chk_status CHECK (
        status IN ('created', 'authorized', 'captured', 'released', 'refunded', 'partially_refunded', 'failed')
    ),
    CONSTRAINT chk_total_positive CHECK (total_authorized > 0),
    CONSTRAINT chk_item_cost_positive CHECK (item_cost > 0)
);

COMMENT ON TABLE escrow_ledger IS 'Every payment authorization in the system. One row per order.';
COMMENT ON COLUMN escrow_ledger.order_id IS 'FK to the order in the Order Service (not enforced here — cross-service reference).';
COMMENT ON COLUMN escrow_ledger.buffer_amount IS '15% markup on item_cost to cover price fluctuations.';
COMMENT ON COLUMN escrow_ledger.total_authorized IS 'Formula: (item_cost * 1.15) + platform_fee.';
COMMENT ON COLUMN escrow_ledger.status IS 'created → authorized → captured → released | refunded | partially_refunded. Can also go to failed.';

-- Indexes
CREATE INDEX idx_escrow_order_id ON escrow_ledger (order_id);
CREATE INDEX idx_escrow_payer ON escrow_ledger (payer_user_id);
CREATE INDEX idx_escrow_payee ON escrow_ledger (payee_user_id);
CREATE INDEX idx_escrow_status ON escrow_ledger (status);
CREATE INDEX idx_escrow_razorpay_order ON escrow_ledger (razorpay_order_id);
CREATE INDEX idx_escrow_created_at ON escrow_ledger (created_at DESC);

-- ============================================================================
-- Payment Transactions (audit trail)
-- Every state change on an escrow record is logged here
-- ============================================================================
CREATE TABLE payment_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id       UUID NOT NULL REFERENCES escrow_ledger(id) ON DELETE CASCADE,

    type            VARCHAR(30) NOT NULL,                   -- authorization, capture, release, refund, failure
    amount          NUMERIC(10,2) NOT NULL,
    status          VARCHAR(20) NOT NULL,                   -- success, failed
    razorpay_payment_id VARCHAR(255),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_txn_type CHECK (
        type IN ('authorization', 'capture', 'release', 'refund', 'failure')
    ),
    CONSTRAINT chk_txn_status CHECK (
        status IN ('success', 'failed')
    )
);

COMMENT ON TABLE payment_transactions IS 'Audit trail for every payment state transition.';

CREATE INDEX idx_txn_escrow_id ON payment_transactions (escrow_id);
CREATE INDEX idx_txn_created_at ON payment_transactions (created_at DESC);
