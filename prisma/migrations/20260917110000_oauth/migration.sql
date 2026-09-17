-- 遠端 MCP 連接器要的 OAuth 2.1:動態註冊的用戶端、一次性授權碼、會過期
-- 的存取與更新權杖。授權碼與權杖都只存雜湊。

CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

CREATE TABLE "OAuthCode" (
    "id" TEXT NOT NULL,
    "hashedCode" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthCode_hashedCode_key" ON "OAuthCode"("hashedCode");
CREATE INDEX "OAuthCode_expiresAt_idx" ON "OAuthCode"("expiresAt");

CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "hashedAccessToken" TEXT NOT NULL,
    "hashedRefreshToken" TEXT,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthToken_hashedAccessToken_key" ON "OAuthToken"("hashedAccessToken");
CREATE UNIQUE INDEX "OAuthToken_hashedRefreshToken_key" ON "OAuthToken"("hashedRefreshToken");
CREATE INDEX "OAuthToken_userId_idx" ON "OAuthToken"("userId");
CREATE INDEX "OAuthToken_expiresAt_idx" ON "OAuthToken"("expiresAt");

ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
