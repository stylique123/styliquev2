-- Add STYLIST_TURN to UsageMetric enum (P1 — per-shop Mira chat turn metering).
-- Idempotent: PostgreSQL ALTER TYPE ... ADD VALUE IF NOT EXISTS available 9.6+.
ALTER TYPE "UsageMetric" ADD VALUE IF NOT EXISTS 'STYLIST_TURN';
