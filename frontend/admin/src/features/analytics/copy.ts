export type ChartCopy = {
  title: string;
  what: string;
  read: Array<{ see: string; means: string; action?: string }>;
  data: string;
};

export const COPY = {
  readiness: {
    title: "Missing details",
    what: "Active places missing each detail, the biggest gap first. Each bar is every place the check applies to: red is the places missing it, pale blue the places that have it. Indoor locations (rooms, offices, laboratories and restrooms) are only expected of places that can hold them (not Food or Parking), so that bar is shorter. Description and map position are not listed: every location form requires a description, and a place's map position comes from its footprint in the Map Editor. Whether searched indoor locations have a marker is the last chart on this page. Click the red part for the places missing it, the pale part for the places that have it.",
    read: [
      { see: "A long red part", means: "many places are missing that one thing.", action: "Click it and work down the list." },
      { see: "Entrance linked is red", means: "those places show on the map but the app cannot route to them.", action: "Link an entrance in the Map Editor." },
      { see: "Several short red parts", means: "the gaps are different problems on different places; each check is counted on its own." },
    ],
    data: "Places, photos, search keywords, entrances and indoor locations (current snapshot, not affected by the time range).",
  },
  closures: {
    title: "Closure impact",
    what: "For each pathway: how many places the app could no longer reach on foot from the Main Gate if it were closed (red), and how many would still be reachable but only by a longer walk (grey). Places are counted equally, whether or not anyone searches for them. Click the red or grey part to list those places in Locations; click the pathway name to open it in the Map Editor.",
    read: [
      { see: "Any red", means: "this pathway is the only way in to those places.", action: "Map a second path before closing it, or warn users." },
      { see: "Grey only", means: "people get a detour and nobody is cut off, but that is not proof that closing it is safe.", action: "Check the listed places before closing it." },
    ],
    data: "Pathways and route nodes (current map, walking only, not affected by the time range).",
  },
  reach: {
    title: "Reach by access type",
    what: "Routable places that people on foot (Walking) or in a vehicle (Vehicle: bicycle, motorcycle or car, which share one pathway permission) can get to from the Main Gate (blue), and the ones they cannot (grey), out of all routable places. Grey is not an error: a place may be walk-only on purpose. Click the blue part to list the places it reaches, the grey part for the places it cannot.",
    read: [
      { see: "Walking below the line", means: "a place has an entrance but no connected walkway.", action: "Fix it in the Map Editor." },
      { see: "Vehicle well below", means: "either roads are not marked Vehicle, or those places are meant to be walk-only.", action: "Check the listed places; allow Vehicle only on pathways where vehicles really can go." },
    ],
    data: "Pathways and their allowed access types, Walking and Vehicle (current map, not affected by the time range).",
  },
  activity: {
    title: "Search activity",
    what: "Recorded searches over the selected range, stacked by the searcher's account type: one column per day, or per week for all time and for a year. Searches are not visits, arrivals, unique people or route attempts. Click an account type in the legend to open those accounts in User Management.",
    read: [
      { see: "Tall columns", means: "busy days or weeks; compare them with when you update the directory." },
      { see: "One colour dominates", means: "write descriptions and keywords for that group first." },
      { see: "Flat or empty", means: "the app is not being used much, or users deleted their history." },
    ],
    data: "Search history joined to account type. Users can delete their history; searches from deleted accounts count in the total but in no account type.",
  },
  indoorMarkers: {
    title: "Indoor marker coverage",
    what: "Active indoor locations (rooms, laboratories, offices and restrooms) with their own map marker (blue) and without one (red), counting every location whether or not anyone has searched for it. The app still opens an unmarked indoor location at its building and routes to the building, so only the exact spot is missing. Places are not listed: their position comes from their footprint in the Map Editor. Click the red part for the locations with no marker, the blue part for those that have one.",
    read: [
      { see: "A long red part", means: "people are shown the building, not the room, office or restroom.", action: "Use Mark indoor location in the Map Editor." },
      { see: "Mostly blue", means: "indoor locations of that type are already marked." },
      { see: "Which to mark first", means: "this chart ignores searches on purpose; check Search activity and Locations to decide the order." },
    ],
    data: "Active indoor locations under active places (current snapshot, not affected by the time range). A marker is the location's own coordinates.",
  },
} satisfies Record<string, ChartCopy>;
