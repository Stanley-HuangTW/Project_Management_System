-- CreateTable
-- Read-only REST API keys. Only the hash is stored.
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Outgoing HTTP callbacks for board events, each signed with its own secret.
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");
CREATE INDEX "Webhook_boardId_idx" ON "Webhook"("boardId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
