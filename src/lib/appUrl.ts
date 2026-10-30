/**
 * 信件裡的連結:站內的相對路徑換成完整網址(用 APP_BASE_URL),收信的人才能直接點開。
 * 純函式,不碰資料庫與信箱。
 */
export function appUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}${path}`;
}

/** 通知信的內文:訊息後面空一行接「開啟:網址」(沒有連結就只有訊息)。 */
export function mailBody(message: string, link?: string): string {
  return link ? `${message}\n\n開啟:${appUrl(link)}` : message;
}
