/**
 * 用畫面上真正在用的字型量字:拿一個畫出來的元素當參照,取它的字型家族,量出來的寬度才跟畫面一致
 * (用備用字型量,中文字寬會差一截)。拿不到 canvas(例如測試環境)就回 null。
 */
export function createTextMeasurer(reference: Element | null): ((text: string, sizePx: number, weight?: string) => number) | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const family = reference ? getComputedStyle(reference).fontFamily : "sans-serif";
  return (text, sizePx, weight = "400") => {
    ctx.font = `${weight} ${sizePx}px ${family}`;
    return ctx.measureText(text).width;
  };
}
