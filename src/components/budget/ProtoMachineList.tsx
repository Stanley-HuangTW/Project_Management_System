"use client";

import Link from "next/link";
import type { ProtoMachineView } from "@/lib/actions/protoPlan";

/**
 * 樣機清單:樣機計畫排出來的每一台樣機(一台一筆),以及哪些工作項(例如測試項目)用到它。
 * 工作項在表格的「使用樣機」欄位選用樣機;台數改了這裡就跟著增減(減少時從最大的號碼開始拿掉)。
 */
export function ProtoMachineList({
  boardId,
  machines,
  phaseNames,
}: {
  boardId: string;
  machines: ProtoMachineView[];
  phaseNames: Map<string, string>;
}) {
  if (machines.length === 0) return null;

  const byProduct = new Map<string, ProtoMachineView[]>();
  for (const m of machines) byProduct.set(m.product, [...(byProduct.get(m.product) ?? []), m]);
  const inUse = machines.filter((m) => m.items.length > 0).length;

  return (
    <details className="rounded-md border border-neutral-200 dark:border-neutral-700">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
        樣機清單(共 {machines.length} 台,{inUse} 台有工作項在使用)
      </summary>
      <div className="space-y-4 border-t border-neutral-100 px-3 py-3 dark:border-neutral-800">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          樣機計畫每一台各有一筆。工作項(例如測試項目)在看板<b>表格</b>最右邊的「使用樣機」欄位選它(選好之後這裡和儀表板的「樣機使用時程」就看得到);台數減少時,從最大的號碼開始拿掉,用到它的工作項的參照會一併解除。
        </p>
        {[...byProduct].map(([product, list]) => (
          <div key={product}>
            <h3 className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
              {product}({list.length} 台)
            </h3>
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  <th className="py-1 pr-3 font-normal">階段</th>
                  <th className="py-1 pr-3 font-normal">用途</th>
                  <th className="py-1 pr-3 font-normal">樣機</th>
                  <th className="py-1 font-normal">使用中的工作項</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-3 text-neutral-700 dark:text-neutral-200">{phaseNames.get(m.phaseId) ?? ""}</td>
                    <td className="py-1 pr-3 text-neutral-700 dark:text-neutral-200">{m.unit}</td>
                    <td className="py-1 pr-3 tabular-nums text-neutral-900 dark:text-neutral-100" title={m.label}>
                      #{m.seq}
                    </td>
                    <td className="py-1">
                      {m.items.length === 0 ? (
                        <span className="text-neutral-300 dark:text-neutral-600">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {m.items.map((item) => (
                            <Link
                              key={item.id}
                              href={`/boards/${boardId}?highlight=${item.id}`}
                              className="text-blue-700 hover:underline dark:text-blue-300"
                            >
                              {item.name}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}
