import { describe, expect, it } from "vitest";
import { orderProtoCells } from "./protoRowOrder";
import { summariseProtoPlan } from "./protoPlan";

const cell = (product: string, unit: string, phaseId = "p1", qty = 1) => ({ product, unit, phaseId, qty, note: "" });
const unitsOf = (cells: { product: string; unit: string }[]) => [...new Set(cells.map((c) => `${c.product}/${c.unit}`))];

describe("orderProtoCells", () => {
  const created = [cell("M3", "EE"), cell("M3", "ATD"), cell("M3", "QA"), cell("充電站", "EE"), cell("充電站", "SALES")];

  it("keeps creation order when nothing was dragged", () => {
    expect(orderProtoCells(created, [])).toEqual(created);
  });

  it("orders the rows of one product by the dragged order", () => {
    const orders = [
      { product: "M3", unit: "QA", order: 0 },
      { product: "M3", unit: "EE", order: 1 },
      { product: "M3", unit: "ATD", order: 2 },
    ];
    expect(unitsOf(orderProtoCells(created, orders))).toEqual(["M3/QA", "M3/EE", "M3/ATD", "充電站/EE", "充電站/SALES"]);
  });

  it("never moves a product relative to the others", () => {
    const orders = [
      { product: "充電站", unit: "SALES", order: 0 },
      { product: "充電站", unit: "EE", order: 1 },
    ];
    expect(unitsOf(orderProtoCells(created, orders))).toEqual(["M3/EE", "M3/ATD", "M3/QA", "充電站/SALES", "充電站/EE"]);
  });

  it("puts rows nobody dragged yet after the dragged ones, in creation order", () => {
    const orders = [{ product: "M3", unit: "QA", order: 0 }];
    expect(unitsOf(orderProtoCells(created, orders))).toEqual(["M3/QA", "M3/EE", "M3/ATD", "充電站/EE", "充電站/SALES"]);
  });

  it("keeps all the cells of a row together, in their own order", () => {
    const cells = [cell("M3", "EE", "p1"), cell("M3", "ATD", "p1"), cell("M3", "EE", "p2"), cell("M3", "ATD", "p2")];
    const ordered = orderProtoCells(cells, [
      { product: "M3", unit: "ATD", order: 0 },
      { product: "M3", unit: "EE", order: 1 },
    ]);
    expect(ordered.map((c) => `${c.unit}@${c.phaseId}`)).toEqual(["ATD@p1", "ATD@p2", "EE@p1", "EE@p2"]);
  });

  it("ignores order records whose row no longer exists", () => {
    expect(orderProtoCells(created, [{ product: "M3", unit: "已刪除", order: 0 }])).toEqual(created);
  });

  it("makes summariseProtoPlan list the rows in the dragged order", () => {
    const orders = [
      { product: "M3", unit: "QA", order: 0 },
      { product: "M3", unit: "ATD", order: 1 },
      { product: "M3", unit: "EE", order: 2 },
    ];
    const summary = summariseProtoPlan(["p1"], orderProtoCells(created, orders));
    expect(summary.products.map((p) => p.product)).toEqual(["M3", "充電站"]);
    expect(summary.products[0].rows.map((r) => r.unit)).toEqual(["QA", "ATD", "EE"]);
  });
});
