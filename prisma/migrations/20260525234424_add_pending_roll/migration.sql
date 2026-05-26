-- CreateTable
CREATE TABLE "PendingRoll" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "d20" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingRoll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingRoll_requestId_key" ON "PendingRoll"("requestId");

-- CreateIndex
CREATE INDEX "PendingRoll_gameId_idx" ON "PendingRoll"("gameId");

-- AddForeignKey
ALTER TABLE "PendingRoll" ADD CONSTRAINT "PendingRoll_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
