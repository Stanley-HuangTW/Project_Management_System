import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, utimes } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { listBackups, cleanupOldBackups } from "./dbBackup";

describe("listBackups / cleanupOldBackups", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dbbackup-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("沒有這個目錄時回傳空陣列,不丟錯", async () => {
    const result = await listBackups(path.join(dir, "does-not-exist"));
    expect(result).toEqual([]);
  });

  it("同一個時間戳記的資料庫檔跟附件檔會配成一組", async () => {
    await writeFile(path.join(dir, "hrapp_db_2026-10-01_030000.sql.gz"), "db");
    await writeFile(path.join(dir, "uploads_2026-10-01_030000.tgz"), "uploads");

    const result = await listBackups(dir);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe("2026-10-01_030000");
    expect(result[0].uploadsFile).not.toBeNull();
  });

  it("只有資料庫檔、沒有附件檔也列得出來", async () => {
    await writeFile(path.join(dir, "hrapp_db_2026-10-01_030000.sql.gz"), "db");

    const result = await listBackups(dir);
    expect(result).toHaveLength(1);
    expect(result[0].uploadsFile).toBeNull();
    expect(result[0].uploadsSize).toBeNull();
  });

  it("依時間戳記新到舊排序", async () => {
    await writeFile(path.join(dir, "hrapp_db_2026-09-01_030000.sql.gz"), "db");
    await writeFile(path.join(dir, "hrapp_db_2026-10-01_030000.sql.gz"), "db");

    const result = await listBackups(dir);
    expect(result.map((r) => r.timestamp)).toEqual(["2026-10-01_030000", "2026-09-01_030000"]);
  });

  it("不認得的檔名不會被當成備份列出來", async () => {
    await writeFile(path.join(dir, "readme.txt"), "not a backup");
    const result = await listBackups(dir);
    expect(result).toEqual([]);
  });

  it("保留天數內的備份不會被清掉", async () => {
    const file = path.join(dir, "hrapp_db_2026-10-01_030000.sql.gz");
    await writeFile(file, "db");

    await cleanupOldBackups(60, dir);

    const result = await listBackups(dir);
    expect(result).toHaveLength(1);
  });

  it("超過保留天數的備份會被刪除", async () => {
    const file = path.join(dir, "hrapp_db_2020-01-01_030000.sql.gz");
    await writeFile(file, "db");
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await utimes(file, old, old);

    await cleanupOldBackups(60, dir);

    const result = await listBackups(dir);
    expect(result).toEqual([]);
  });

  it("不是備份格式的檔案,保留天數清除不會動到它", async () => {
    const file = path.join(dir, "readme.txt");
    await writeFile(file, "keep me");
    const old = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000);
    await utimes(file, old, old);

    await cleanupOldBackups(1, dir);

    const { readdir } = await import("fs/promises");
    expect(await readdir(dir)).toContain("readme.txt");
  });
});
