/** Categorical slots in fixed order (reference dataviz palette). Student/Teacher/Visitor match lib/accountType. */
export const SERIES = {
  blue: "#2a78d6",
  orange: "#eb6834",
  aqua: "#1baf7a",
  yellow: "#eda100",
  magenta: "#e87ba4",
} as const;

export const INK = { primary: "#151a17", secondary: "#4c5751", muted: "#64716a", grid: "#e7ece9", surface: "#ffffff" } as const;

export const AXIS_TICK = { fill: INK.muted, fontSize: 11 } as const;
export const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid #dbe5df",
  boxShadow: "0 4px 14px #0000001a",
  fontSize: 12,
} as const;
