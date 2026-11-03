import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { listFeedback } from "@/lib/actions/feedback";
import { FeedbackList } from "@/components/feedback/FeedbackList";

/** 使用者回報:同仁按畫面右下角「?」寫下的問題,固定收在這一頁。只有管理者看得到。 */
export default async function FeedbackPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN") notFound();

  const rows = await listFeedback();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">使用者回報</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        同仁在任何畫面按右下角的「?」寫下的問題都收在這裡:誰、什麼時候、在哪個畫面、寫了什麼。處理完標成已處理(可以留說明),也可以下載成 CSV。
        同仁用「選取畫面上的元素」送出的回報會附上選到的元素的位置資訊(點開「選取的元素」看),按「複製給 Claude Code」就能把整則回報貼過去除錯。
        這裡不會寄信通知,新的回報會在側邊欄「使用者回報」旁邊標數字。
      </p>
      <FeedbackList rows={rows} />
    </div>
  );
}
