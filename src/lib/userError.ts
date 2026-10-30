import { STALE_BUILD_MESSAGE, isStaleBuildError } from "@/lib/staleBuild";

/**
 * 預期會發生、要讓使用者看懂原因的錯誤(權限不足、欄位不合法、找不到……)。
 *
 * production 的 Next.js 會把 Server Action 丟出的錯誤洗成一句英文通用訊息
 * (React 的 Minified error #441),只留一個 `digest` 送到瀏覽器;而 Next 對已經帶 digest
 * 的錯誤會原封不動沿用(create-error-handler.js)。所以這類錯誤改丟 UserError,把中文原因
 * 放進 digest,畫面用 actionErrorMessage() 取出來。
 *
 * 非預期的錯誤(資料庫、程式 bug)繼續丟一般的 Error,細節不會送到瀏覽器。
 * 如果哪天 Next 不再沿用 digest,後果只是回到「顯示通用訊息」,不會壞掉別的東西。
 */
export const USER_ERROR_DIGEST_PREFIX = "USER_ERROR:";

export class UserError extends Error {
  readonly digest: string;

  constructor(message: string) {
    super(message);
    this.name = "UserError";
    this.digest = USER_ERROR_DIGEST_PREFIX + message;
  }
}

/** 從 UserError(包含跨過 server → client 之後只剩 digest 的那種)取出中文原因;不是的回 null。 */
export function userErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith(USER_ERROR_DIGEST_PREFIX)) return null;
  return digest.slice(USER_ERROR_DIGEST_PREFIX.length) || null;
}

/**
 * catch 到 Server Action 的錯誤時,要顯示給使用者的那句話:
 * UserError 的原因 → 「頁面是舊版」的說明 → production 被洗過的通用訊息換成 fallback → 其他錯誤的 message。
 */
export function actionErrorMessage(error: unknown, fallback: string): string {
  const reason = userErrorMessage(error);
  if (reason) return reason;
  if (isStaleBuildError(error)) return STALE_BUILD_MESSAGE;
  const masked = typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string";
  if (masked && process.env.NODE_ENV === "production") return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}
