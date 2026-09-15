/**
 * The reference project's bound Apps Script (自動更新甘特圖與階層_0813.gs),
 * bundled here so a freshly exported workbook can be paired with the same
 * script the source sheet already relies on. Bundling a copy for a NEW file is
 * not the same as editing the original — that file is never touched.
 *
 * One addition on top of the original: BuildBurndownChart, because .xlsx has
 * no way to express a chart and Google Sheets does. The burn-down sheet the
 * export writes is the data; this draws it.
 */
export const GANTT_APPS_SCRIPT = `/**************************************************************************
 * AMR Platform Schedule - Google Apps Script (Fully Fixed)
 **************************************************************************/

var SHEETS = ['Gantt (Day)', 'Gantt (Week)', 'Gantt (Month)'];
var FIRST_ROW = 7;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gantt')
    .addItem('Refresh all', 'RefreshAll')
    .addItem('Refresh timeline', 'FitTimeline')
    .addItem('Apply level colours', 'ApplyLevelColours')
    .addItem('Indent by level', 'ApplyIndent')
    .addItem('Go to today', 'GoToToday')
    .addItem('標記當週時間 - Mark current week', 'MarkCurrentWeek')
    .addItem('彙總 Summary 完成% - Roll up summary %', 'RollupSummaries')
    .addItem('色彩標記今日任務', 'colorTodayTasksRed')
    .addItem('篩選逾期未完成 (開/關) - Toggle overdue', 'ToggleOverdueFilter')
    .addItem('Enable Filters - 啟用篩選', 'enableAutoFilter')
    .addItem('Clear Filters - 清除篩選', 'clearAllFilters')
    .addItem('產生燃盡圖 - Burn-down chart', 'BuildBurndownChart')
    .addToUi();

  RollupSummaries();         // 依子項動態彙總 summary 完成%
  MarkCurrentWeek();         // 依開檔時間標記今日/當週/當月
  applyTaskColors_(false);   // 開檔即標記：完成(灰)/逾期未完成(紅)，套用三個分頁
  GoToToday();
}

function RefreshAll() {
  ApplyIndent();
  ApplyLevelColours();
  FitTimeline();
  RollupSummaries();
  MarkCurrentWeek();
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Gantt (Day)') return;

  var col = e.range.getColumn();
  var row = e.range.getRow();
  var single = (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1);

  var resCol = findColFlexible_(sh, ['Resource']);
  if (single && resCol && col === resCol && row >= FIRST_ROW) {
    var newVal = (e.value == null ? '' : String(e.value)).trim();
    var oldVal = (e.oldValue == null ? '' : String(e.oldValue)).trim();

    if (newVal !== oldVal) {
      var res;
      if (newVal === '') {
        res = '';
      } else if (oldVal === '') {
        res = newVal;
      } else {
        var parts = oldVal.split(',').map(function (x) { return x.trim(); })
                          .filter(function (x) { return x !== ''; });
        var i = parts.indexOf(newVal);
        if (i >= 0) { parts.splice(i, 1); } else { parts.push(newVal); }
        res = parts.join(', ');
      }
      if (res !== newVal) e.range.setValue(res);
    }
  }

  var lvlCol = findColFlexible_(sh, ['Lvl']);
  var taskCol = findColFlexible_(sh, ['Task Name', 'Task']);
  var typeCol = findColFlexible_(sh, ['Type']);
  var pctCol  = findColFlexible_(sh, ['%', '完成率']);
  if (single && (col === lvlCol || col === taskCol)) ApplyIndent();
  if (single && col === lvlCol) ApplyLevelColours();
  if (single && (col === pctCol || col === typeCol)) RollupSummaries();

  FitTimeline();
  MarkCurrentWeek();
}

function getLastDataRow_(sh) {
  return Math.max(FIRST_ROW, sh.getLastRow());
}

function FitTimeline() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var day = ss.getSheetByName('Gantt (Day)');
  if (!day) return;
  var finCol = findColFlexible_(day, ['Finish']);
  if (!finCol) return;

  var lastRow = getLastDataRow_(day);
  var fin = day.getRange(FIRST_ROW, finCol, lastRow - FIRST_ROW + 1, 1).getValues();
  var maxF = new Date(); maxF.setHours(0, 0, 0, 0);
  for (var i = 0; i < fin.length; i++) {
    var v = fin[i][0];
    if (v instanceof Date && v.getTime() > maxF.getTime()) maxF = v;
  }
  var visEnd = new Date(maxF.getTime()); visEnd.setDate(visEnd.getDate() + 7);

  for (var s = 0; s < SHEETS.length; s++) {
    var sh = ss.getSheetByName(SHEETS[s]);
    if (!sh) continue;
    var tl0 = tlStart_(sh);
    if (!tl0) continue;
    var lastCol = sh.getLastColumn();
    var hdr = sh.getRange(6, tl0, 1, lastCol - tl0 + 1).getValues()[0];
    var lastDateIdx = -1, splitIdx = -1;
    for (var c = 0; c < hdr.length; c++) {
      if (hdr[c] instanceof Date) {
        lastDateIdx = c;
        if (splitIdx < 0 && hdr[c].getTime() > visEnd.getTime()) splitIdx = c;
      }
    }
    if (lastDateIdx < 0) continue;
    var lastDateCol = tl0 + lastDateIdx;
    if (splitIdx < 0) {
      sh.showColumns(tl0, lastDateCol - tl0 + 1);
    } else {
      var splitCol = tl0 + splitIdx;
      if (splitCol > tl0) sh.showColumns(tl0, splitCol - tl0);
      sh.hideColumns(splitCol, lastDateCol - splitCol + 1);
    }
  }
}

function GoToToday() {
  var day = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Gantt (Day)');
  if (!day) return;
  var tl0 = tlStart_(day);
  if (!tl0) return;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var lastCol = day.getLastColumn();
  var hdr = day.getRange(6, tl0, 1, lastCol - tl0 + 1).getValues()[0];
  for (var c = 0; c < hdr.length; c++) {
    if (hdr[c] instanceof Date && hdr[c].getTime() >= today.getTime()) {
      day.setActiveSelection(day.getRange(FIRST_ROW, tl0 + c));
      SpreadsheetApp.flush();
      return;
    }
  }
}

function ApplyLevelColours() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var setSh = ss.getSheetByName('Settings');
  if (!setSh) return;
  var colours = {};
  for (var L = 1; L <= 6; L++) colours[L] = setSh.getRange(3 + L, 2).getBackground(); // B4:B9

  for (var s = 0; s < SHEETS.length; s++) {
    var sh = ss.getSheetByName(SHEETS[s]);
    if (!sh) continue;
    var rules = sh.getConditionalFormatRules();
    var changed = false;
    for (var r = 0; r < rules.length; r++) {
      var bc = rules[r].getBooleanCondition();
      if (!bc) continue;
      var vals = bc.getCriteriaValues();
      if (!vals || !vals.length) continue;
      var f = String(vals[0]);
      var m = f.match(/=\\s*([1-6])\\s*$/);
      if (m) {
        var L = parseInt(m[1], 10);
        rules[r] = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(f)
          .setBackground(colours[L])
          .setRanges(rules[r].getRanges())
          .build();
        changed = true;
      }
    }
    if (changed) sh.setConditionalFormatRules(rules);
  }
}

function ApplyIndent() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Gantt (Day)');
  if (!sh) return;
  var lvlCol = findColFlexible_(sh, ['Lvl']), taskCol = findColFlexible_(sh, ['Task Name', 'Task']);
  if (!lvlCol || !taskCol) return;

  var lastRow = getLastDataRow_(sh);
  var n = lastRow - FIRST_ROW + 1;
  if (n <= 0) return;

  var lvls = sh.getRange(FIRST_ROW, lvlCol, n, 1).getValues();
  var tasks = sh.getRange(FIRST_ROW, taskCol, n, 1).getValues();
  var out = [], changed = false;
  for (var i = 0; i < n; i++) {
    var lvl = lvls[i][0], t = tasks[i][0];
    if (t == null || t === '') { out.push([t == null ? '' : t]); continue; }
    var raw = String(t).replace(/^ +/, '');
    var pad = '';
    if (typeof lvl === 'number' && lvl >= 2 && lvl <= 8) pad = new Array(lvl).join('    ');
    var nv = pad + raw;
    out.push([nv]);
    if (nv !== String(t)) changed = true;
  }
  if (changed) sh.getRange(FIRST_ROW, taskCol, n, 1).setValues(out);
}

/** 核心標色邏輯 (完全修復欄位與 100% 判定) */
function colorTodayTasksRed() { applyTaskColors_(true); }

/** 依到期/完成狀態標記 Task Name 文字色：完成=灰(#999)、逾期未完成=紅(#F00)、其餘=黑。
 *  套用到 Gantt (Day) / (Week) / (Month) 三個分頁 (Week/Month 的欄位對應 Day)。 */
function applyTaskColors_(showAlert) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    var applied = 0, missing = [];
    for (var s = 0; s < SHEETS.length; s++) {
      const sheet = ss.getSheetByName(SHEETS[s]);
      if (!sheet) continue;
      const taskCol = findColFlexible_(sheet, ['Task Name', 'Task']);
      const finishCol = findColFlexible_(sheet, ['Finish']);
      const percentCol = findColFlexible_(sheet, ['%', '完成率']);
      if (!taskCol || !finishCol || !percentCol) { missing.push(SHEETS[s]); continue; }
      const lastRow = getLastDataRow_(sheet);
      if (lastRow < FIRST_ROW) continue;
      const numRows = lastRow - FIRST_ROW + 1;
      const finVals = sheet.getRange(FIRST_ROW, finishCol, numRows, 1).getValues();
      const pctVals = sheet.getRange(FIRST_ROW, percentCol, numRows, 1).getValues();
      const colors = [];
      for (let i = 0; i < numRows; i++) {
        const fv = finVals[i][0], pv = pctVals[i][0];
        let color = '#000000', isCompleted = false;
        if (typeof pv === 'number') { if (pv >= 1) isCompleted = true; }
        else if (pv != null && pv !== '') { let x = parseFloat(String(pv).replace('%', '').trim()); if (!isNaN(x) && x >= 1) isCompleted = true; }
        if (isCompleted) color = '#999999';
        else if (fv instanceof Date) { const fd = new Date(fv); fd.setHours(0, 0, 0, 0); if (fd.getTime() <= today.getTime()) color = '#FF0000'; }
        colors.push([color]);
      }
      sheet.getRange(FIRST_ROW, taskCol, numRows, 1).setFontColors(colors);
      applied++;
    }
    if (showAlert) {
      var msg = '色彩標記完成！（已套用 ' + applied + ' 個分頁）';
      if (missing.length) msg += '\\n找不到欄位而略過: ' + missing.join(', ');
      SpreadsheetApp.getUi().alert(msg);
    }
  } catch (e) {
    if (showAlert) SpreadsheetApp.getUi().alert('執行失敗: ' + e.message);
  }
}

/**************************************************************************
 * Summary 完成% 動態彙總：對每個 Type=Summary 的列，取底下所有工作項(WBS 以該列
 * WBS + "." 開頭、且非 Summary 的 Task/Milestone) 的「完成% 簡單平均」，寫回其 %Done。
 **************************************************************************/
function RollupSummaries() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Gantt (Day)');
  if (!sh) return;
  var wbsCol  = findColFlexible_(sh, ['WBS']);
  var typeCol = findColFlexible_(sh, ['Type']);
  var pctCol  = findColFlexible_(sh, ['%', '完成率']);
  if (!wbsCol || !typeCol || !pctCol) return;
  var lastRow = getLastDataRow_(sh);
  if (lastRow < FIRST_ROW) return;
  var n = lastRow - FIRST_ROW + 1;
  var wbs = sh.getRange(FIRST_ROW, wbsCol,  n, 1).getValues();
  var typ = sh.getRange(FIRST_ROW, typeCol, n, 1).getValues();
  var pct = sh.getRange(FIRST_ROW, pctCol,  n, 1).getValues();
  function norm(p) {
    if (typeof p === 'number') return p > 1 ? p / 100 : p;
    if (p != null && p !== '') { var x = parseFloat(String(p).replace('%', '').trim()); if (!isNaN(x)) return x > 1 ? x / 100 : x; }
    return 0;
  }
  for (var i = 0; i < n; i++) {
    if (String(typ[i][0]).trim() !== 'Summary') continue;
    var prefix = String(wbs[i][0]).trim() + '.';
    var sum = 0, cnt = 0;
    for (var j = 0; j < n; j++) {
      if (j === i) continue;
      var wj = String(wbs[j][0]).trim(), tj = String(typ[j][0]).trim();
      if (wj.indexOf(prefix) === 0 && tj !== '' && tj !== 'Summary') { sum += norm(pct[j][0]); cnt++; }
    }
    if (cnt > 0) sh.getRange(FIRST_ROW + i, pctCol).setValue(sum / cnt);
  }
}

/**************************************************************************
 * 依開檔/編輯時間，標記今日(Day) / 當週欄(Week) / 當月欄(Month)。動態 TODAY()，
 * 可重複執行不累積(以公式含 TODAY() 辨識舊規則後重建)。
 **************************************************************************/
function MarkCurrentWeek() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var HEADER = '#E67E22', BAND = '#FDEBD8';
  for (var s = 0; s < SHEETS.length; s++) {
    var sh = ss.getSheetByName(SHEETS[s]);
    if (!sh) continue;
    var tl0 = tlStart_(sh);
    if (!tl0) continue;
    var col = colLetter_(tl0), lastCol = sh.getLastColumn(), lastRow = getLastDataRow_(sh);
    if (lastRow < FIRST_ROW) lastRow = FIRST_ROW;
    var f = (SHEETS[s] === 'Gantt (Day)')
      ? '=' + col + '$6=TODAY()'
      : '=AND(' + col + '$6<=TODAY(),' + col + '$4>=TODAY())';
    var rules = sh.getConditionalFormatRules(), kept = [];
    for (var r = 0; r < rules.length; r++) {
      var bc = rules[r].getBooleanCondition();
      var vals = bc ? bc.getCriteriaValues() : null;
      var ff = (vals && vals.length) ? String(vals[0]) : '';
      if (ff.indexOf('TODAY()') === -1) kept.push(rules[r]);
    }
    kept.unshift(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f)
      .setBackground(HEADER).setRanges([sh.getRange(6, tl0, 1, lastCol - tl0 + 1)]).build());
    kept.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f)
      .setBackground(BAND).setRanges([sh.getRange(FIRST_ROW, tl0, lastRow - FIRST_ROW + 1, lastCol - tl0 + 1)]).build());
    sh.setConditionalFormatRules(kept);
  }
}

function colLetter_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - 1) / 26); }
  return s;
}

/**************************************************************************
 * 切換「只顯示逾期且未完成」的工作項目 (Task/Milestone、Finish<=今天、%<100)。
 * 作用在目前檢視的分頁；再按一次還原顯示全部 (以文件屬性記錄開/關)。
 **************************************************************************/
function ToggleOverdueFilter() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  var props = PropertiesService.getDocumentProperties();
  var key = 'overdue_' + sh.getName();
  var lastRow = getLastDataRow_(sh);
  if (lastRow < FIRST_ROW) return;
  var n = lastRow - FIRST_ROW + 1;
  if (props.getProperty(key) === '1') {
    sh.showRows(FIRST_ROW, n);
    props.deleteProperty(key);
    SpreadsheetApp.getUi().alert('已還原：顯示全部項目。');
    return;
  }
  var typeCol = findColFlexible_(sh, ['Type']);
  var finishCol = findColFlexible_(sh, ['Finish']);
  var pctCol = findColFlexible_(sh, ['%', '完成率']);
  if (!typeCol || !finishCol || !pctCol) { SpreadsheetApp.getUi().alert('找不到 Type / Finish / % 欄位。'); return; }
  var typ = sh.getRange(FIRST_ROW, typeCol, n, 1).getValues();
  var fin = sh.getRange(FIRST_ROW, finishCol, n, 1).getValues();
  var pct = sh.getRange(FIRST_ROW, pctCol, n, 1).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function isDone(p) {
    if (typeof p === 'number') return (p > 1 ? p / 100 : p) >= 1;
    if (p != null && p !== '') { var x = parseFloat(String(p).replace('%', '').trim()); if (!isNaN(x)) return (x > 1 ? x / 100 : x) >= 1; }
    return false;
  }
  function keepRow(i) {
    var t = String(typ[i][0]).trim(), f = fin[i][0];
    if (t !== 'Task' && t !== 'Milestone') return false;
    if (!(f instanceof Date)) return false;
    var fd = new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
    return fd <= today.getTime() && !isDone(pct[i][0]);
  }
  sh.showRows(FIRST_ROW, n);
  var i = 0;
  while (i < n) {
    if (keepRow(i)) { i++; continue; }
    var j = i;
    while (j < n && !keepRow(j)) j++;
    sh.hideRows(FIRST_ROW + i, j - i);
    i = j;
  }
  props.setProperty(key, '1');
  SpreadsheetApp.getUi().alert('已篩選：只顯示逾期且未完成的工作項目。再按一次即可還原。');
}

/** 彈性尋找欄位 (解決格式/空白造成抓不到的問題) */
function findColFlexible_(sh, keywords) {
  var maxCol = sh.getLastColumn();
  if (maxCol === 0) return 0;
  var row = sh.getRange(6, 1, 1, maxCol).getValues()[0];

  for (var c = 0; c < row.length; c++) {
    var cellText = String(row[c]).trim().toLowerCase();
    if (!cellText) continue;

    for (var k = 0; k < keywords.length; k++) {
      var target = keywords[k].trim().toLowerCase();
      if (cellText === target || cellText.indexOf(target) !== -1) {
        return c + 1;
      }
    }
  }
  return 0;
}

function tlStart_(sh) {
  var maxCol = sh.getLastColumn();
  if (maxCol === 0) return 0;
  var row = sh.getRange(6, 1, 1, maxCol).getValues()[0];
  for (var c = 0; c < row.length; c++) {
    if (row[c] instanceof Date) return c + 1;
  }
  return 0;
}

function enableAutoFilter() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const headerRange = sheet.getRange(6, 1, 1, sheet.getLastColumn());
    sheet.getFilter()?.remove();
    sheet.setFilter(headerRange);
    SpreadsheetApp.getUi().alert('篩選功能已啟用！');
  } catch (e) {
    SpreadsheetApp.getUi().alert('啟用篩選失敗: ' + e.message);
  }
}

/**************************************************************************
 * 燃盡圖:把「燃盡圖 (Burn-down)」分頁裡的每一段資料畫成折線圖。
 * 一個核准範圍一張圖,重跑會先清掉舊的,不會越疊越多。
 **************************************************************************/
function BuildBurndownChart() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('燃盡圖 (Burn-down)');
  if (!sh) { SpreadsheetApp.getUi().alert('找不到「燃盡圖 (Burn-down)」分頁。'); return; }

  var charts = sh.getCharts();
  for (var i = 0; i < charts.length; i++) sh.removeChart(charts[i]);

  var lastRow = sh.getLastRow();
  var col1 = sh.getRange(1, 1, lastRow, 1).getValues();
  var made = 0;
  // 每一段的表頭都是「週結束日」,資料從下一列開始,到下一個空白列為止。
  for (var r = 0; r < lastRow; r++) {
    if (String(col1[r][0]).trim() !== '週結束日') continue;
    var first = r + 2;              // 1-based,表頭的下一列
    var last = first;
    while (last <= lastRow && col1[last - 1][0] !== '' && col1[last - 1][0] != null) last++;
    last--;
    if (last < first) continue;

    var chart = sh.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange(r + 1, 1, last - r, 4))   // 表頭 + 計畫/實際/含已下單
      .setNumHeaders(1)
      .setOption('title', String(sh.getRange(r, 1).getValue()))
      .setOption('legend', { position: 'bottom' })
      .setOption('height', 320)
      .setOption('width', 620)
      .setPosition(first, 8, 0, 0)
      .build();
    sh.insertChart(chart);
    made++;
  }
  SpreadsheetApp.getUi().alert(made > 0 ? '已產生 ' + made + ' 張燃盡圖。' : '燃盡圖分頁裡沒有資料。');
}

function clearAllFilters() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const filter = sheet.getFilter();
    if (filter) {
      filter.remove();
      SpreadsheetApp.getUi().alert('所有篩選已清除！');
    } else {
      SpreadsheetApp.getUi().alert('目前沒有啟用篩選。');
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('清除篩選失敗: ' + e.message);
  }
}
`;
