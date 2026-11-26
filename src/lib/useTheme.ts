"use client";

import { useCallback, useEffect, useState } from "react";
import { saveUiPrefs } from "@/lib/actions/uiPrefs";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // Reading a real external system (localStorage, unavailable during SSR)
    // on mount and syncing it into state once is exactly what this effect
    // is for; there's no prop/render-time value to derive it from.
    const stored = localStorage.getItem("theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "dark") setThemeState("dark");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
    // 顯示背景跟著帳號走(換瀏覽器、換電腦也一樣);存不成功不影響這一台的畫面。
    void saveUiPrefs({ theme: next }).catch(() => {});
  }, []);

  return { theme, setTheme };
}
