import { readFile, stat } from "fs/promises";
import path from "path";
import { parseManual, renderManualHtml, type Manual } from "@/lib/manual";

const DOCS_DIR = path.join(process.cwd(), "docs");
const MANUAL_FILE = path.join(DOCS_DIR, "使用手冊.md");
export const MANUAL_IMAGES_DIR = path.join(DOCS_DIR, "manual-images");

export type LoadedManual = {
  manual: Manual;
  introHtml: string;
  legendHtml: string;
  /** 章節 id → 該章的 HTML。 */
  chapterHtml: Map<string, string>;
};

let cache: { mtimeMs: number; loaded: LoadedManual } | null = null;

/** 讀 docs/使用手冊.md 並轉成網頁用的資料;檔案沒改就用記憶體裡的那份。找不到檔案回 null。 */
export async function loadManual(): Promise<LoadedManual | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(MANUAL_FILE)).mtimeMs;
  } catch {
    return null;
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.loaded;

  const manual = parseManual(await readFile(MANUAL_FILE, "utf8"));
  const loaded: LoadedManual = {
    manual,
    introHtml: renderManualHtml(manual.intro),
    legendHtml: renderManualHtml(manual.legend),
    chapterHtml: new Map(manual.chapters.map((c) => [c.id, renderManualHtml(c.markdown)])),
  };
  cache = { mtimeMs, loaded };
  return loaded;
}
