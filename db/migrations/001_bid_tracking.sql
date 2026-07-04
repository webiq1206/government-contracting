-- Migration: bid tracking fields
-- Adds quote_amount as a first-class column on call_cards (previously JSON-only)
-- Adds extra_fields JSONB to subcontractors for operator-configurable structured data

ALTER TABLE call_cards ADD COLUMN IF NOT EXISTS quote_amount numeric;
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}';
