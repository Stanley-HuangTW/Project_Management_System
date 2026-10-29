import Link from "next/link";
import { requireSession } from "@/lib/session";
import { MIN_SEARCH_LENGTH, searchManual, visibleChapters, type ManualChapter } from "@/lib/manual";
import { loadManual } from "@/lib/manualServer";

function Toc({ chapters, isAdmin }: { chapters: ManualChapter[]; isAdmin: boolean }) {
  return (
    <ol data-manual-toc className="space-y-0.5 text-sm">
      {chapters.map((c) => (
        <li key={c.id}>
          <a
            href={`#${c.id}`}
            className="flex items-baseline gap-1.5 rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <span className="w-5 shrink-0 text-right tabular-nums text-neutral-400 dark:text-neutral-500">{c.number}</span>
            <span className="min-w-0">{c.title}</span>
            {isAdmin && c.adminOnly && <AdminBadge />}
          </a>
        </li>
      ))}
    </ol>
  );
}

function AdminBadge() {
  return (
    <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      管理者
    </span>
  );
}

export default async function ManualPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";
  const { q = "" } = await searchParams;

  const loaded = await loadManual();
  if (!loaded) {
    return (
      <div className="p-6">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">使用手冊</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">目前找不到使用手冊的內容。</p>
      </div>
    );
  }

  const chapters = visibleChapters(loaded.manual, isAdmin);
  const query = q.trim();
  const hits = query.length >= MIN_SEARCH_LENGTH ? searchManual(chapters, query) : [];

  return (
    <div className="flex gap-8 p-6">
      <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col gap-3 overflow-y-auto lg:flex">
        <form action="/manual" method="get">
          <input
            name="q"
            defaultValue={query}
            placeholder="搜尋使用手冊…"
            data-manual-search
            className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          />
        </form>
        <Toc chapters={chapters} isAdmin={isAdmin} />
      </aside>

      <article className="min-w-0 max-w-4xl flex-1">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{loaded.manual.title}</h1>
        {loaded.manual.version && (
          <p data-manual-version className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            適用版本 {loaded.manual.version}
          </p>
        )}
        {loaded.manual.versionNotes && (
          <details className="mt-2 rounded-md border border-neutral-200 px-3 py-2 text-xs leading-relaxed text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            <summary className="cursor-pointer text-sm text-neutral-700 dark:text-neutral-200">這一版包含的更新</summary>
            <p className="mt-2">{loaded.manual.versionNotes}</p>
          </details>
        )}
        <div className="manual-prose mt-3" dangerouslySetInnerHTML={{ __html: loaded.introHtml }} />

        {/* 窄螢幕沒有左邊的目錄:搜尋與目錄收在這裡。 */}
        <div className="mt-4 lg:hidden">
          <form action="/manual" method="get" className="mb-3">
            <input
              name="q"
              defaultValue={query}
              placeholder="搜尋使用手冊…"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
            />
          </form>
          <details className="rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
            <summary className="cursor-pointer text-sm text-neutral-700 dark:text-neutral-200">目錄</summary>
            <div className="mt-2">
              <Toc chapters={chapters} isAdmin={isAdmin} />
            </div>
          </details>
        </div>

        {query && (
          <section data-manual-results className="mt-5 rounded-md border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {query.length < MIN_SEARCH_LENGTH ? "搜尋" : `「${query}」符合 ${hits.length} 章`}
              </h2>
              <Link href="/manual" className="text-xs text-blue-700 hover:underline dark:text-blue-300">
                清除搜尋
              </Link>
            </div>
            {query.length < MIN_SEARCH_LENGTH && <p className="text-sm text-neutral-600 dark:text-neutral-300">請輸入至少兩個字。</p>}
            {query.length >= MIN_SEARCH_LENGTH && hits.length === 0 && (
              <p className="text-sm text-neutral-600 dark:text-neutral-300">手冊裡沒有「{query}」。換個關鍵字試試。</p>
            )}
            <ul className="space-y-3">
              {hits.map((h) => (
                <li key={h.chapterId} data-manual-hit={h.chapterId}>
                  <a href={`#${h.chapterId}`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
                    {h.number}. {h.title}
                  </a>
                  <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">{h.count} 處</span>
                  <ul className="mt-1 space-y-0.5">
                    {h.snippets.map((s, i) => (
                      <li key={i} className="text-xs text-neutral-600 dark:text-neutral-300">
                        {s.before}
                        <mark className="rounded bg-yellow-200 px-0.5 text-neutral-900 dark:bg-yellow-700 dark:text-neutral-50">{s.match}</mark>
                        {s.after}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="manual-prose mt-4" dangerouslySetInnerHTML={{ __html: loaded.legendHtml }} />

        {chapters.map((c) => (
          <section key={c.id} id={c.id} data-manual-chapter={c.id} className="scroll-mt-6 border-t border-neutral-200 pt-6 mt-8 dark:border-neutral-700">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {c.number}. {c.title}
              {isAdmin && c.adminOnly && <AdminBadge />}
            </h2>
            <div className="manual-prose" dangerouslySetInnerHTML={{ __html: loaded.chapterHtml.get(c.id) ?? "" }} />
          </section>
        ))}
      </article>
    </div>
  );
}
