-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventName" ADD VALUE 'DEMO_PRODUCT_VIEWED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_TRYON_BODY_SELECTED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_TRYON_PHOTO_REQUESTED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_FIT_SUBMITTED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_STYLE_RECOMMENDATION_VIEWED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_COLOR_COMBO_VIEWED';
ALTER TYPE "EventName" ADD VALUE 'DEMO_AUDIT_VIEWED';
