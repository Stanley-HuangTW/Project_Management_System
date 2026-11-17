"use client";

import { usePathname } from "next/navigation";
import { systemBaseOf } from "@/lib/helpTopics";

/** 目前畫面所在系統的網址前綴("" 專案管理系統 / "/issues" ISSUE TRACKER),手冊連結用。 */
export function useSystemBase(): "" | "/issues" {
  return systemBaseOf(usePathname());
}
