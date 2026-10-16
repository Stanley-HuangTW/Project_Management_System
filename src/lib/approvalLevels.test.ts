import { describe, expect, it } from "vitest";
import {
  approvalProgress,
  clampLevels,
  describeApprovalProgress,
  levelLabel,
  levelsOf,
  levelToSign,
  managerChain,
  requiredLevels,
} from "@/lib/approvalLevels";

const users = [
  { id: "staff", supervisorId: "lead" },
  { id: "lead", supervisorId: "manager" },
  { id: "manager", supervisorId: "director" },
  { id: "director", supervisorId: null },
];

describe("managerChain", () => {
  it("由近到遠:直屬、二階、三階…", () => {
    expect(managerChain(users, "staff")).toEqual(["lead", "manager", "director"]);
  });

  it("可以限制最多回幾階", () => {
    expect(managerChain(users, "staff", 2)).toEqual(["lead", "manager"]);
  });

  it("最上層的人沒有主管", () => {
    expect(managerChain(users, "director")).toEqual([]);
  });

  it("成環也停得下來", () => {
    const loop = [
      { id: "a", supervisorId: "b" },
      { id: "b", supervisorId: "a" },
    ];
    expect(managerChain(loop, "a")).toEqual(["b"]);
  });
});

describe("levelLabel / clampLevels", () => {
  it("稱呼", () => {
    expect(levelLabel(1)).toBe("直屬主管");
    expect(levelLabel(2)).toBe("二階主管");
    expect(levelLabel(9)).toBe("9 階主管");
  });

  it("設定值整理成 1 到 5", () => {
    expect(clampLevels(0)).toBe(1);
    expect(clampLevels("3")).toBe(3);
    expect(clampLevels(99)).toBe(5);
    expect(clampLevels(undefined)).toBe(1);
  });
});

describe("requiredLevels", () => {
  it("設定幾階就簽幾階,但不會超過他頭上實際有的階數", () => {
    expect(requiredLevels(3, 2)).toBe(2);
    expect(requiredLevels(1, 3)).toBe(1);
  });

  it("沒有主管就是 0", () => {
    expect(requiredLevels(0, 2)).toBe(0);
  });
});

describe("approvalProgress", () => {
  it("都還沒簽", () => {
    expect(approvalProgress(3, 2, [])).toEqual({ required: 2, done: [], missing: [1, 2], complete: false });
  });

  it("簽了一階", () => {
    expect(approvalProgress(3, 2, [{ level: 1 }])).toEqual({ required: 2, done: [1], missing: [2], complete: false });
  });

  it("需要的階都簽了才算完成;超過需要的階不影響", () => {
    expect(approvalProgress(3, 2, [{ level: 1 }, { level: 2 }]).complete).toBe(true);
    expect(approvalProgress(3, 1, [{ level: 1 }, { level: 3 }]).complete).toBe(true);
  });

  it("設定 1 階 = 直屬主管一簽就完成(跟沒有多階的時候一樣)", () => {
    expect(approvalProgress(3, 1, [{ level: 1 }]).complete).toBe(true);
  });

  it("沒有主管就沒有這一條路,不會被當成完成", () => {
    expect(approvalProgress(0, 2, []).complete).toBe(false);
  });
});

describe("levelToSign", () => {
  const chain = ["lead", "manager", "director"];

  it("各階同時送審:二階主管不用等直屬主管就能簽", () => {
    expect(levelToSign(chain, 2, [], "manager")).toBe(2);
    expect(levelToSign(chain, 2, [], "lead")).toBe(1);
  });

  it("已經簽過的那一階不能再簽", () => {
    expect(levelToSign(chain, 2, [{ level: 1 }], "lead")).toBeNull();
  });

  it("超過設定階數的主管不用簽", () => {
    expect(levelToSign(chain, 2, [], "director")).toBeNull();
  });

  it("不在主管鏈上的人不能簽", () => {
    expect(levelToSign(chain, 2, [], "stranger")).toBeNull();
  });
});

describe("describeApprovalProgress", () => {
  const nameOf = (id: string) => ({ lead: "王主管", manager: "陳經理", director: "林處長" })[id as "lead"] ?? id;
  const chain = ["lead", "manager", "director"];

  it("只要一階就不用特別說明", () => {
    expect(describeApprovalProgress({ chain, configured: 1, steps: [], nameOf })).toBeNull();
  });

  it("兩階都還沒簽:列出尚待的人", () => {
    expect(describeApprovalProgress({ chain, configured: 2, steps: [], nameOf })).toBe(
      "需 2 階主管同意 — 尚待:直屬主管 王主管、二階主管 陳經理"
    );
  });

  it("簽了一階:已簽與尚待分開寫", () => {
    expect(describeApprovalProgress({ chain, configured: 2, steps: [{ level: 1, approverId: "lead" }], nameOf })).toBe(
      "需 2 階主管同意 — 已簽:直屬主管 王主管 — 尚待:二階主管 陳經理"
    );
  });

  it("設定的階數比實際主管多:只算實際有的", () => {
    expect(describeApprovalProgress({ chain: ["lead"], configured: 3, steps: [], nameOf })).toBeNull();
  });
});

describe("代簽(副主管 / 可代簽的職能)", () => {
  const chain = ["lead", "manager", "director"];
  // deputy 可以代簽 lead;both 可以代簽 lead,本人又是二階主管 manager
  const delegations = new Map<string, string[]>([
    ["deputy", ["lead"]],
    ["manager", ["lead"]],
  ]);

  it("levelsOf:本人在鏈上的階,加上代簽的主管所在的階", () => {
    expect(levelsOf(chain, "lead")).toEqual([1]);
    expect(levelsOf(chain, "deputy", delegations)).toEqual([1]);
    expect(levelsOf(chain, "manager", delegations)).toEqual([1, 2]);
    expect(levelsOf(chain, "stranger", delegations)).toEqual([]);
    expect(levelsOf(chain, "deputy")).toEqual([]); // 沒帶代簽關係就沒有
  });

  it("副主管可以簽直屬主管那一階", () => {
    expect(levelToSign(chain, 2, [], "deputy", delegations)).toBe(1);
  });

  it("直屬主管那一階已經有人簽了,副主管就不用再簽", () => {
    expect(levelToSign(chain, 2, [{ level: 1 }], "deputy", delegations)).toBeNull();
  });

  it("代簽的主管不在需要的階數內,就簽不了", () => {
    expect(levelToSign(chain, 1, [], "manager", delegations)).toBe(1); // 設一階:二階主管本人不算,但他代簽直屬那一階
    expect(levelToSign(["lead", "manager"], 1, [{ level: 1 }], "manager", delegations)).toBeNull();
  });

  it("能簽好幾階時,先簽最近的、還沒簽的", () => {
    expect(levelToSign(chain, 2, [], "manager", delegations)).toBe(1);
    expect(levelToSign(chain, 2, [{ level: 1 }], "manager", delegations)).toBe(2);
    expect(levelToSign(chain, 2, [{ level: 1 }, { level: 2 }], "manager", delegations)).toBeNull();
  });
});
