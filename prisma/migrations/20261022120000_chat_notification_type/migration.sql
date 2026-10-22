-- A new enum value cannot be used in the same transaction that adds it, so the
-- tables and the settings update that use CHAT are in the next migration.
ALTER TYPE "NotificationType" ADD VALUE 'CHAT';
