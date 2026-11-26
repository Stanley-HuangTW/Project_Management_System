import { readFile, stat } from "fs/promises";
import path from "path";
import { parseManual, renderManualHtml, type Manual } from "@/lib/manual";

const DOCS_DIR = path.join(process.cwd(), "docs");
/** 兩個系統各有自己的手冊:專案管理系統(pm)與 ISSUE TRACKER(issues)。 */
export type ManualKind = "pm" | "issues";
const MANUAL_FILES: Record<ManualKind, string> = {
  pm: path.join(DOCS_DIR, "使用手冊.md"),
  issues: path.join(DOCS_DIR, "ISSUE-TRACKER使用手冊.md"),
};
export const MANUAL_IMAGES_DIR = path.join(DOCS_DIR, "manual-images");

export type LoadedManual = {
  manual: Manual;
  introHtml: string;
  legendHtml: string;
  /** 章節 id → 該章的 HTML。 */
  chapterHtml: Map<string, string>;
};

const cache: Partial<Record<ManualKind, { mtimeMs: number; loaded: LoadedManual }>> = {};

/** 讀 docs 底下的手冊並轉成網頁用的資料;檔案沒改就用記憶體裡的那份。找不到檔案回 null。 */
export async function loadManual(kind: ManualKind = "pm"): Promise<LoadedManual | null> {
  const file = MANUAL_FILES[kind];
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache[kind];
  if (hit && hit.mtimeMs === mtimeMs) return hit.loaded;

  const manual = parseManual(await readFile(file, "utf8"));
  const loaded: LoadedManual = {
    manual,
    introHtml: renderManualHtml(manual.intro),
    legendHtml: renderManualHtml(manual.legend),
    chapterHtml: new Map(manual.chapters.map((c) => [c.id, renderManualHtml(c.markdown)])),
  };
  cache[kind] = { mtimeMs, loaded };
  return loaded;
}
