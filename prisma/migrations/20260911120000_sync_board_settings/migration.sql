-- 階層顏色/計算方式/甘特圖顏色/Pred 燈號 are app-wide settings, kept as a copy on
-- every board so the views that already load a board can read them without a
-- second query. The broadcast that maintains those copies (setLevelColors and
-- friends) only reaches boards that existed when an admin pressed 儲存 — a
-- board created afterwards kept the schema defaults, so it showed none of the
-- 階層顏色 and, worse, computed 天數 as 日曆天 while the rest of the system was
-- set to 工作天.
--
-- createBoard now seeds these from SystemSettings. This brings the boards that
-- were already created before that fix back in line; boards that are already
-- correct are unaffected.
UPDATE "Board" b
SET "levelColors"          = s."levelColors",
    "ganttDurationMode"    = s."ganttDurationMode",
    "ganttOverdueColor"    = s."ganttOverdueColor",
    "ganttCompletedColor"  = s."ganttCompletedColor",
    "ganttInProgressColor" = s."ganttInProgressColor",
    "predReadyColor"       = s."predReadyColor",
    "predWaitingColor"     = s."predWaitingColor",
    "predBlockedColor"     = s."predBlockedColor"
FROM "SystemSettings" s
WHERE s."id" = 'global';
