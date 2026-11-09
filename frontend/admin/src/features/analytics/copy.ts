export type ChartCopy = {
  title: string;
  what: string;
  read: Array<{ see: string; means: string; action?: string }>;
  data: string;
};

export const COPY = {
  readiness: {
    title: "Directory readiness",
    what: "Each bar is one check across active places: blue have it, red is missing it. The big number counts places that pass every check that applies to them. Indoor rooms only count for places that hold rooms (not Food or Parking). Click a bar to open those places in Locations.",
    read: [
      { see: "A long red part", means: "many places are missing that one thing.", action: "Click it and work down the list." },
      { see: "Fully ready far below the bars", means: "the gaps are spread across different places, not one bad batch." },
      { see: "Entrance linked is short", means: "those places show on the map but the app cannot route to them.", action: "Link an entrance in the Map Editor." },
    ],
    data: "Places, photos, entrances, rooms (current snapshot, not affected by the time range).",
  },
  closures: {
    title: "Closure impact",
    what: "For each pathway: how many places the app could no longer reach on foot from the Main Gate if it were closed (red), and how many would still be reachable but by a longer walk (grey). Click a bar to open the Map Editor there.",
    read: [
      { see: "Any red", means: "this pathway is the only way in to those places.", action: "Map a second path before closing it, or warn users." },
      { see: "Grey only", means: "people get a detour, nobody is cut off.", action: "Safe to close for maintenance." },
    ],
    data: "Pathways and route nodes (current map).",
  },
  reach: {
    title: "Reach by travel mode",
    what: "Routable places each travel mode can get to from the Main Gate, out of all routable places. Click a bar to list the places it cannot reach.",
    read: [
      { see: "Walking below the line", means: "a place has an entrance but no connected walkway.", action: "Fix it in the Map Editor." },
      { see: "Car or motorcycle far below", means: "either roads are not tagged for that mode, or those places really are walk-only.", action: "Check the listed places; tag roads or link parking." },
    ],
    data: "Pathways and their allowed travel modes (current map).",
  },
  byAccount: {
    title: "Searches by account type",
    what: "Recorded searches split by the searcher's account type. Click a bar to see those accounts.",
    read: [
      { see: "One type dominates", means: "write descriptions and keywords for them first." },
      { see: "Few visitors", means: "visitors may not know the app exists, or skip signing up." },
    ],
    data: "UserHistory joined to account type. Users can delete their history.",
  },
  byDestination: {
    title: "Searches by destination type",
    what: "Recorded searches split by the kind of destination searched for. Click a slice to list that type in Locations.",
    read: [
      { see: "Rooms and offices high", means: "indoor mapping matters; check Indoor rooms above." },
      { see: "Mostly places", means: "outdoor readiness is the priority." },
    ],
    data: "UserHistory joined to the destination's type. Users can delete their history.",
  },
} satisfies Record<string, ChartCopy>;
