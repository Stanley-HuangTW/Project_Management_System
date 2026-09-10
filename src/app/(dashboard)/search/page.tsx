import Link from "next/link";
import { FileText, MessageSquare, Paperclip, ShieldAlert } from "lucide-react";
import { searchEverything, type SearchHit } from "@/lib/actions/search";
import { SearchBox } from "@/components/search/SearchBox";

const KIND_META: Record<SearchHit["kind"], { label: string; Icon: typeof FileText }> = {
  item: { label: "工作項", Icon: FileText },
  comment: { label: "留言", Icon: MessageSquare },
  attachment: { label: "附件", Icon: Paperclip },
  risk: { label: "風險/議題", Icon: ShieldAlert },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const { hits, truncated } = await searchEverything(query);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">搜尋</h1>
      <SearchBox initialQuery={query} autoFocus />

      {query.length < 2 ? (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          輸入至少兩個字,會搜尋你看得到的所有看板:工作項名稱、留言、附件檔名、風險與議題。
        </p>
      ) : hits.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">找不到「{query}」。</p>
      ) : (
        <>
          <p className="mb-2 mt-6 text-xs text-neutral-400 dark:text-neutral-500">
            {hits.length} 筆結果{truncated && ",只顯示每一類最新的 25 筆"}
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {hits.map((hit, i) => {
              const { label, Icon } = KIND_META[hit.kind];
              const href = hit.itemId
                ? `/boards/${hit.boardId}?highlight=${hit.itemId}`
                : `/boards/${hit.boardId}`;
              return (
                <li key={`${hit.kind}-${i}`}>
                  <Link href={href} className="flex gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <Icon size={15} className="mt-0.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                        {hit.title}
                      </span>
                      {hit.excerpt && (
                        <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {hit.excerpt}
                        </span>
                      )}
                      <span className="mt-0.5 block text-xs text-neutral-400 dark:text-neutral-500">
                        {label}・{hit.boardName}・{new Date(hit.at).toLocaleDateString("zh-TW")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
