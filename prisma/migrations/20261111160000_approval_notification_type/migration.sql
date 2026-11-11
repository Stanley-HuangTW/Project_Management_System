-- A new enum value cannot be used in the same transaction that adds it, so the
-- column and the settings update that use APPROVAL are in the next migration.
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL';
