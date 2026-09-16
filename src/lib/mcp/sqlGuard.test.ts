import { describe, expect, it } from "vitest";
import { checkReadOnlySql, withRowLimit, MAX_ROWS } from "./sqlGuard";

const ok = (sql: string) => checkReadOnlySql(sql).ok;
const reason = (sql: string) => {
  const result = checkReadOnlySql(sql);
  return result.ok ? null : result.reason;
};

describe("checkReadOnlySql — 放行", () => {
  it("一般的 SELECT", () => {
    expect(ok('SELECT id, name FROM "Board"')).toBe(true);
  });

  it("WITH 開頭的查詢", () => {
    expect(ok('WITH t AS (SELECT 1 AS n) SELECT * FROM t')).toBe(true);
  });

  it("結尾的分號會被去掉,不算第二句", () => {
    const result = checkReadOnlySql('SELECT 1;');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toBe("SELECT 1");
  });

  it("前後空白與換行", () => {
    expect(ok('\n  SELECT\n    1\n')).toBe(true);
  });

  it("欄位名裡有寫入動詞的字首,不該被誤擋", () => {
    // deletedAt、createdAt、settings 在這個資料庫裡到處都是。
    expect(ok('SELECT "deletedAt", "createdAt" FROM "Item"')).toBe(true);
    expect(ok("SELECT deleted_at, created_at FROM item")).toBe(true);
    expect(ok("SELECT settings FROM x")).toBe(true);
  });

  it("字串內容不參與判斷", () => {
    expect(ok("SELECT 'DELETE FROM x' AS harmless")).toBe(true);
  });

  it("大小寫不影響", () => {
    expect(ok("select 1")).toBe(true);
    expect(ok("SeLeCt 1")).toBe(true);
  });
});

describe("checkReadOnlySql — 擋下", () => {
  it("空的查詢", () => {
    expect(reason("   ")).toBe("查詢不可為空");
  });

  it("寫入語句", () => {
    for (const sql of [
      'INSERT INTO "Board" (name) VALUES (1)',
      'UPDATE "Board" SET name = 1',
      'DELETE FROM "Board"',
      'DROP TABLE "Board"',
      'TRUNCATE "Board"',
      'ALTER TABLE "Board" ADD COLUMN x TEXT',
      'CREATE TABLE x (a INT)',
      'GRANT ALL ON "Board" TO public',
    ]) {
      expect(ok(sql), sql).toBe(false);
    }
  });

  it("用分號串第二句", () => {
    expect(reason('SELECT 1; DROP TABLE "Board"')).toMatch(/分號/);
  });

  it("WITH 後面接寫入 —— 開頭是 WITH,但它會改資料", () => {
    // Postgres 的 data-modifying CTE:光看開頭會放行,所以必須掃全句。
    expect(ok('WITH d AS (DELETE FROM "Board" RETURNING *) SELECT * FROM d')).toBe(false);
  });

  it("交易控制與工作階段設定", () => {
    expect(ok("BEGIN")).toBe(false);
    expect(ok("SET ROLE postgres")).toBe(false);
    expect(ok("SELECT 1 FROM x WHERE true; COMMIT")).toBe(false);
  });

  it("讀伺服器檔案系統的函式", () => {
    expect(reason("SELECT pg_read_file('/etc/passwd')")).toMatch(/檔案系統/);
    expect(ok("SELECT pg_ls_dir('/')")).toBe(false);
  });

  it("連到別的資料庫", () => {
    expect(reason("SELECT * FROM dblink('...', 'SELECT 1') AS t(x int)")).toMatch(/其他資料庫/);
  });

  it("不是 SELECT / WITH 開頭的一律擋", () => {
    expect(reason("EXPLAIN SELECT 1")).toBeTruthy();
    expect(ok("VALUES (1)")).toBe(false);
    expect(ok("TABLE \"Board\"")).toBe(false);
  });
});

describe("checkReadOnlySql — 註解與字串不能用來藏東西", () => {
  it("分號藏在行註解裡:Postgres 看不到它,我們也不該誤判成兩句", () => {
    expect(ok("SELECT 1 -- ; DROP TABLE x")).toBe(true);
  });

  it("分號藏在區塊註解裡", () => {
    expect(ok("SELECT 1 /* ; DROP TABLE x */")).toBe(true);
  });

  it("寫入動詞藏在註解裡不算數", () => {
    expect(ok("SELECT 1 -- delete everything")).toBe(true);
    expect(ok("/* update */ SELECT 1")).toBe(true);
  });

  it("字串裡的兩個單引號是一個單引號,不是字串結束", () => {
    // 錯把它當結束的話,後面的 ; 會被看成在字串外面而誤擋。
    expect(ok("SELECT 'it''s fine' AS s")).toBe(true);
  });

  it("真正在字串外面的分號還是擋", () => {
    expect(ok("SELECT 'a'; DROP TABLE x")).toBe(false);
  });

  it("沒有結尾的字串不會讓它無限跑", () => {
    expect(() => checkReadOnlySql("SELECT 'abc")).not.toThrow();
  });
});

describe("checkReadOnlySql — 失敗要往安全的方向倒", () => {
  /**
   * 這幾種寫法這裡看得懂的比 Postgres 少,所以會多擋而不是漏放。
   * 重點不是「擋得對不對」,是「不會有 Postgres 執行得到、而這裡看不到的東西」。
   */
  it("錢字號引號(dollar quoting)一律擋", () => {
    expect(ok("SELECT $$; DROP TABLE x$$")).toBe(false);
  });

  it("E 字串裡用反斜線跳脫引號,也是往擋的方向倒", () => {
    expect(ok("SELECT E'\\'; DROP TABLE x --'")).toBe(false);
  });
});

describe("withRowLimit", () => {
  it("沒有 LIMIT 就補上上限", () => {
    expect(withRowLimit("SELECT 1")).toBe(`SELECT 1 LIMIT ${MAX_ROWS}`);
  });

  it("自己寫了 LIMIT 就不動它 —— 覆蓋掉反而是把範圍放大", () => {
    expect(withRowLimit("SELECT 1 LIMIT 10")).toBe("SELECT 1 LIMIT 10");
  });

  it("LIMIT 後面有空白仍然算數", () => {
    expect(withRowLimit("SELECT 1 LIMIT 10   ")).toBe("SELECT 1 LIMIT 10   ");
  });

  it("只有出現在註解裡的 LIMIT 不算,還是要補", () => {
    expect(withRowLimit("SELECT 1 -- LIMIT 10")).toContain(`LIMIT ${MAX_ROWS}`);
  });

  it("可以指定較小的上限", () => {
    expect(withRowLimit("SELECT 1", 50)).toBe("SELECT 1 LIMIT 50");
  });
});
