/**
 * BOM「檔案附件」欄位的小工具:檔名整理、下載時的檔案種類、大小顯示。純函式,不碰磁碟與資料庫。
 */

export const MAX_BOM_FILE_SIZE = 50 * 1024 * 1024;
/** 一格(一列的一個檔案附件欄位)最多幾個檔案。 */
export const MAX_FILES_PER_CELL = 20;

const MAX_NAME_LENGTH = 120;

/**
 * 上傳的檔名:只留最後一段(去掉路徑)、控制字元與 Windows 不允許的符號換成底線、頭尾的點與空白去掉,
 * 太長就截斷但保留副檔名。檔名會寫進磁碟路徑,也會顯示在畫面上,所以要先乾淨。
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().replace(/^\.+/, "").replace(/\.+$/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

const INLINE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 下載時的回應:PDF、圖片、純文字直接在瀏覽器裡開,其他(Office 檔、壓縮檔、SVG、HTML…)一律當下載的檔案——
 * 使用者上傳的東西不能讓瀏覽器當網頁執行(SVG、HTML 裡可以夾 script)。
 */
export function downloadHeaders(fileName: string): { contentType: string; disposition: string } {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const inline = INLINE_TYPES[ext];
  const encoded = encodeURIComponent(fileName);
  return inline
    ? { contentType: inline, disposition: `inline; filename*=UTF-8''${encoded}` }
    : { contentType: "application/octet-stream", disposition: `attachment; filename*=UTF-8''${encoded}` };
}

/** 檔案大小給人看:850 B、12.3 KB、4.5 MB。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 磁碟上的檔案路徑要在 BOM 檔案的資料夾底下:資料庫裡的 url 是自己寫的,刪檔前還是再確認一次,不信任。 */
export function isBomFileUrl(url: string): boolean {
  return /^\/uploads\/bom\/[A-Za-z0-9_-]+\/[^/\\]+$/.test(url) && !url.includes("..");
}
