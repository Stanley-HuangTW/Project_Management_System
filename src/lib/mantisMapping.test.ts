import { describe, expect, it } from "vitest";
import { collectMantisUsers, mapMantisIssue, statusToRisk, severityToImpact } from "./mantis";
import {
  DEFAULT_ENUMS,
  defaultMapping,
  effectiveSeverityRows,
  effectiveStatusRows,
  enumsFromMantis,
  impactFromMantis,
  isWriteEnabled,
  parseEnumString,
  parseMapping,
  severityToMantis,
  statusFromMantis,
  statusToMantis,
  validateMapping,
} from "./mantisMapping";

describe("defaultMapping", () => {
  it("reads like the old hard-coded rules and never writes back", () => {
    const m = defaultMapping();
    for (const id of [10, 20, 30, 40, 50, 80, 90]) expect(statusFromMantis(m, id)).toBe(statusToRisk(id));
    for (const id of [10, 20, 30, 40, 50, 60, 70, 80]) expect(impactFromMantis(m, id)).toBe(severityToImpact(id));
    expect(m.writeBack.enabled).toBe(false);
    expect(isWriteEnabled(m, "status")).toBe(false);
  });

  it("writes open / in-progress / closed to new / assigned / resolved, and leaves 待審核 alone", () => {
    const m = defaultMapping();
    expect(statusToMantis(m, "OPEN")).toEqual({ id: 10, name: "new" });
    expect(statusToMantis(m, "MITIGATING")).toEqual({ id: 50, name: "assigned" });
    expect(statusToMantis(m, "CLOSED")).toEqual({ id: 80, name: "resolved" });
    expect(statusToMantis(m, "PENDING_REVIEW")).toBeNull();
    expect(m.resolutionOut).toEqual({ id: 20, name: "fixed" });
  });

  it("writes impact 1–5 to trivial / tweak / minor / major / crash, and each one reads back as the same impact", () => {
    const m = defaultMapping();
    const names = [1, 2, 3, 4, 5].map((i) => severityToMantis(m, i)?.name);
    expect(names).toEqual(["trivial", "tweak", "minor", "major", "crash"]);
    for (const i of [1, 2, 3, 4, 5]) expect(impactFromMantis(m, severityToMantis(m, i)!.id)).toBe(i);
  });

  it("returns a copy: changing one does not change the next", () => {
    const a = defaultMapping();
    a.enums.status.push({ id: 99, name: "x" });
    a.statusOut.OPEN = { id: 1, name: "y" };
    expect(defaultMapping().enums.status).toHaveLength(DEFAULT_ENUMS.status.length);
    expect(defaultMapping().statusOut.OPEN).toEqual({ id: 10, name: "new" });
  });
});

describe("the tables win over the default thresholds", () => {
  const m = parseMapping({ statusIn: { "20": "MITIGATING", "90": "CLOSED", "80": "MITIGATING" }, severityIn: { "40": 4, "80": 5 } });

  it("maps a configured Mantis status, and falls back to the threshold for the rest", () => {
    expect(statusFromMantis(m, 20)).toBe("MITIGATING");
    expect(statusFromMantis(m, 80)).toBe("MITIGATING");
    expect(statusFromMantis(m, 10)).toBe("OPEN");
    expect(statusFromMantis(m, 50)).toBe("MITIGATING");
    expect(statusFromMantis(m, undefined)).toBe("OPEN");
  });

  it("maps a configured severity, and falls back for the rest", () => {
    expect(impactFromMantis(m, 40)).toBe(4);
    expect(impactFromMantis(m, 50)).toBe(3);
    expect(impactFromMantis(m, undefined)).toBe(3);
  });

  it("lists every Mantis value with what it currently maps to and whether that is explicit", () => {
    const rows = effectiveStatusRows(m);
    expect(rows.find((r) => r.entry.id === 20)).toMatchObject({ status: "MITIGATING", explicit: true });
    expect(rows.find((r) => r.entry.id === 10)).toMatchObject({ status: "OPEN", explicit: false });
    expect(effectiveSeverityRows(m).find((r) => r.entry.id === 40)).toMatchObject({ impact: 4, explicit: true });
  });

  it("is used when reading an issue", () => {
    const issue = { id: 7, status: { id: 20, name: "feedback" }, severity: { id: 40, name: "tweak" } };
    expect(mapMantisIssue(issue, "https://m.example").status).toBe("OPEN");
    expect(mapMantisIssue(issue, "https://m.example", m)).toMatchObject({ status: "MITIGATING", impact: 4 });
  });
});

describe("parseMapping is forgiving", () => {
  it("gives the defaults for null, garbage and an empty object", () => {
    for (const bad of [null, undefined, 5, "x", [], {}]) expect(parseMapping(bad)).toEqual(defaultMapping());
  });

  it("drops bad entries instead of failing, and keeps the good ones", () => {
    const m = parseMapping({
      statusIn: { "20": "OPEN", "x": "OPEN", "30": "PENDING_REVIEW", "40": "nope" },
      severityIn: { "10": 9, "20": 2, "30": 1.5 },
      handlerOverrides: { u1: 12, u2: -1, u3: "x" },
      statusOut: { OPEN: { id: 10, name: "new" }, CLOSED: { id: "x" } },
      writeBack: { enabled: true, fields: ["status", "bogus", "content"] },
    });
    expect(m.statusIn).toEqual({ "20": "OPEN" });
    expect(m.severityIn).toEqual({ "20": 2 });
    expect(m.handlerOverrides).toEqual({ u1: 12 });
    expect(m.statusOut).toEqual({ OPEN: { id: 10, name: "new" } });
    expect(m.writeBack).toEqual({ enabled: true, fields: ["status", "content"] });
  });

  it("an empty statusOut means nothing is written for any status", () => {
    const m = parseMapping({ statusOut: {} });
    expect(statusToMantis(m, "CLOSED")).toBeNull();
  });
});

describe("validateMapping", () => {
  it("accepts the defaults and a sensible edit", () => {
    expect(validateMapping(defaultMapping())).toHaveProperty("mapping");
    const edited = { ...defaultMapping(), statusIn: { "20": "MITIGATING" }, writeBack: { enabled: true, fields: ["status"] } };
    expect(validateMapping(edited)).toHaveProperty("mapping");
  });

  it("refuses entries that would be silently dropped", () => {
    const m = { ...defaultMapping(), statusIn: { "20": "PENDING_REVIEW" } };
    expect(validateMapping(m)).toHaveProperty("error");
    expect(validateMapping({ ...defaultMapping(), severityIn: { "10": 9 } })).toHaveProperty("error");
    expect(validateMapping({ ...defaultMapping(), handlerOverrides: { u1: -3 } })).toHaveProperty("error");
    expect(validateMapping("x")).toHaveProperty("error");
  });

  it("write-back on needs at least one field, and status write-back needs a place to put 已結案", () => {
    expect(validateMapping({ ...defaultMapping(), writeBack: { enabled: true, fields: [] } })).toHaveProperty("error");
    const noClosed = { ...defaultMapping(), statusOut: { OPEN: { id: 10, name: "new" } }, writeBack: { enabled: true, fields: ["status"] } };
    expect(validateMapping(noClosed)).toHaveProperty("error");
    const noStatusField = { ...noClosed, writeBack: { enabled: true, fields: ["handler"] } };
    expect(validateMapping(noStatusField)).toHaveProperty("mapping");
  });
});

describe("Mantis enums from /config and /lang", () => {
  it("parses '10:new,20:feedback' and skips pieces it cannot read", () => {
    expect(parseEnumString("10:new, 20:feedback ,bad,x:y,30:")).toEqual([
      { id: 10, name: "new" },
      { id: 20, name: "feedback" },
    ]);
  });

  it("takes ids and names from config, and the translated text from lang", () => {
    const enums = enumsFromMantis(
      { configs: [{ option: "status_enum_string", value: "10:new,50:assigned,95:on hold" }] },
      { strings: [{ name: "status_enum_string", localized: "10:新建,50:已指派,95:on hold" }] }
    );
    expect(enums.status).toEqual([
      { id: 10, name: "new", label: "新建" },
      { id: 50, name: "assigned", label: "已指派" },
      { id: 95, name: "on hold" },
    ]);
    // 沒讀到的類別用 Mantis 內建的
    expect(enums.severity).toEqual(DEFAULT_ENUMS.severity);
  });

  it("falls back to the built-in lists when the response is empty or not what we expect", () => {
    expect(enumsFromMantis(null)).toEqual(DEFAULT_ENUMS);
    expect(enumsFromMantis({ configs: [{ option: "status_enum_string", value: "garbage" }] })).toEqual(DEFAULT_ENUMS);
  });
});

describe("mapMantisIssue keeps the Mantis ids", () => {
  it("fills the status, severity, priority and handler ids", () => {
    const mapped = mapMantisIssue(
      {
        id: 12,
        status: { id: 50, name: "assigned" },
        severity: { id: 60, name: "major" },
        priority: { id: 40, name: "high" },
        handler: { id: 7, name: "emei", email: "EMEI@Example.com" },
      },
      "https://m.example"
    );
    expect(mapped).toMatchObject({ mantisStatusId: 50, mantisSeverityId: 60, mantisPriorityId: 40, mantisHandlerId: 7, handlerEmail: "emei@example.com" });
  });

  it("leaves them null when Mantis does not send them", () => {
    expect(mapMantisIssue({ id: 1 }, "https://m.example")).toMatchObject({
      mantisStatusId: null,
      mantisSeverityId: null,
      mantisPriorityId: null,
      mantisHandlerId: null,
    });
  });
});

describe("collectMantisUsers", () => {
  it("collects handlers, reporters and note authors once per id, filling in what an earlier mention lacked", () => {
    const users = collectMantisUsers([
      { id: 1, handler: { id: 7, name: "emei" }, reporter: { id: 9, name: "qa", real_name: "黃雅婷", email: "QA@x.com" } },
      { id: 2, handler: { id: 7, real_name: "陳美玲", email: "emei@x.com" }, notes: [{ reporter: { id: 11, name: "me" } }, { reporter: { name: "noid" } }] },
    ]);
    expect(users).toEqual([
      { id: 7, name: "emei", realName: "陳美玲", email: "emei@x.com" },
      { id: 9, name: "qa", realName: "黃雅婷", email: "qa@x.com" },
      { id: 11, name: "me", realName: "", email: "" },
    ]);
  });
});
