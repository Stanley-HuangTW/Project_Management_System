import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, readdir, rm, stat, unlink } from "fs/promises";
import { createGunzip, createGzip } from "zlib";
import path from "path";

/**
 * 資料庫/附件的備份與還原——直接對 db:5432 跑 pg_dump/psql(見
 * Dockerfile 的 postgresql16-client),不透過 Docker socket。
 *
 * 檔名沿用 scripts/backup-db.sh 的格式(<dbname>_<timestamp>.sql.gz、
 * uploads_<timestamp>.tgz),寫進同一個 backups/ 資料夾——那支腳本排程
 * 產生的備份,跟這裡新產生的備份,彼此都看得懂對方的檔案。
 */

const execFileAsync = promisify(execFile);

export const BACKUP_DIR = path.join(process.cwd(), "backups");
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

type DbConnection = { host: string; port: string; user: string; password: string; database: string };

function dbConnection(): DbConnection {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL 未設定");
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 把 pg_dump 的輸出經 gzip 串流直接寫檔——不假設系統裝了 gzip 執行檔。 */
async function dumpDatabase(conn: DbConnection, destFile: string): Promise<void> {
  const child = spawn(
    "pg_dump",
    ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.database, "--no-owner"],
    { env: { ...process.env, PGPASSWORD: conn.password } }
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  const exitCode = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  try {
    await pipeline(child.stdout, createGzip(), createWriteStream(destFile));
  } catch (err) {
    await unlink(destFile).catch(() => {});
    throw err;
  }
  const code = await exitCode;
  if (code !== 0) {
    await unlink(destFile).catch(() => {});
    throw new Error(`pg_dump 失敗(code ${code}):${stderr.trim()}`);
  }
}

/** 把一份 .sql.gz 灌回資料庫。ON_ERROR_STOP 讓還原途中真的出錯時整個
 *  失敗,而不是悄悄跳過幾行、留一個看起來成功但其實資料不完整的結果。
 *
 *  還原的目標是still在跑、已經有資料的正式資料庫,不是全新空庫——pg_dump
 *  (這裡跟 scripts/backup-db.sh)都沒加 --clean,檔案裡只有 CREATE 沒有
 *  DROP,直接灌會撞到現有的 table/type 整個失敗。所以先整個清空 public
 *  schema 再灌,讓還原在「空庫」跟「正在跑的庫」都一樣能成功。 */
async function restoreDatabase(conn: DbConnection, srcGzFile: string): Promise<void> {
  await execFileAsync(
    "psql",
    [
      "-h",
      conn.host,
      "-p",
      conn.port,
      "-U",
      conn.user,
      "-d",
      conn.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    ],
    { env: { ...process.env, PGPASSWORD: conn.password } }
  );

  const child = spawn(
    "psql",
    ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.database, "-v", "ON_ERROR_STOP=1"],
    { env: { ...process.env, PGPASSWORD: conn.password } }
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  const exitCode = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await pipeline(createReadStream(srcGzFile), createGunzip(), child.stdin);
  const code = await exitCode;
  if (code !== 0) throw new Error(`psql 還原失敗(code ${code}):${stderr.trim()}`);
}

export type BackupResult = { timestamp: string; dbFile: string; uploadsFile: string };

/** 備份資料庫 + 附件,寫進 backups/。 */
export async function runBackup(): Promise<BackupResult> {
  await mkdir(BACKUP_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });

  const conn = dbConnection();
  const ts = timestamp();
  const dbFile = path.join(BACKUP_DIR, `${conn.database}_${ts}.sql.gz`);
  const uploadsFile = path.join(BACKUP_DIR, `uploads_${ts}.tgz`);

  await dumpDatabase(conn, dbFile);
  // 附件目錄可能是空的(全新安裝)——tar 對空目錄一樣能打出一個有效的小檔案。
  await execFileAsync("tar", ["czf", uploadsFile, "-C", UPLOADS_DIR, "."]);

  return { timestamp: ts, dbFile, uploadsFile };
}

export type BackupFile = {
  timestamp: string;
  dbFile: string;
  dbSize: number;
  dbCreatedAt: Date;
  uploadsFile: string | null;
  uploadsSize: number | null;
};

const DB_FILE_RE = /^.+_(\d{4}-\d{2}-\d{2}_\d{6})\.sql\.gz$/;
const UPLOADS_FILE_RE = /^uploads_(\d{4}-\d{2}-\d{2}_\d{6})\.tgz$/;

/** 列出 backups/ 底下的備份,依時間戳記把資料庫檔跟附件檔配成一組——兩邊
 *  都是 runBackup 同時產生的,共用同一個時間戳記。dir 參數只為了方便測試
 *  指到一個暫存目錄,正式呼叫一律用預設的 BACKUP_DIR。 */
export async function listBackups(dir: string = BACKUP_DIR): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const uploadsByTimestamp = new Map<string, string>();
  for (const name of names) {
    const m = name.match(UPLOADS_FILE_RE);
    if (m) uploadsByTimestamp.set(m[1], name);
  }

  const result: BackupFile[] = [];
  for (const name of names) {
    const m = name.match(DB_FILE_RE);
    if (!m) continue;
    const ts = m[1];
    const dbFile = path.join(dir, name);
    const dbStat = await stat(dbFile);
    const uploadsName = uploadsByTimestamp.get(ts);
    const uploadsFile = uploadsName ? path.join(dir, uploadsName) : null;
    const uploadsStat = uploadsFile ? await stat(uploadsFile) : null;
    result.push({
      timestamp: ts,
      dbFile,
      dbSize: dbStat.size,
      dbCreatedAt: dbStat.mtime,
      uploadsFile,
      uploadsSize: uploadsStat?.size ?? null,
    });
  }

  result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return result;
}

/** 刪除超過保留天數的備份檔——只刪認得出格式的備份檔,不是整個資料夾淨空。 */
export async function cleanupOldBackups(retentionDays: number, dir: string = BACKUP_DIR): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of names) {
    if (!DB_FILE_RE.test(name) && !UPLOADS_FILE_RE.test(name)) continue;
    const file = path.join(dir, name);
    const fileStat = await stat(file);
    if (fileStat.mtime.getTime() < cutoff) await unlink(file);
  }
}

export type RestoreResult = { preRestoreBackup: BackupResult };

/**
 * 把資料庫(+ 選填的附件)還原成指定備份的樣子。
 *
 * 還原前一定先自己存一份「還原前」的快照——這是內建的安全網,不是可選項目:
 * 就算選錯備份、或還原後發現不對,還是救得回來。
 */
export async function restoreFromFiles(dbGzFile: string, uploadsTgzFile: string | null): Promise<RestoreResult> {
  const preRestoreBackup = await runBackup();

  const conn = dbConnection();
  await restoreDatabase(conn, dbGzFile);

  if (uploadsTgzFile) {
    // 還原是「回到那個時間點」,不是合併——留著當下的檔案只會留下對不到
    // 資料庫紀錄的孤兒檔案。UPLOADS_DIR 本身是 volume 掛載點,刪不掉
    // (EBUSY),只能清空裡面的內容。
    await mkdir(UPLOADS_DIR, { recursive: true });
    const entries = await readdir(UPLOADS_DIR);
    await Promise.all(entries.map((name) => rm(path.join(UPLOADS_DIR, name), { recursive: true, force: true })));
    await execFileAsync("tar", ["xzf", uploadsTgzFile, "-C", UPLOADS_DIR]);
  }

  return { preRestoreBackup };
}
