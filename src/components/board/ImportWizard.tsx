"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  parseImportFile,
  parseImportFromUrl,
  importRows,
} from "@/lib/actions/import";
import { createGroup } from "@/lib/actions/group";
import type { ParsedWorkbook } from "@/lib/import/parseFile";
import type { ColumnMapping } from "@/types/import";
import type { ColumnData, GroupData } from "@/types/board";
import type { ColumnType } from "@/types/column";

type Step = "source" | "sheet" | "header" | "mapping" | "target" | "confirm";

const NEW_COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  TEXT: "新增文字欄位",
  STATUS: "新增狀態欄位",
  PERSON: "新增人員欄位",
  DATE: "新增日期欄位",
  NUMBER: "新增數字欄位",
};

export function ImportWizard({
  boardId,
  columns,
  groups,
  open,
  onOpenChange,
}: {
  boardId: string;
  columns: ColumnData[];
  groups: GroupData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("source");
  const [sourceTab, setSourceTab] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [newNames, setNewNames] = useState<Record<number, string>>({});

  const [targetGroupId, setTargetGroupId] = useState<string>(
    groups[0]?.id ?? ""
  );
  const [creatingNewGroup, setCreatingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const [result, setResult] = useState<{
    itemCount: number;
    newColumnCount: number;
    personMismatchCount: number;
    numberParseFailCount: number;
  } | null>(null);

  function reset() {
    setStep("source");
    setSourceTab("file");
    setUrl("");
    setLoading(false);
    setError(null);
    setParsed(null);
    setSheetIndex(0);
    setHeaderRowIndex(0);
    setChoices({});
    setNewNames({});
    setCreatingNewGroup(false);
    setNewGroupName("");
    setResult(null);
    setSelectedFileName(null);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  const sheet = parsed?.sheets[sheetIndex];
  const dataRowsAfterHeader = useMemo(
    () => sheet?.rows.slice(headerRowIndex + 1) ?? [],
    [sheet, headerRowIndex]
  );

  const headerColumns = useMemo(() => {
    const headerRow = sheet?.rows[headerRowIndex] ?? [];
    return headerRow
      .map((h, i) => ({ index: i, header: h }))
      .filter((h): h is { index: number; header: string } => !!h.header);
  }, [sheet, headerRowIndex]);

  function initMapping() {
    const levelPattern = /^(lvl|level|層級|階層)$/i;
    const namePattern =
      /^(task ?name|item ?name|name|title|項目名稱|名稱|工作名稱|標題)$/i;

    const levelMatch = headerColumns.find((h) => levelPattern.test(h.header.trim()));
    const nameMatch =
      headerColumns.find((h) => namePattern.test(h.header.trim())) ??
      headerColumns.find((h) => h.index !== levelMatch?.index) ??
      headerColumns[0];

    const initialChoices: Record<number, string> = {};
    const initialNames: Record<number, string> = {};
    headerColumns.forEach((h) => {
      if (h.index === nameMatch?.index) initialChoices[h.index] = "name";
      else if (h.index === levelMatch?.index) initialChoices[h.index] = "level";
      else initialChoices[h.index] = "ignore";
      initialNames[h.index] = h.header;
    });
    setChoices(initialChoices);
    setNewNames(initialNames);
    setStep("mapping");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const parsedResult = await parseImportFile(fd);
      if ("error" in parsedResult) {
        setError(parsedResult.error);
        return;
      }
      setParsed(parsedResult);
      setSheetIndex(0);
      setHeaderRowIndex(0);
      setStep(parsedResult.sheets.length > 1 ? "sheet" : "header");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失敗");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function handleUrlFetch(urlOverride?: string) {
    const target = (urlOverride ?? url).trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const parsedResult = await parseImportFromUrl(target);
      if ("error" in parsedResult) {
        setError(parsedResult.error);
        return;
      }
      setParsed(parsedResult);
      setSheetIndex(0);
      setHeaderRowIndex(0);
      setStep(parsedResult.sheets.length > 1 ? "sheet" : "header");
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  // Google's OAuth consent screen needs the full page — a popup window
  // isn't reliable across browsers/embedded contexts — so this navigates
  // away entirely and relies on the callback route redirecting back here.
  // The in-progress URL is stashed in localStorage since component state
  // doesn't survive the round trip.
  function handleGoogleLogin() {
    localStorage.setItem("importWizardGoogleSheetUrl", url);
    // A hard navigation is required here (not router.push) — the browser
    // must actually follow the redirect chain out to Google and back.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(window.location.pathname)}`;
  }

  // On return from the Google OAuth redirect, reopen the modal and retry
  // the fetch (or show an error) using the URL stashed before navigating away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("googleSheetsAuth");
    if (!authStatus) return;

    params.delete("googleSheetsAuth");
    const newSearch = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));

    const savedUrl = localStorage.getItem("importWizardGoogleSheetUrl");
    localStorage.removeItem("importWizardGoogleSheetUrl");
    if (!savedUrl) return;

    // Reacting to the OAuth redirect the browser just landed on, not to a
    // React state change — an effect is the right place for this.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceTab("url");
    setUrl(savedUrl);
    onOpenChange(true);
    if (authStatus === "success") {
      handleUrlFetch(savedUrl);
    } else {
      setError("Google 登入失敗,請重新嘗試。");
    }
    // Runs once on mount to catch the redirect-back from the OAuth callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameCount = Object.values(choices).filter((c) => c === "name").length;
  const levelCount = Object.values(choices).filter((c) => c === "level").length;
  const mappingValid = nameCount === 1 && levelCount <= 1;

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      let groupId = targetGroupId;
      if (creatingNewGroup) {
        const group = await createGroup(boardId, newGroupName || "匯入的資料");
        groupId = group.id;
      }

      const mappings: ColumnMapping[] = headerColumns.map(({ index }) => {
        const choice = choices[index];
        if (choice === "name") return { sourceColIndex: index, target: { kind: "name" } };
        if (choice === "level")
          return { sourceColIndex: index, target: { kind: "level" } };
        if (choice.startsWith("existing:")) {
          return {
            sourceColIndex: index,
            target: { kind: "existingColumn", columnId: choice.slice(9) },
          };
        }
        if (choice.startsWith("new:")) {
          return {
            sourceColIndex: index,
            target: {
              kind: "newColumn",
              name: newNames[index] || "匯入欄位",
              columnType: choice.slice(4) as ColumnType,
            },
          };
        }
        return { sourceColIndex: index, target: { kind: "ignore" } };
      });

      const res = await importRows({
        boardId,
        groupId,
        dataRows: dataRowsAfterHeader,
        mappings,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "匯入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="從檔案匯入"
      size="lg"
    >
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === "source" && (
        <div>
          <div className="mb-3 flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setSourceTab("file")}
              className={`flex-1 px-3 py-1.5 text-sm ${sourceTab === "file" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400"}`}
            >
              上傳檔案
            </button>
            <button
              type="button"
              onClick={() => setSourceTab("url")}
              className={`flex-1 px-3 py-1.5 text-sm ${sourceTab === "url" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400"}`}
            >
              Google Sheet 連結
            </button>
          </div>

          {sourceTab === "file" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                disabled={loading}
                className="hidden"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
              >
                {loading
                  ? "解析中..."
                  : selectedFileName
                    ? `已選擇: ${selectedFileName}`
                    : "選擇檔案"}
              </button>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                支援 .csv / .xlsx / .xls,最多讀取前 40 欄、前 2000 列。
              </p>
            </div>
          ) : (
            <div>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="mb-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="button"
                disabled={loading || !url.trim()}
                onClick={() => handleUrlFetch()}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "讀取中..." : "讀取"}
              </button>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                此 Sheet 需設定為「知道連結的使用者」皆可檢視。若讀取失敗,請改用「上傳檔案」。
              </p>
              {error && (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="mt-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  使用 Google 帳號登入後重新讀取
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {step === "sheet" && parsed && (
        <div>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">選擇要匯入的工作表:</p>
          <div className="mb-4 space-y-1">
            {parsed.sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setSheetIndex(i)}
                className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${
                  i === sheetIndex
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                    : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                }`}
              >
                {s.name} <span className="text-xs text-neutral-400 dark:text-neutral-500">({s.rows.length} 列)</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep("header")}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            下一步
          </button>
        </div>
      )}

      {step === "header" && sheet && (
        <div>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
            點選哪一列是欄位標題列(目前選擇第 {headerRowIndex + 1} 列):
          </p>
          <div className="mb-4 max-h-64 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700">
            {sheet.rows.slice(0, 12).map((row, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setHeaderRowIndex(i)}
                className={`block w-full truncate border-b border-neutral-100 dark:border-neutral-700 px-3 py-1.5 text-left text-xs last:border-b-0 ${
                  i === headerRowIndex
                    ? "bg-blue-50 dark:bg-blue-950 font-medium text-blue-700 dark:text-blue-300"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {i + 1}. {row.filter(Boolean).slice(0, 8).join(" | ") || "(空白列)"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={initMapping}
            disabled={headerColumns.length === 0}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            下一步
          </button>
        </div>
      )}

      {step === "mapping" && (
        <div>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">設定每一欄要匯入成什麼:</p>
          <div className="mb-4 max-h-80 space-y-2 overflow-auto">
            {headerColumns.map(({ index, header }) => (
              <div key={index} className="rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {header}
                  </span>
                  <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                    例: {dataRowsAfterHeader.slice(0, 2).map((r) => r[index]).filter(Boolean).join(", ") || "-"}
                  </span>
                </div>
                <select
                  value={choices[index] ?? "ignore"}
                  onChange={(e) =>
                    setChoices((prev) => ({ ...prev, [index]: e.target.value }))
                  }
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
                >
                  <option value="ignore">忽略</option>
                  <option value="name">項目名稱</option>
                  <option value="level">階層層級(子項目)</option>
                  {columns.length > 0 && (
                    <optgroup label="對應現有欄位">
                      {columns.map((c) => (
                        <option key={c.id} value={`existing:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="新增欄位">
                    {(Object.keys(NEW_COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                      <option key={t} value={`new:${t}`}>
                        {NEW_COLUMN_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {choices[index]?.startsWith("new:") && (
                  <input
                    value={newNames[index] ?? ""}
                    onChange={(e) =>
                      setNewNames((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    placeholder="新欄位名稱"
                    className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
                  />
                )}
                {choices[index] === "new:PERSON" && (
                  <p className="mt-1 text-xs text-amber-700">
                    僅會對應到已註冊的使用者姓名,對不到的值會被略過。外部人員/團隊
                    名稱建議改選「新增文字欄位」。
                  </p>
                )}
                {choices[index] === "new:NUMBER" && (
                  <p className="mt-1 text-xs text-amber-700">
                    僅接受單純數字。像 1.1.3 這種含多個小數點的編號會解析失敗而略過,
                    建議改選「新增文字欄位」。
                  </p>
                )}
              </div>
            ))}
          </div>
          {!mappingValid && (
            <p className="mb-2 text-xs text-red-600">
              請指定剛好一欄作為「項目名稱」,「階層層級」最多只能選一欄。
            </p>
          )}
          <button
            type="button"
            disabled={!mappingValid}
            onClick={() => setStep("target")}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            下一步
          </button>
        </div>
      )}

      {step === "target" && (
        <div>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">匯入到哪個分組:</p>
          {!creatingNewGroup ? (
            <div className="mb-3">
              <select
                value={targetGroupId}
                onChange={(e) => setTargetGroupId(e.target.value)}
                className="mb-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreatingNewGroup(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                + 建立新分組
              </button>
            </div>
          ) : (
            <div className="mb-3">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="新分組名稱"
                autoFocus
                className="mb-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setCreatingNewGroup(false)}
                className="text-xs text-neutral-500 dark:text-neutral-400 hover:underline"
              >
                改用現有分組
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={
              loading || (creatingNewGroup ? !newGroupName.trim() : !targetGroupId)
            }
            onClick={handleImport}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "匯入中..." : "開始匯入"}
          </button>
        </div>
      )}

      {step === "confirm" && result && (
        <div>
          <p className="mb-2 text-sm text-neutral-700 dark:text-neutral-100">
            匯入完成:新增了 {result.itemCount} 筆項目
            {result.newColumnCount > 0 && `、${result.newColumnCount} 個新欄位`}。
          </p>
          {(result.personMismatchCount > 0 || result.numberParseFailCount > 0) && (
            <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {result.personMismatchCount > 0 && (
                <p>
                  有 {result.personMismatchCount} 個「人員」欄位的值因為找不到對應的
                  系統使用者帳號而略過(人員欄位只能對應到已註冊的使用者;若原始資料
                  是外部人員/團隊名稱,建議改用「文字」欄位匯入)。
                </p>
              )}
              {result.numberParseFailCount > 0 && (
                <p>
                  有 {result.numberParseFailCount} 個「數字」欄位的值無法解析為數字而
                  略過(例如 WBS 編號 1.1.3 這類含多個小數點的值;建議改用「文字」欄位
                  匯入)。
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={close}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            完成
          </button>
        </div>
      )}
    </Modal>
  );
}
