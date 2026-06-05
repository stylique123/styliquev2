-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventName" ADD VALUE 'WIDGET_OPENED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_CLOSED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_CTA_CLICKED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_BODY_MODEL_SELECTED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_FIT_SUBMITTED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_STYLE_VIEWED';
