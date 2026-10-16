-- CreateTable
CREATE TABLE "OrgRole" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgRole_userId_idx" ON "OrgRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRole_nodeId_userId_key" ON "OrgRole"("nodeId", "userId");

-- AddForeignKey
ALTER TABLE "OrgRole" ADD CONSTRAINT "OrgRole_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRole" ADD CONSTRAINT "OrgRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
