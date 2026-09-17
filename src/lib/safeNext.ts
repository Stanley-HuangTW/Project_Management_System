/**
 * 登入後(或任何一次轉回來)要去哪裡。
 *
 * 只收本站的絕對路徑。少了這一關,`?next=https://evil.com` 就變成一個掛在
 * 登入頁上的轉址器 —— 使用者看到的是自家網域的登入畫面,輸入完密碼之後被
 * 送去別人家,而網址列上的來源確實是這個站。
 *
 * 放在自己的檔案裡是因為 auth.ts 是 "use server":那種檔案的每一個 export
 * 都會變成 Server Action,同步函式匯出不了,也就測不到。這一支是擋開放轉
 * 址的閘門,測得到比放在旁邊方便重要。
 */
export function safeNextPath(raw: unknown, fallback = "/boards"): string {
  if (typeof raw !== "string" || !raw) return fallback;
  // 必須是絕對路徑。`//evil.com` 是通訊協定相對網址,瀏覽器會當成外部網站。
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // 反斜線在部分瀏覽器裡等同斜線,`/\evil.com` 會被解讀成 `//evil.com`。
  if (raw.includes("\\")) return fallback;
  // 控制字元可以用來截斷標頭。
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
