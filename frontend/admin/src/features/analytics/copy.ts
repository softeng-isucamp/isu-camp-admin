export type ChartCopy = {
  title: string;
  /** One line: the question this chart answers. */
  question: string;
  what: string;
  read: Array<{ see: string; means: string; action?: string }>;
  data: string;
};

export const COPY = {
  readiness: {
    title: "Directory readiness",
    question: "How many places can people actually find, recognise and navigate to?",
    what: "Each bar counts active places that pass one check, on its own. The big number counts places that pass every check that applies to them. Indoor rooms only count for places that hold rooms (not Food or Parking).",
    read: [
      { see: "A short bar", means: "many places are missing that one thing.", action: "Click it to list them, then open each one." },
      { see: "Fully ready far below the bars", means: "the gaps are spread across different places, not one bad batch." },
      { see: "Entrance linked is short", means: "those places show on the map but the app cannot route to them.", action: "Link an entrance in the Map Editor." },
    ],
    data: "Places, photos, entrances, rooms (current snapshot, not affected by the time range).",
  },
  attention: {
    title: "Places needing attention",
    question: "Which place should staff fix first?",
    what: "Places with at least one gap, most searched first. The bar is how often people searched for it; the tags say exactly what is missing. Each tag opens the screen where you fix it.",
    read: [
      { see: "Top rows", means: "people want these places most and still hit a gap.", action: "Start here." },
      { see: "No entrance / No map pin", means: "the app cannot take people there.", action: "Opens the Map Editor." },
      { see: "No photo / description / keywords", means: "people may not find or recognise it.", action: "Opens the place in Locations." },
      { see: "No rooms", means: "people can reach the building but not a room inside.", action: "Opens Add Indoor Location for that building." },
    ],
    data: "Recorded searches in the selected range + the same checks as Directory readiness. Search counts are small and users can delete their history, so treat order as a hint.",
  },
  closures: {
    title: "Closure impact",
    question: "What breaks if we close this pathway?",
    what: "For each pathway: how many places the app could no longer reach on foot from the Main Gate if it were closed (red), and how many would still be reachable but by a longer walk (grey).",
    read: [
      { see: "Any red", means: "this pathway is the only way in to those places.", action: "Map a second path before closing it, or warn users." },
      { see: "Grey only", means: "people get a detour, nobody is cut off.", action: "Safe to close for maintenance." },
    ],
    data: "Pathways and route nodes (current map).",
  },
  reach: {
    title: "Reach by travel mode",
    question: "Which travel modes can the app promise?",
    what: "Routable places each travel mode can get to from the Main Gate, out of all routable places.",
    read: [
      { see: "Walking below the line", means: "a place has an entrance but no connected walkway.", action: "Fix it in the Map Editor." },
      { see: "Car or motorcycle far below", means: "either roads are not tagged for that mode, or those places really are walk-only.", action: "Check the listed places; tag roads or link parking." },
    ],
    data: "Pathways and their allowed travel modes (current map).",
  },
  byAccount: {
    title: "Searches by account type",
    question: "Who is the app serving?",
    what: "Recorded searches split by the searcher's account type.",
    read: [
      { see: "One type dominates", means: "write descriptions and keywords for them first." },
      { see: "Few visitors", means: "visitors may not know the app exists, or skip signing up." },
    ],
    data: "UserHistory joined to account type. Users can delete their history.",
  },
  byDestination: {
    title: "Searches by destination type",
    question: "What are people looking for?",
    what: "Recorded searches split by the kind of destination searched for.",
    read: [
      { see: "Rooms and offices high", means: "indoor mapping matters; check Indoor rooms above." },
      { see: "Mostly places", means: "outdoor readiness is the priority." },
    ],
    data: "UserHistory joined to the destination's type. Users can delete their history.",
  },
} satisfies Record<string, ChartCopy>;
