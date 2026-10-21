-- A new enum value cannot be used in the same transaction that adds it, so the
-- columns and the settings update that use DEADLINE are in the next migration.
ALTER TYPE "NotificationType" ADD VALUE 'DEADLINE';
