export type ChartCopy = {
  title: string;
  what: string;
  read: Array<{ see: string; means: string; action?: string }>;
  data: string;
};

export const COPY = {
  readiness: {
    title: "Missing details",
    what: "Active places missing each detail, the biggest gap first. Each bar is every place the check applies to: red is the places missing it, pale blue the places that have it. Rooms are only expected of places that hold them (not Food or Parking), so that bar is shorter. A map pin counts as present for a place with a point or a footprint. Click the red part for the places missing it, the pale part for the places that have it.",
    read: [
      { see: "A long red part", means: "many places are missing that one thing.", action: "Click it and work down the list." },
      { see: "Entrance linked is red", means: "those places show on the map but the app cannot route to them.", action: "Link an entrance in the Map Editor." },
      { see: "Several short red parts", means: "the gaps are different problems on different places; each check is counted on its own." },
    ],
    data: "Places, photos, text fields, map positions, entrances and rooms (current snapshot, not affected by the time range).",
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
    title: "Reach by travel mode",
    what: "Routable places each travel mode can get to from the Main Gate (blue), and the ones it cannot (grey), out of all routable places. Grey is not an error: a place may be walk-only on purpose. Click the blue part to list the places it reaches, the grey part for the places it cannot.",
    read: [
      { see: "Walking below the line", means: "a place has an entrance but no connected walkway.", action: "Fix it in the Map Editor." },
      { see: "Car or motorcycle well below", means: "either roads are not tagged for that mode, or those places are meant to be walk-only.", action: "Check the listed places; tag roads only where vehicles really can go." },
    ],
    data: "Pathways and their allowed travel modes (current map, not affected by the time range).",
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
  markerGap: {
    title: "Searches for destinations without markers",
    what: "For each destination type, the searches in the range and how many were for a destination with no map marker (red), as counts and a share. A place's marker is its pin or footprint; a room, office, laboratory or restroom has its own optional point. The app still opens an indoor location with no marker at its building and routes to the building, so only the exact spot is missing, unless its building is not on the map either. Click the red part for the searched destinations with no marker, the blue part for those that have one.",
    read: [
      { see: "Places with red", means: "the app cannot show or route to them.", action: "Pin them or draw a footprint in the Map Editor." },
      { see: "Rooms or offices with red", means: "people see the building, not the room.", action: "Use Mark indoor location in the Map Editor." },
      { see: "A small share of a big count", means: "worth fixing before a large share of a handful." },
    ],
    data: "Search history joined to active places and indoor locations. Searches for inactive or deleted destinations are not counted. A search is not a visit.",
  },
} satisfies Record<string, ChartCopy>;
