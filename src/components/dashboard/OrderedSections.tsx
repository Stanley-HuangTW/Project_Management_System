import { Children, isValidElement, type ReactNode } from "react";
import { orderDashboardSections } from "@/lib/dashboardSections";

/**
 * 依這個人自己排的順序,把儀表板的區塊排好。
 *
 * 每個子元素要帶 key=區塊 id;沒出現的(條件不成立,例如只有主管才有的區塊)Children.toArray 本來就會略過。
 * 在伺服器端排,不是用 CSS order——這樣畫面順序與 Tab 鍵、螢幕閱讀器的順序一致。
 */
export function OrderedSections({
  order,
  only,
  children,
}: {
  order: readonly string[];
  /** 只顯示這些區塊(選了某個子類分頁);沒給 = 全部。 */
  only?: ReadonlySet<string> | null;
  children: ReactNode;
}) {
  const items = Children.toArray(children).map((child) => ({
    // Children.toArray 會在 key 前面加 ".$"。
    id: isValidElement(child) && child.key !== null ? String(child.key).replace(/^\.\$/, "") : "",
    child,
  }));
  const shown = only ? items.filter((item) => only.has(item.id)) : items;
  return <>{orderDashboardSections(shown, order).map((item) => item.child)}</>;
}
