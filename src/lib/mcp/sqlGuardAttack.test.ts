import { describe, expect, it } from "vitest";
import { checkReadOnlySql } from "./sqlGuard";

/**
 * 繞過嘗試。每一條都是「如果放行就是漏洞」。
 *
 * 這一組跟 sqlGuard.test.ts 的差別在立場:那邊測的是「寫對的規則有沒有照
 * 規則走」,這邊是拿實際會被試的手法來打它。安全性的東西,自己測自己寫的
 * 規則證明力不夠。
 */
const MUST_BLOCK: [string, string][] = [
  ["大小寫混寫的寫入", "SeLeCt 1; dRoP TABLE x"],
  ["關鍵字中間插註解", "SELECT 1; DR/**/OP TABLE x"],
  ["用註解包住分號再接寫入", "SELECT 1 /*;*/ ; DROP TABLE x"],
  ["換行取代空白", "SELECT 1;\nDROP TABLE x"],
  ["Tab 取代空白", "SELECT\t1;\tDELETE FROM x"],
  ["前導註解偽裝成 SELECT 開頭", "/* SELECT */ DELETE FROM x"],
  ["前導行註解 + 寫入", "   -- SELECT\n DELETE FROM x"],
  ["CTE 裡藏 UPDATE", "WITH u AS (UPDATE x SET a=1 RETURNING *) SELECT * FROM u"],
  ["CTE 裡藏 INSERT", "with i as (insert into x values (1) returning *) select * from i"],
  [
    "巢狀 CTE 裡藏 DELETE",
    "WITH a AS (WITH b AS (DELETE FROM x RETURNING *) SELECT * FROM b) SELECT * FROM a",
  ],
  ["函式寫檔", "SELECT pg_read_binary_file('/etc/passwd')"],
  ["大寫的 dblink", "SELECT * FROM DBLINK('x','SELECT 1') AS t(a int)"],
  ["COPY 匯出到檔案", "COPY (SELECT 1) TO '/tmp/x'"],
  ["SELECT INTO 建新表", 'SELECT * INTO newtable FROM "Board"'],
  ["錢字號引號藏分號", "SELECT $tag$; DROP TABLE x$tag$"],
  ["set_config 改工作階段", "SELECT set_config('role','postgres',false)"],
];

/** 這幾條是正常查詢,擋掉就是誤殺。 */
const MUST_PASS: [string, string][] = [
  ["分號在字串裡", "SELECT ';' AS s"],
  ["識別字引號裡有分號", 'SELECT 1 AS ";"'],
  ["末尾多個分號", "SELECT 1;;;"],
  ["本專案真實會用的查詢", `SELECT b.name, COUNT(i.id) FROM "Board" b LEFT JOIN "Item" i ON i."boardId" = b.id AND i."deletedAt" IS NULL WHERE b."deletedAt" IS NULL GROUP BY b.name`],
];

describe("SQL 閘門 — 繞過嘗試", () => {
  it.each(MUST_BLOCK)("擋下:%s", (_label, sql) => {
    expect(checkReadOnlySql(sql).ok).toBe(false);
  });
});

describe("SQL 閘門 — 不可誤殺", () => {
  it.each(MUST_PASS)("放行:%s", (_label, sql) => {
    const result = checkReadOnlySql(sql);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  });
});
