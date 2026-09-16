/**
 * 唯讀 SQL 的閘門。
 *
 * 這個工具刻意繞過應用層的所有權限檢查 —— 那是它存在的理由(拿來做跨看板
 * 的統計與稽核),也正是它危險的地方。所以這裡擋的不是「語法對不對」,而是
 * 「這句話會不會改到東西、會不會一次吐出整個資料庫」。
 *
 * 採白名單:只認 SELECT 與 WITH 開頭的單一語句。黑名單擋關鍵字的做法在
 * SQL 上一向擋不乾淨 —— 註解、大小寫、字串裡的字都能繞過去 —— 而白名單
 * 的失敗方向是「把合法的查詢擋下來」,那是安全的失敗方向。
 */

export type SqlCheck = { ok: true; sql: string } | { ok: false; reason: string };

/** 一次最多回多少列。再多就不是「查詢」,是在把資料庫搬走。 */
export const MAX_ROWS = 1000;

/**
 * 去掉註解與字串內容,只留下結構。
 *
 * 判斷「有沒有第二句」「有沒有寫入動詞」時,字串與註解裡的字都不算數:
 * `SELECT 'DELETE FROM x'` 是一句無害的查詢,而 `SELECT 1 -- ; DROP` 的
 * 分號在註解裡。不把它們拿掉,兩邊都會判錯。
 */
function stripNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      // 字串/識別字整段換成一個佔位符,內容不參與判斷。
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          // SQL 用兩個引號表示一個引號,不是跳脫斜線。
          if (sql[i + 1] === quote) i += 2;
          else break;
        } else i += 1;
      }
      i += 1;
      out += quote === "'" ? "''" : '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 會改到東西的動詞。出現在語句結構裡(而不是字串裡)就拒絕。 */
const WRITE_WORDS = [
  // SELECT ... INTO newtable 會建表 —— 開頭是 SELECT,只看開頭的話完全看不出來。
  "into",
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "comment",
  "copy",
  "call",
  "do",
  "vacuum",
  "refresh",
  "reindex",
  "lock",
  "set",
  "reset",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "listen",
  "notify",
  "prepare",
  "execute",
  "deallocate",
  "discard",
  "analyze",
  "explain",
  "cluster",
  "import",
  "security",
];

export function checkReadOnlySql(raw: string): SqlCheck {
  const trimmed = raw.trim().replace(/;+\s*$/, "");
  if (!trimmed) return { ok: false, reason: "查詢不可為空" };

  const bare = stripNoise(trimmed);

  // 一次只准一句。分號在字串或註解裡不算,前面已經清掉了。
  if (bare.includes(";")) {
    return { ok: false, reason: "一次只能執行一句查詢,不允許用分號串接" };
  }

  const head = bare.trimStart().slice(0, 6).toLowerCase();
  if (!head.startsWith("select") && !head.startsWith("with")) {
    return { ok: false, reason: "只允許 SELECT 或 WITH 開頭的查詢" };
  }

  // WITH ... 之後仍然可能接 INSERT/UPDATE/DELETE(Postgres 的 data-modifying
  // CTE),所以不能只看開頭。
  // 標成 string[]:match 回傳 RegExpMatchArray | null,`?? []` 之後是聯集,
  // 對聯集呼叫 .includes 會踩到 never[] 那一支。
  const words: string[] = bare.toLowerCase().match(/[a-z_]+/g) ?? [];
  for (const word of words) {
    if (WRITE_WORDS.includes(word)) {
      return { ok: false, reason: `查詢裡不允許出現「${word}」` };
    }
  }

  // 有些函式本身就會改狀態或吃資源,而它們的名字帶底線,不會命中上面的
  // 單字清單(set_config 不等於 set)。
  const DANGEROUS_FUNCTIONS = [
    "set_config",
    "pg_sleep",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_advisory_lock",
    "pg_logical_emit_message",
    "lo_import",
    "lo_export",
    "dblink_exec",
  ];
  for (const fn of DANGEROUS_FUNCTIONS) {
    if (words.includes(fn)) {
      return { ok: false, reason: `查詢裡不允許呼叫「${fn}」` };
    }
  }

  // pg_read_file / pg_ls_dir 這類函式讀的是伺服器的檔案系統,不是資料。
  if (/\bpg_(read|ls|stat_file)/i.test(bare)) {
    return { ok: false, reason: "不允許讀取伺服器檔案系統的函式" };
  }
  // dblink / postgres_fdw 會把查詢送去別的伺服器,繞過這裡的所有限制。
  if (/\b(dblink|postgres_fdw)/i.test(bare)) {
    return { ok: false, reason: "不允許連線到其他資料庫" };
  }

  return { ok: true, sql: trimmed };
}

/**
 * 加上筆數上限。
 *
 * 已經有 LIMIT 的就不動它 —— 使用者自己寫的 LIMIT 可能比上限小,覆蓋掉
 * 反而是把範圍放大。真正超過上限的那些,靠執行端截斷。
 */
export function withRowLimit(sql: string, max = MAX_ROWS): string {
  return /\blimit\s+\d+\s*$/i.test(stripNoise(sql).trim()) ? sql : `${sql} LIMIT ${max}`;
}
