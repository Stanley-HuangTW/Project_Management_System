import { inflateRaw } from "zlib";
import { promisify } from "util";

/**
 * 讀上傳的 xlsx 之前先擋下「壓縮炸彈」:一個壓縮後只有幾 MB 的檔案,解壓縮之後可以是幾個 GB。
 * exceljs 讀檔會把整個工作表解壓縮進記憶體、再長成一大堆物件——一個這樣的檔案就能讓 Node 的 worker 記憶體耗盡、
 * 整個行程被殺掉(同一個 worker 上所有人的請求一起斷掉)。匯入功能本來就只擋了「檔案超過 20MB」,擋不住這種。
 *
 * 做兩件事,都不用把檔案整個交給 exceljs:
 *   1. 讀 zip 的中央目錄(不解壓縮),宣告的大小太大、項目太多、不認得的格式(加密、Zip64)直接拒絕;
 *   2. 宣告的大小可以造假,所以每個項目再各自解壓縮一次,但有輸出上限(maxOutputLength),超過就停——
 *      真正的內容有多大,在這裡就知道了,而且最多只佔用一個項目的上限那麼多記憶體。
 * 正常的試算表(幾千列)解壓縮之後也只有幾 MB,遠低於上限。
 */
export const XLSX_LIMITS = {
  /** 壓縮檔裡最多幾個項目(一般的 xlsx 不到 30 個)。 */
  maxEntries: 2000,
  /** 單一項目解壓縮之後最大(一般是工作表 XML;一萬列大約 1–3MB)。 */
  maxEntryBytes: 50 * 1024 * 1024,
  /** 全部加起來解壓縮之後最大。 */
  maxTotalBytes: 100 * 1024 * 1024,
};

const inflate = promisify(inflateRaw);
const BAD_FILE = "這不是有效的 Excel 檔案(.xlsx)";

/** 檔案安全就回 null,否則回要告訴使用者的原因。 */
export async function xlsxProblem(buffer: Uint8Array, limits = XLSX_LIMITS): Promise<string | null> {
  const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.length < 22) return BAD_FILE;

  // 1. 找 zip 結尾的目錄記錄(EOCD),從檔尾往前找(後面可以有最多 64KB 的註解)。
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return BAD_FILE;
  const entryCount = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return "這個壓縮檔用了不支援的格式(Zip64),一般的 Excel 不會這樣,請確認檔案";
  if (entryCount > limits.maxEntries) return `這個檔案裡的項目太多了(${entryCount} 個),一般的 Excel 不會這樣,請確認檔案`;
  if (dirOffset + dirSize > buf.length) return BAD_FILE;

  // 2. 逐項讀中央目錄:宣告的大小與格式。
  type Entry = { method: number; compressed: number; declared: number; localOffset: number };
  const entries: Entry[] = [];
  let pos = dirOffset;
  let declaredTotal = 0;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return BAD_FILE;
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressed = buf.readUInt32LE(pos + 20);
    const declared = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (compressed === 0xffffffff || declared === 0xffffffff || localOffset === 0xffffffff) return "這個壓縮檔用了不支援的格式(Zip64),一般的 Excel 不會這樣,請確認檔案";
    if (flags & 1) return "這個檔案有加密,讀不了";
    if (name.endsWith("/")) continue; // 資料夾
    if (declared > limits.maxEntryBytes) return explode(declared, limits);
    declaredTotal += declared;
    if (declaredTotal > limits.maxTotalBytes) return explode(declaredTotal, limits);
    entries.push({ method, compressed, declared, localOffset });
  }

  // 3. 宣告的大小可以造假:真的解壓縮一次(有輸出上限),看實際有多大。
  let actualTotal = 0;
  for (const e of entries) {
    if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== 0x04034b50) return BAD_FILE;
    const dataStart = e.localOffset + 30 + buf.readUInt16LE(e.localOffset + 26) + buf.readUInt16LE(e.localOffset + 28);
    if (dataStart + e.compressed > buf.length) return BAD_FILE;
    const data = buf.subarray(dataStart, dataStart + e.compressed);
    let size: number;
    if (e.method === 0) size = e.compressed;
    else if (e.method === 8) {
      try {
        size = (await inflate(data, { maxOutputLength: Math.min(limits.maxEntryBytes, limits.maxTotalBytes - actualTotal) + 1 })).length;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError ? explode(limits.maxEntryBytes + 1, limits) : BAD_FILE;
      }
    } else return "這個壓縮檔用了不支援的壓縮方式,請確認檔案";
    if (size > limits.maxEntryBytes) return explode(size, limits);
    actualTotal += size;
    if (actualTotal > limits.maxTotalBytes) return explode(actualTotal, limits);
  }
  return null;
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)}`;
const explode = (size: number, limits: typeof XLSX_LIMITS) =>
  `這個檔案解壓縮之後太大了(超過 ${mb(Math.min(size, limits.maxEntryBytes))}MB,上限是單一項目 ${mb(limits.maxEntryBytes)}MB、合計 ${mb(limits.maxTotalBytes)}MB),可能不是正常的試算表。請確認檔案,或把資料分成幾個檔案匯入`;

/** 載入 xlsx 之前呼叫;不安全就丟出帶中文原因的 Error。 */
export async function assertSafeXlsx(buffer: Uint8Array): Promise<void> {
  const problem = await xlsxProblem(buffer);
  if (problem) throw new Error(problem);
}
