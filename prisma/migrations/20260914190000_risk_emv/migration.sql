-- 風險的金額:有了它才算得出 EMV(機率 × 金額),而 EMV 正是應變準備金該
-- 編多少的依據 —— 在此之前那個數字只能用猜的。
ALTER TABLE "RiskEntry" ADD COLUMN "costImpact" INTEGER;
ALTER TABLE "RiskEntry" ADD COLUMN "probabilityPct" INTEGER;
