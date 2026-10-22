-- CreateIndex
CREATE INDEX "Experience_city_priceCents_idx" ON "Experience"("city", "priceCents");

-- CreateIndex
CREATE INDEX "Experience_createdAt_idx" ON "Experience"("createdAt");
