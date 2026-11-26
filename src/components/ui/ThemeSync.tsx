"use client";

import { useEffect } from "react";
import { saveUiPrefs } from "@/lib/actions/uiPrefs";

/**
 * 顯示背景(淺色 / 深色)跟著帳號走:這個人在帳號上存過,就以帳號的為準(換瀏覽器、換電腦也一樣);
 * 帳號上還沒存、這台瀏覽器卻選了深色(以前只記在瀏覽器裡),就把它存到帳號上。
 * 代操作別人的帳號時不動 —— 那是對方的設定。
 */
export function ThemeSync({ serverTheme, impersonating }: { serverTheme: "light" | "dark" | null; impersonating: boolean }) {
  useEffect(() => {
    if (impersonating) return;
    try {
      const local = localStorage.getItem("theme") === "dark" ? "dark" : "light";
      if (serverTheme) {
        if (serverTheme !== local) {
          localStorage.setItem("theme", serverTheme);
          document.documentElement.classList.toggle("dark", serverTheme === "dark");
        }
      } else if (local === "dark") {
        void saveUiPrefs({ theme: "dark" });
      }
    } catch {
      // 瀏覽器不給用 localStorage(私密模式)就維持目前的畫面。
    }
  }, [serverTheme, impersonating]);
  return null;
}
