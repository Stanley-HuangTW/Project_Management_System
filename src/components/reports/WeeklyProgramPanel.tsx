import { useState, type ReactNode } from "react";
import {
  ITEM_UPDATE_LABELS,
  MAX_UPDATES_PER_ITEM,
  byPriority,
  groupItemUpdates,
  updatesByItem,
  type ItemUpdateLine,
  type ProgramSection,
  type PersonSection,
  type ReportItem,
  type RiskLine,
  type WeeklyReportDiff,
} from "@/lib/weeklyReport";
import { RISK_KIND_LABELS, RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { PRIORITY_OPTIONS } from "@/lib/statusDefaults";

const PRIORITY_COLOR: Record<string, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((o) => [o.label, o.color])
);

const ROLE_LABEL: Record<PersonSection["role"], string> = {
  TEAM_LEADER: "Team Leader",
  DM: "DM",
  MEMBER: "成員",
};

function money(value: number): string {
  return value.toLocaleString("zh-TW");
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const color = PRIORITY_COLOR[priority] ?? "#8c8c8c";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {priority}
    </span>
  );
}

function ItemRow({ item, updates }: { item: ReportItem; updates?: ItemUpdateLine[] }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-1 text-sm text-neutral-700 dark:text-neutral-100">
      <span className="text-neutral-400 dark:text-neutral-500">
        {item.boardName} / {item.groupName}
      </span>
      <span>
        {item.wbsCode && (
          <span className="mr-1 tabular-nums text-neutral-400 dark:text-neutral-500">{item.wbsCode}</span>
        )}
        {item.name}
      </span>
      {item.end && <span className="text-xs text-neutral-400 dark:text-neutral-500">({item.end})</span>}
      {item.ownerNames.length > 0 && (
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{item.ownerNames.join("、")}</span>
      )}
      {item.isMilestone && <span title="里程碑">🚩</span>}
      {item.isCritical && <span title="要徑">⚡</span>}
      <PriorityBadge priority={item.priority} />
      {updates && updates.length > 0 && (
        <div className="basis-full">
          <UpdateRows updates={updates} max={MAX_UPDATES_PER_ITEM} />
        </div>
      )}
    </li>
  );
}

function ItemList({
  items,
  limit = 15,
  updates,
}: {
  items: ReportItem[];
  limit?: number;
  /** 有給的話,每個工作項底下列出它這週的留言、連結、附件(這週已完成的用)。 */
  updates?: Map<string, ItemUpdateLine[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = byPriority(items);
  const shown = expanded ? sorted : sorted.slice(0, limit);
  if (shown.length === 0) return <p className="py-1 text-xs text-neutral-400 dark:text-neutral-500">沒有項目。</p>;
  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {shown.map((i) => (
        <ItemRow key={i.id} item={i} updates={updates?.get(i.id)} />
      ))}
      {!expanded && sorted.length > shown.length && (
        <li className="py-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            ……另外還有 {sorted.length - shown.length} 項(點擊展開)
          </button>
        </li>
      )}
    </ul>
  );
}

const UPDATE_ICON: Record<ItemUpdateLine["kind"], string> = { COMMENT: "💬", LINK: "🔗", ATTACHMENT: "📎" };

/** 只有 http(s) 的網址才做成可以點的連結;其他(例如 javascript:)只顯示文字。 */
function safeHref(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** 一個工作項這週新增的留言、連結、附件;max 有給的話只列前幾筆,其餘說還有幾筆。 */
function UpdateRows({ updates, max }: { updates: ItemUpdateLine[]; max?: number }) {
  const shown = max === undefined ? updates : updates.slice(0, max);
  return (
    <ul className="mt-0.5 space-y-0.5 pl-3">
      {shown.map((u, idx) => {
        const href = safeHref(u.url);
        return (
          <li key={idx} className="flex flex-wrap items-baseline gap-1 text-xs text-neutral-600 dark:text-neutral-300">
            <span title={ITEM_UPDATE_LABELS[u.kind]}>{UPDATE_ICON[u.kind]}</span>
            <span className="text-neutral-400 dark:text-neutral-500">
              {u.authorName} {u.date.slice(5)}
            </span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-blue-600 hover:underline dark:text-blue-400"
              >
                {u.text}
              </a>
            ) : (
              <span className="break-words">{u.text}</span>
            )}
          </li>
        );
      })}
      {shown.length < updates.length && (
        <li className="text-xs text-neutral-400 dark:text-neutral-500">……另外還有 {updates.length - shown.length} 筆</li>
      )}
    </ul>
  );
}

/** 這一週工作項上新增的留言、連結、附件,一個工作項一組。 */
function ItemUpdateList({ updates, limit = 10 }: { updates: ItemUpdateLine[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupItemUpdates(updates);
  if (groups.length === 0) {
    return <p className="py-1 text-xs text-neutral-400 dark:text-neutral-500">這週沒有工作項新增留言、連結或附件。</p>;
  }
  const shown = expanded ? groups : groups.slice(0, limit);
  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {shown.map((g) => (
        <li key={g.itemId} className="py-1.5">
          <p className="text-sm text-neutral-700 dark:text-neutral-100">
            <span className="text-neutral-400 dark:text-neutral-500">{g.boardName} / </span>
            {g.wbsCode && <span className="mr-1 tabular-nums text-neutral-400 dark:text-neutral-500">{g.wbsCode}</span>}
            {g.name}
          </p>
          <UpdateRows updates={g.updates} />
        </li>
      ))}
      {!expanded && groups.length > shown.length && (
        <li className="py-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            ……另外還有 {groups.length - shown.length} 個工作項(點擊展開)
          </button>
        </li>
      )}
    </ul>
  );
}

function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
        {count !== undefined && <span className="ml-1 font-normal text-neutral-400">({count})</span>}
      </h3>
      {children}
    </div>
  );
}

function inProgram<T extends { item: ReportItem }>(rows: T[], programName: string | null): T[] {
  return rows.filter((r) => r.item.programName === programName);
}

function Changes({
  flagged,
  statusChanged,
  scheduleChanged,
}: {
  flagged: ReportItem[];
  statusChanged: { item: ReportItem; from: string | null; to: string | null }[];
  scheduleChanged: { item: ReportItem; fromStart: string | null; fromEnd: string | null; toStart: string | null; toEnd: string | null }[];
}) {
  if (flagged.length + statusChanged.length + scheduleChanged.length === 0) {
    return <p className="text-xs text-neutral-400 dark:text-neutral-500">這週沒有變化。</p>;
  }
  return (
    <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
      {flagged.length > 0 && (
        <p>
          新增標記:{byPriority(flagged).map((i) => i.name).join("、")}
        </p>
      )}
      {statusChanged.map((c, idx) => (
        <p key={`s${idx}`}>
          {c.item.wbsCode} {c.item.name}:{c.from ?? "未設定"} → {c.to ?? "未設定"}
        </p>
      ))}
      {scheduleChanged.map((c, idx) => (
        <p key={`d${idx}`}>
          {c.item.wbsCode} {c.item.name}:{c.fromStart ?? "—"}~{c.fromEnd ?? "—"} → {c.toStart ?? "—"}~{c.toEnd ?? "—"}
        </p>
      ))}
    </div>
  );
}

function RiskList({
  risks,
  added,
  statusChanged,
  updated,
}: {
  risks: RiskLine[];
  added: RiskLine[];
  statusChanged: { line: RiskLine; from: RiskLine["status"]; to: RiskLine["status"] }[];
  updated: RiskLine[];
}) {
  const open = risks.filter((r) => r.status !== "CLOSED");
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {risks.length === 0
          ? "沒有登記風險或議題。"
          : `${RISK_KIND_LABELS.RISK} ${risks.filter((r) => r.kind === "RISK").length} 項、` +
            `${RISK_KIND_LABELS.ISSUE} ${risks.filter((r) => r.kind === "ISSUE").length} 項,` +
            `尚未結案 ${open.length} 項。`}
      </p>
      {added.length + statusChanged.length + updated.length > 0 && (
        <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
          {added.map((r) => (
            <p key={`a${r.id}`}>
              新增:[{RISK_KIND_LABELS[r.kind]}] {r.title}({RISK_STATUS_LABELS[r.status]})
            </p>
          ))}
          {statusChanged.map((c) => (
            <p key={`c${c.line.id}`}>
              [{RISK_KIND_LABELS[c.line.kind]}] {c.line.title}:{RISK_STATUS_LABELS[c.from]} → {RISK_STATUS_LABELS[c.to]}
            </p>
          ))}
          {updated.map((r) => (
            <p key={`u${r.id}`}>
              更新:[{RISK_KIND_LABELS[r.kind]}] {r.title}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentBlock({
  people,
  upcomingDays,
  updates,
}: {
  people: PersonSection[];
  upcomingDays: number;
  updates: Map<string, ItemUpdateLine[]>;
}) {
  if (people.length === 0) {
    return (
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        沒有設定分組角色與部門名冊,所以分不出部門。分組角色設定在「分組角色設定」頁。
      </p>
    );
  }
  const byDiscipline = new Map<string, PersonSection[]>();
  for (const person of people) {
    byDiscipline.set(person.discipline, [...(byDiscipline.get(person.discipline) ?? []), person]);
  }
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-700">
      {[...byDiscipline.entries()].map(([discipline, group], groupIdx) => (
        <div
          key={discipline}
          className={`px-2 py-2 ${groupIdx > 0 ? "border-t border-neutral-300 dark:border-neutral-600" : ""}`}
        >
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {discipline}
          </p>
          <div className="pl-2">
            {group.map((person, personIdx) => (
              <div
                key={person.userId}
                className={`py-2 ${personIdx > 0 ? "border-t border-neutral-100 dark:border-neutral-800" : ""}`}
              >
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                  [{ROLE_LABEL[person.role]}] {person.userName}
                </p>
                <div className="grid grid-cols-1 gap-y-1 pl-2 sm:grid-cols-3">
                  <div className="sm:pr-3">
                    <p className="text-[11px] text-neutral-400">逾期({person.overdue.length})</p>
                    <ItemList items={person.overdue} limit={5} />
                  </div>
                  <div className="sm:border-l sm:border-neutral-200 sm:px-3 dark:sm:border-neutral-800">
                    <p className="text-[11px] text-neutral-400">這週已完成({person.completedThisWeek.length})</p>
                    <ItemList items={person.completedThisWeek} limit={5} updates={updates} />
                  </div>
                  <div className="sm:border-l sm:border-neutral-200 sm:pl-3 dark:sm:border-neutral-800">
                    <p className="text-[11px] text-neutral-400">
                      接下來 {upcomingDays} 天({person.upcoming.length})
                    </p>
                    <ItemList items={person.upcoming} limit={5} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 一個專案群組分頁籤的內容——依職能的工作項(依 Priority 排序)→ 里程碑/要徑/
 *  風險議題異動 → 預算 → 看板進度,是 renderWeeklyReportMarkdown 裡 renderProgram
 *  的畫面版本,資料來源完全相同(同一份 ProgramSection + WeeklyReportDiff)。 */
export function WeeklyProgramPanel({
  program,
  departments,
  diff,
  upcomingDays,
}: {
  program: ProgramSection;
  departments: PersonSection[];
  diff: WeeklyReportDiff;
  upcomingDays: number;
}) {
  const name = program.programName;
  const items = program.items;
  const overdue = items.filter((i) => i.bucket === "overdue");
  const upcoming = items.filter((i) => i.bucket === "upcoming");
  const milestones = items.filter((i) => i.isMilestone && i.bucket !== "done");
  const critical = items.filter((i) => i.isCritical && i.bucket !== "done");
  const risks = program.risks ?? [];
  const myPeople = departments.filter((p) => p.programName === name);

  return (
    <div>
      {!diff.firstEver && (
        <Block title="這一週">
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            完成 {diff.completed.filter((i) => i.programName === name).length}・
            新逾期 {diff.newlyOverdue.filter((i) => i.programName === name).length}・
            脫離逾期 {diff.recovered.filter((i) => i.programName === name).length}・
            狀態更新 {inProgram(diff.statusChanged, name).length}・
            時程變化 {inProgram(diff.scheduleChanged, name).length}
            {program.itemUpdates && <>・資訊更新 {groupItemUpdates(program.itemUpdates).length}</>}
          </p>
        </Block>
      )}

      {program.itemUpdates && (
        <Block title="工作項資訊更新" count={groupItemUpdates(program.itemUpdates).length}>
          <ItemUpdateList updates={program.itemUpdates} />
        </Block>
      )}

      <Block title="依職能的工作項">
        <DepartmentBlock people={myPeople} upcomingDays={upcomingDays} updates={updatesByItem(program.itemUpdates)} />
      </Block>

      <Block title="目前逾期" count={overdue.length}>
        <ItemList items={overdue} />
      </Block>

      <Block title={`未來 ${upcomingDays} 天`} count={upcoming.length}>
        <ItemList items={upcoming} />
      </Block>

      <Block title="里程碑" count={milestones.length}>
        <ItemList items={milestones} limit={20} />
        {!diff.firstEver && (
          <div className="mt-1.5">
            <Changes
              flagged={diff.milestoneFlagged.filter((i) => i.programName === name)}
              statusChanged={inProgram(diff.statusChanged, name).filter((c) => c.item.isMilestone)}
              scheduleChanged={inProgram(diff.scheduleChanged, name).filter((c) => c.item.isMilestone)}
            />
          </div>
        )}
      </Block>

      <Block title="要徑" count={critical.length}>
        <ItemList items={critical} limit={20} />
        {!diff.firstEver && (
          <div className="mt-1.5">
            <Changes
              flagged={diff.criticalFlagged.filter((i) => i.programName === name)}
              statusChanged={inProgram(diff.statusChanged, name).filter((c) => c.item.isCritical)}
              scheduleChanged={inProgram(diff.scheduleChanged, name).filter((c) => c.item.isCritical)}
            />
          </div>
        )}
      </Block>

      <Block title="風險與議題">
        <RiskList
          risks={risks}
          added={diff.firstEver ? [] : diff.riskAdded.filter((r) => r.programName === name)}
          statusChanged={diff.firstEver ? [] : diff.riskStatusChanged.filter((r) => r.line.programName === name)}
          updated={diff.firstEver ? [] : diff.riskUpdated.filter((r) => r.programName === name)}
        />
      </Block>

      {program.delays.length > 0 && (
        <Block title="對比基準線的延誤">
          {program.delays.map((d, idx) => (
            <div key={idx} className="text-xs text-neutral-600 dark:text-neutral-300">
              <p className="font-medium">
                {d.boardName}:整體晚 {d.projectDelayDays} 天
              </p>
              <ul className="pl-3">
                {d.culprits.map((c) => (
                  <li key={c.wbsCode}>
                    {c.wbsCode} {c.name}:自己晚 {c.ownDelayDays} 天,後面壓著 {c.downstreamCount} 項
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Block>
      )}

      <Block title="預算">
        {program.budgets.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">沒有編列預算的階段。</p>
        ) : (
          <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            {program.budgets
              .filter((b) => b.over)
              .map((b, idx) => (
                <p key={idx}>
                  {b.boardName} / {b.phaseName}:核准 {money(b.approved)}、已花 {money(b.spent)}、
                  已下單 {money(b.committed)}、剩 {money(b.remaining)}
                </p>
              ))}
            {program.budgets.every((b) => !b.over) && <p>沒有超支的階段。</p>}
          </div>
        )}
      </Block>

      <Block title="看板進度(產出當下)">
        {program.boards.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">沒有看得到的看板。</p>
        ) : (
          <table className="w-full text-xs text-neutral-600 dark:text-neutral-300">
            <thead>
              <tr className="border-b border-neutral-200 text-left dark:border-neutral-700">
                <th className="py-1 font-medium">看板</th>
                <th className="py-1 text-right font-medium">工作項</th>
                <th className="py-1 text-right font-medium">完成</th>
                <th className="py-1 text-right font-medium">逾期</th>
                <th className="py-1 text-right font-medium">進行中</th>
                <th className="py-1 text-right font-medium">未開始</th>
              </tr>
            </thead>
            <tbody>
              {program.boards.map((b) => (
                <tr key={b.boardId} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-1">{b.boardName}</td>
                  <td className="py-1 text-right">{b.total}</td>
                  <td className="py-1 text-right">{b.done}</td>
                  <td className="py-1 text-right">{b.overdue}</td>
                  <td className="py-1 text-right">{b.inProgress}</td>
                  <td className="py-1 text-right">{b.notStarted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Block>
    </div>
  );
}
