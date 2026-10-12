-- CreateTable
CREATE TABLE "DmScope" (
    "discipline" "GroupDiscipline" NOT NULL,
    "limitItems" BOOLEAN NOT NULL DEFAULT false,
    "limitLabour" BOOLEAN NOT NULL DEFAULT false,
    "limitBudget" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DmScope_pkey" PRIMARY KEY ("discipline")
);
