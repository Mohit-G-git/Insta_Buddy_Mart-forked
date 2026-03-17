-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Users IAM — core user table with role + KYC status
-- Roles: requester (default), runner, admin
-- Runner accounts are restricted until kyc_verified = true (REQ-5, NFR-4)
-- ============================================================================
CREATE TABLE users_iam (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(150) UNIQUE NOT NULL,
    phone           VARCHAR(15) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'requester',
    kyc_verified    BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_role CHECK (
        role IN ('requester', 'runner', 'admin')
    )
);

COMMENT ON TABLE users_iam IS 'Core user accounts table. Runner accounts require kyc_verified = true to accept orders.';
COMMENT ON COLUMN users_iam.role IS 'User role: requester (posts shopping lists), runner (delivers), admin (manages disputes/KYC).';
COMMENT ON COLUMN users_iam.kyc_verified IS 'Set to true only after admin approves the KYC Institute ID upload.';

-- Indexes
CREATE INDEX idx_users_iam_email ON users_iam (email);
CREATE INDEX idx_users_iam_phone ON users_iam (phone);
CREATE INDEX idx_users_iam_role ON users_iam (role);
CREATE INDEX idx_users_iam_kyc ON users_iam (kyc_verified) WHERE role = 'runner';

-- ============================================================================
-- OTP Codes — stores generated OTPs for email/phone verification
-- Each OTP has a 5-minute expiry window
-- ============================================================================
CREATE TABLE otp_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users_iam(id) ON DELETE CASCADE,
    code        VARCHAR(6) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    verified    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE otp_codes IS 'Stores 6-digit OTPs with 5-minute expiry. OTPs are marked verified after successful validation.';

-- Indexes
CREATE INDEX idx_otp_user_id ON otp_codes (user_id);
CREATE INDEX idx_otp_lookup ON otp_codes (user_id, verified, expires_at DESC);

-- ============================================================================
-- KYC Documents — tracks Institute ID uploads and admin review
-- Status: pending → approved | rejected
-- S3 URL stored in document_url
-- ============================================================================
CREATE TABLE kyc_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID UNIQUE NOT NULL REFERENCES users_iam(id) ON DELETE CASCADE,
    document_url    TEXT NOT NULL,
    document_type   VARCHAR(50) NOT NULL DEFAULT 'institute_id',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by     UUID REFERENCES users_iam(id),
    review_notes    TEXT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,

    CONSTRAINT chk_kyc_status CHECK (
        status IN ('pending', 'approved', 'rejected')
    )
);

COMMENT ON TABLE kyc_documents IS 'KYC document records. One document per user (UNIQUE on user_id). S3 URL stored after upload.';
COMMENT ON COLUMN kyc_documents.document_url IS 'Full S3 URL of the uploaded Institute ID image.';
COMMENT ON COLUMN kyc_documents.status IS 'pending → admin reviews → approved (unlocks runner) or rejected (user can re-upload).';

-- Indexes
CREATE INDEX idx_kyc_user_id ON kyc_documents (user_id);
CREATE INDEX idx_kyc_status ON kyc_documents (status);
CREATE INDEX idx_kyc_pending ON kyc_documents (status) WHERE status = 'pending';
