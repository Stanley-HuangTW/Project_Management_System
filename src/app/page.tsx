import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { loadSystemAccess } from "@/lib/issueServer";
import { postLoginPath } from "@/lib/issueAccess";

/** 根網址:依登入者能進的系統決定去哪。只能進專案管理的人跟以前一樣直接進看板。 */
export default async function Home() {
  const session = await requireSession();
  redirect(postLoginPath(await loadSystemAccess(session)));
}
