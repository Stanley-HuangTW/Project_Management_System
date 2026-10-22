"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LeaderBoardOverview, LeaderEntry, LeaderPerson, LeaderPersonItem } from "@/lib/leaderOverview";

/** 2026-10-07 → 10/7 */
function md(date: string | null): string {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const TONES = {
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  gray: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

function Pill({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${TONES[tone]}`}>{children}</span>;
}

function EntryList({ id, boardId, title, tone, entries, emptyText }: { id: string; boardId: string; title: string; tone: keyof typeof TONES; entries: LeaderEntry[]; emptyText: string }) {
  return (
    <div data-leader-list={id} className="min-w-0 rounded-md border border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-100">{title}</span>
        <Pill tone={tone}>{entries.length}</Pill>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-3 text-xs text-neutral-400 dark:text-neutral-500">{emptyText}</p>
      ) : (
        <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-700">
          {entries.map((e) => (
            <li key={e.itemId}>
              <Link
                href={`/boards/${boardId}?highlight=${e.itemId}`}
                className="flex items-baseline gap-2 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span className="w-9 shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">{md(e.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-neutral-800 dark:text-neutral-100">
                    {e.wbsCode && <span className="mr-1 text-neutral-400 dark:text-neutral-500">{e.wbsCode}</span>}
                    {e.itemName}
                  </span>
                  <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {e.groupName}
                    {" · "}
                    {e.assignees.length > 0 ? e.assignees.join("、") : <span className="text-amber-600 dark:text-amber-400">沒有人負責</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_LABEL: Record<LeaderPersonItem["kind"], { text: string; tone: keyof typeof TONES }> = {
  overdue: { text: "逾期", tone: "red" },
  done: { text: "已完成", tone: "green" },
  inProgress: { text: "進行中", tone: "blue" },
  notStarted: { text: "未開始", tone: "gray" },
};

function PersonRow({ boardId, person }: { boardId: string; person: LeaderPerson }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-leader-person={person.id} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
      >
        {open ? <ChevronDown size={14} className="shrink-0 text-neutral-400" /> : <ChevronRight size={14} className="shrink-0 text-neutral-400" />}
        <span className="w-32 shrink-0 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{person.name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone="gray">進行中 {person.open}</Pill>
          {person.overdue > 0 && <Pill tone="red">逾期 {person.overdue}</Pill>}
          {person.upcoming7 > 0 && <Pill tone="blue">未來 7 天 {person.upcoming7}</Pill>}
          {person.completedThisWeek > 0 && <Pill tone="green">本週完成 {person.completedThisWeek}</Pill>}
        </span>
        <span className="ml-auto text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {person.spanStart ? `${md(person.spanStart)} → ${md(person.spanEnd)}` : "沒有排程"}
        </span>
      </button>
      {open && (
        <ul className="bg-neutral-50/60 px-3 pb-2 dark:bg-neutral-800/40">
          {person.items.map((i) => (
            <li key={i.itemId}>
              <Link
                href={`/boards/${boardId}?highlight=${i.itemId}`}
                className="flex items-baseline gap-2 rounded px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="w-24 shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                  {i.start || i.end ? `${md(i.start)} → ${md(i.end)}` : "未排程"}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                  {i.wbsCode && <span className="mr-1 text-neutral-400 dark:text-neutral-500">{i.wbsCode}</span>}
                  {i.itemName}
                  <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">{i.groupName}</span>
                </span>
                <Pill tone={KIND_LABEL[i.kind].tone}>{KIND_LABEL[i.kind].text}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 專案儀表板的內容:這個專案逾期、本週完成、未來 7 天的工作項,以及每個人的時程(點開看每一項的起訖與狀態)。
 * 範圍(整個專案或只有你的組員)已經在 computeLeaderOverview 篩好。
 */
export function ProjectDashboardView({ board }: { board: LeaderBoardOverview }) {
  return (
    <div data-leader-board={board.boardId} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={board.overdue.length > 0 ? "red" : "gray"}>逾期 {board.overdue.length}</Pill>
        <Pill tone="green">本週完成 {board.completedThisWeek.length}</Pill>
        <Pill tone="blue">未來 7 天 {board.upcoming7.length}</Pill>
        {board.unassignedCount > 0 && <Pill tone="amber">沒有人負責 {board.unassignedCount}</Pill>}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <EntryList id="overdue" boardId={board.boardId} title="逾期" tone="red" entries={board.overdue} emptyText="沒有逾期的工作項" />
        <EntryList id="completedThisWeek" boardId={board.boardId} title="本週完成" tone="green" entries={board.completedThisWeek} emptyText="這週還沒有完成的工作項" />
        <EntryList id="upcoming7" boardId={board.boardId} title="未來 7 天" tone="blue" entries={board.upcoming7} emptyText="未來 7 天沒有到期的工作項" />
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-700 dark:text-neutral-100">各人員時程({board.people.length} 人)</h2>
        {board.people.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">沒有工作項指派給你範圍內的人。</p>
        ) : (
          <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            {board.people.map((person) => (
              <PersonRow key={person.id} boardId={board.boardId} person={person} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
