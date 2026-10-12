import { describe, expect, it } from "vitest";
import { PATHWAY_COLORS, pathwayStroke } from "./pathwayStyle";

const stroke = (overrides: Partial<Parameters<typeof pathwayStroke>[0]> = {}) =>
  pathwayStroke({ type: "Walkway", selected: false, outsideBoundary: false, isOverviewZoom: false, pathTool: false, ...overrides });

describe("pathwayStroke", () => {
  it("keeps a Walkway dashed green", () => {
    expect(stroke()).toEqual({ color: PATHWAY_COLORS.walkway, weight: 4, dashArray: "7 6" });
  });

  it("draws a Road solid blue and one step thicker", () => {
    expect(stroke({ type: "Road" })).toEqual({ color: PATHWAY_COLORS.road, weight: 5, dashArray: undefined });
    expect(stroke({ type: "Road", pathTool: true }).weight).toBe(stroke({ pathTool: true }).weight + 1);
  });

  it("reads the Way type whatever its casing and treats anything else as a Walkway", () => {
    expect(stroke({ type: " road " }).color).toBe(PATHWAY_COLORS.road);
    expect(stroke({ type: "Service lane" })).toEqual(stroke());
    expect(stroke({ type: undefined })).toEqual(stroke());
  });

  it("lets selected override the Way type colour, and outside the boundary override both", () => {
    expect(stroke({ type: "Road", selected: true })).toEqual({ color: PATHWAY_COLORS.selected, weight: 6, dashArray: undefined });
    expect(stroke({ type: "Road", selected: true })).toEqual(stroke({ selected: true }));
    expect(stroke({ type: "Road", outsideBoundary: true }).color).toBe(PATHWAY_COLORS.outsideBoundary);
    expect(stroke({ type: "Road", selected: true, outsideBoundary: true }).color).toBe(PATHWAY_COLORS.outsideBoundary);
  });

  it("separates the types by colour alone at overview zoom", () => {
    expect(stroke({ isOverviewZoom: true })).toEqual({ color: PATHWAY_COLORS.walkway, weight: 2, dashArray: undefined });
    expect(stroke({ type: "Road", isOverviewZoom: true })).toEqual({ color: PATHWAY_COLORS.road, weight: 2, dashArray: undefined });
  });
});
