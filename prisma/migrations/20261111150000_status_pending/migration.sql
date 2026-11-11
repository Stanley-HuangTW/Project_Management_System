-- 每個看板的 Status 欄都要有「Pending」(暫停)這個狀態。
-- 預設狀態表(新看板)已經有了;這裡補上已經存在的看板。已經有叫 Pending 的(不分大小寫)就不重複加。
UPDATE "Column"
SET "options" = jsonb_set(
  "options"::jsonb,
  '{statuses}',
  ("options"::jsonb -> 'statuses') || '[{"id":"pending","color":"#c4c4c4","label":"Pending"}]'::jsonb
)
WHERE "type" = 'STATUS'
  AND "name" = 'Status'
  AND jsonb_typeof("options"::jsonb -> 'statuses') = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements("options"::jsonb -> 'statuses') AS s
    WHERE lower(s ->> 'label') = 'pending'
  );

-- 報表以這個 Status 欄統計的看板:Pending 歸在「暫停」(沒歸過任何一類才放)。
UPDATE "Board" b
SET "reportPausedOptionIds" = array_append(b."reportPausedOptionIds", 'pending')
FROM "Column" c
WHERE c."id" = b."reportStatusColumnId"
  AND c."options"::jsonb -> 'statuses' @> '[{"id":"pending"}]'::jsonb
  AND NOT ('pending' = ANY (b."reportNotStartedOptionIds"))
  AND NOT ('pending' = ANY (b."reportPlannedOptionIds"))
  AND NOT ('pending' = ANY (b."reportPausedOptionIds"))
  AND NOT ('pending' = ANY (b."reportStuckOptionIds"))
  AND NOT ('pending' = ANY (b."reportDoneOptionIds"));
