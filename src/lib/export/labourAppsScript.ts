/**
 * 人力表 .xlsx 轉成 Google 試算表之後的補丁腳本。
 *
 * .xlsx 上傳到雲端硬碟、以「Google 試算表」開啟就能用了 —— SUM 公式、跨表
 * 參照都是兩邊都懂的東西,不需要腳本才能動。這支腳本只補一件轉檔常常掉的
 * 東西:Excel 的「小數,介於 0 與 1 之間」資料驗證,匯入 Google 試算表時
 * 規則本身有時候還在,但使用者在名額區塊插入新的一列不會自動繼承它 ——
 * 那一列就變成沒有上限的空白格。選單裡的「重新套用投入上限」把驗證規則
 * 重新蓋滿整個名額區塊,插的新列也蓋得到。
 *
 * 表格的位置(有幾排里程碑類型、名額有幾列)每塊看板不一樣,所以在這裡跟
 * labourWorkbook.ts 的 parseLabourWorkbook 一樣,不假設固定列號,而是找
 * 「每月人數」那一列來定位。
 */
export const LABOUR_APPS_SCRIPT = `/**************************************************************************
 * 人力表 - Google Apps Script
 **************************************************************************/

var SHEET_NAME = 'manpower';
var HEADCOUNT_LABEL = '每月人數';
var FIRST_MONTH_COL = 6; // F 欄
var MAX_FTE = 1;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('人力表')
    .addItem('重新套用投入上限驗證(0~1)', 'ReapplyFteValidation')
    .addToUi();
}

function findHeadcountRow_(sh) {
  var lastRow = sh.getLastRow();
  for (var r = 2; r <= lastRow; r++) {
    if (String(sh.getRange(r, 2).getValue()).trim() === HEADCOUNT_LABEL) return r;
  }
  return -1;
}

function findLastMonthCol_(sh) {
  var lastCol = sh.getLastColumn();
  var col = FIRST_MONTH_COL - 1;
  for (var c = FIRST_MONTH_COL; c <= lastCol; c++) {
    var v = String(sh.getRange(1, c).getValue()).trim();
    if (!/^\\d{4}-\\d{2}$/.test(v)) break;
    col = c;
  }
  return col;
}

function ReapplyFteValidation() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) {
    SpreadsheetApp.getUi().alert('找不到「' + SHEET_NAME + '」分頁。');
    return;
  }

  var headcountRow = findHeadcountRow_(sh);
  var lastMonthCol = findLastMonthCol_(sh);
  var lastRow = sh.getLastRow();
  if (headcountRow < 0 || lastMonthCol < FIRST_MONTH_COL || headcountRow >= lastRow) {
    SpreadsheetApp.getUi().alert('表格結構跟預期不一樣,沒有套用。請確認這是程式匯出的原始檔案。');
    return;
  }

  var firstSlotRow = headcountRow + 1;
  var range = sh.getRange(
    firstSlotRow,
    FIRST_MONTH_COL,
    lastRow - firstSlotRow + 1,
    lastMonthCol - FIRST_MONTH_COL + 1
  );
  var rule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, MAX_FTE)
    .setAllowInvalid(false)
    .setHelpText('一個名額一個月最多 ' + MAX_FTE + '(全職)。需要兩個人請開兩個名額。')
    .build();
  range.setDataValidation(rule);

  SpreadsheetApp.getUi().alert('已重新套用投入上限驗證,共 ' + range.getNumRows() + ' 列。');
}
`;
