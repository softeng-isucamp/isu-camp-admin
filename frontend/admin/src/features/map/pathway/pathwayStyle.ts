import { normalizePathwayWayType } from "../../../types";

/** Stroke colours of a Pathway on the map. Way type picks the base colour; the states override it. */
export const PATHWAY_COLORS = {
  walkway: "#005931",
  road: "#1d4ed8",
  selected: "#e67e22",
  outsideBoundary: "#b42318",
} as const;

interface PathwayStrokeInput {
  /** The Pathway's Way type, read through the app's vocabulary; anything that is not a Road is drawn as a Walkway. */
  type: string | undefined;
  selected: boolean;
  outsideBoundary: boolean;
  isOverviewZoom: boolean;
  /** The pathway tool is active, which thickens every Pathway. */
  pathTool: boolean;
}

/**
 * How a Pathway is stroked. Only Way type sets the base look: a Walkway is dashed green and a
 * Road is solid blue and one step thicker. Outside the campus boundary is red, then selected
 * is orange, and both keep their own weight and dash. At overview zoom every line is thin and
 * solid, so only the colour tells the types apart.
 */
export function pathwayStroke({ type, selected, outsideBoundary, isOverviewZoom, pathTool }: PathwayStrokeInput) {
  const road = normalizePathwayWayType(type) === "Road";
  const color = outsideBoundary
    ? PATHWAY_COLORS.outsideBoundary
    : selected
      ? PATHWAY_COLORS.selected
      : road ? PATHWAY_COLORS.road : PATHWAY_COLORS.walkway;
  const base = pathTool ? 5 : 4;
  return {
    color,
    weight: selected ? 6 : isOverviewZoom ? 2 : road ? base + 1 : base,
    dashArray: selected || isOverviewZoom || road ? undefined : "7 6",
  };
}
