import { describe, expect, it } from "vitest";
import { describeApplyResult, formatWeekdays, templateDates, validateTemplateDraft, type TemplateDraft } from "./timeTemplates";

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: "部門週會",
  kind: "activity",
  categoryId: "cat1",
  itemId: null,
  boardId: null,
  startMinute: 600,
  hours: 1,
  note: "",
  weekdays: [1],
  shared: false,
  ...over,
});

describe("validateTemplateDraft", () => {
  it("正常的會議範本沒有錯誤", () => {
    expect(validateTemplateDraft(draft())).toBeNull();
  });

  it("名稱不能空白、不能太長", () => {
    expect(validateTemplateDraft(draft({ name: "  " }))).toMatch(/名稱/);
    expect(validateTemplateDraft(draft({ name: "a".repeat(41) }))).toMatch(/名稱/);
  });

  it("工時要大於 0、不超過 24", () => {
    expect(validateTemplateDraft(draft({ hours: 0 }))).toMatch(/大於 0/);
    expect(validateTemplateDraft(draft({ hours: 25, startMinute: null }))).toMatch(/24/);
  });

  it("開始時間加工時不能跨過午夜", () => {
    expect(validateTemplateDraft(draft({ startMinute: 1400, hours: 2 }))).toMatch(/午夜/);
  });

  it("不排時間(null)可以", () => {
    expect(validateTemplateDraft(draft({ startMinute: null }))).toBeNull();
  });

  it("至少選一天,而且星期要在 1–7", () => {
    expect(validateTemplateDraft(draft({ weekdays: [] }))).toMatch(/至少選一天/);
    expect(validateTemplateDraft(draft({ weekdays: [0] }))).toMatch(/星期/);
    expect(validateTemplateDraft(draft({ weekdays: [8] }))).toMatch(/星期/);
    expect(validateTemplateDraft(draft({ weekdays: [1.5] }))).toMatch(/星期/);
  });

  it("會議與其他一定要有類別;專案工作項一定要有工作項", () => {
    expect(validateTemplateDraft(draft({ categoryId: null }))).toMatch(/類別/);
    expect(validateTemplateDraft(draft({ kind: "project", categoryId: null, itemId: null }))).toMatch(/工作項/);
    expect(validateTemplateDraft(draft({ kind: "project", categoryId: null, itemId: "i1" }))).toBeNull();
  });

  it("共用範本不能指定工作項", () => {
    expect(validateTemplateDraft(draft({ kind: "project", categoryId: null, itemId: "i1", shared: true }))).toMatch(/共用/);
    expect(validateTemplateDraft(draft({ shared: true }))).toBeNull();
  });
});

describe("templateDates", () => {
  it("週一起算:1 = 週一、7 = 週日", () => {
    expect(templateDates("2026-10-05", [1, 3, 7])).toEqual(["2026-10-05", "2026-10-07", "2026-10-11"]);
  });

  it("順序不拘、重複的只算一次,結果由早到晚", () => {
    expect(templateDates("2026-10-05", [5, 1, 5])).toEqual(["2026-10-05", "2026-10-09"]);
  });

  it("跨月跨年也對", () => {
    expect(templateDates("2026-12-28", [1, 4, 5])).toEqual(["2026-12-28", "2026-12-31", "2027-01-01"]);
  });
});

describe("formatWeekdays", () => {
  it("零散的用頓號", () => {
    expect(formatWeekdays([1, 3, 5])).toBe("週一、週三、週五");
    expect(formatWeekdays([2])).toBe("週二");
    expect(formatWeekdays([1, 2])).toBe("週一、週二");
  });

  it("連續三天以上寫成「至」", () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("週一至週五");
    expect(formatWeekdays([3, 4, 5])).toBe("週三至週五");
  });

  it("七天寫每天;亂序也行", () => {
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe("每天");
    expect(formatWeekdays([5, 1, 3])).toBe("週一、週三、週五");
  });
});

describe("describeApplyResult", () => {
  it("只有建立", () => {
    expect(describeApplyResult({ created: 3, existing: 0, failed: [] })).toBe("建立 3 筆");
  });

  it("有重複的、有失敗的都說明", () => {
    expect(describeApplyResult({ created: 2, existing: 1, failed: ["x"] })).toBe(
      "建立 2 筆;另有 1 筆本來就有,沒有重複建立;1 筆建立不起來"
    );
  });
});
