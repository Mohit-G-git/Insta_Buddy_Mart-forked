-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Orders — core order table for shopping requests (REQ-1, REQ-2)
-- Status lifecycle: CREATED → ACCEPTED → SHOPPING → BILL_UPLOADED → DELIVERED
-- Cancellation can occur from CREATED or ACCEPTED states
-- ============================================================================
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id        UUID NOT NULL,
    store_name          VARCHAR(200) NOT NULL,
    delivery_address    TEXT NOT NULL,

    -- Geolocation for distance-based delivery fee calculation (REQ-2)
    requester_lat       DOUBLE PRECISION NOT NULL,
    requester_lng       DOUBLE PRECISION NOT NULL,
    store_lat           DOUBLE PRECISION NOT NULL,
    store_lng           DOUBLE PRECISION NOT NULL,

    -- Financial fields
    estimated_cost      DECIMAL(10, 2) NOT NULL,
    delivery_fee        DECIMAL(10, 2) NOT NULL,
    total_auth_amount   DECIMAL(10, 2) NOT NULL,
    distance_km         DECIMAL(6, 2) NOT NULL,

    -- Order state
    status              VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    runner_id           UUID,
    notes               TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_order_status CHECK (
        status IN ('CREATED', 'ACCEPTED', 'SHOPPING', 'BILL_UPLOADED', 'DELIVERED', 'CANCELLED')
    ),
    CONSTRAINT chk_estimated_cost_positive CHECK (estimated_cost > 0),
    CONSTRAINT chk_delivery_fee_floor CHECK (delivery_fee >= 30)
);

COMMENT ON TABLE orders IS 'Shopping request orders. Each order has a requester, store, items, and calculated delivery fee.';
COMMENT ON COLUMN orders.requester_id IS 'UUID of the user who created the request (from IAM Service).';
COMMENT ON COLUMN orders.total_auth_amount IS 'Pre-authorized amount: (estimated_cost * 1.15) + delivery_fee (REQ-3).';
COMMENT ON COLUMN orders.delivery_fee IS 'Auto-calculated delivery fee based on distance, enforced minimum ₹30 floor (REQ-2).';
COMMENT ON COLUMN orders.distance_km IS 'Haversine distance between requester and store in kilometers.';

-- Indexes
CREATE INDEX idx_orders_requester ON orders (requester_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_runner ON orders (runner_id) WHERE runner_id IS NOT NULL;
CREATE INDEX idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX idx_orders_location ON orders (store_lat, store_lng);

-- ============================================================================
-- Order Items — individual items in a shopping list (REQ-1)
-- Supports free-text items and optional image URLs for handwritten lists
-- ============================================================================
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_name       VARCHAR(300) NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    estimated_price DECIMAL(10, 2),
    image_url       TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_quantity_positive CHECK (quantity > 0)
);

COMMENT ON TABLE order_items IS 'Shopping list line items. Supports free-text names and optional image uploads (REQ-1).';
COMMENT ON COLUMN order_items.image_url IS 'Optional S3 URL for photographed/handwritten item list.';

-- Indexes
CREATE INDEX idx_order_items_order ON order_items (order_id);
