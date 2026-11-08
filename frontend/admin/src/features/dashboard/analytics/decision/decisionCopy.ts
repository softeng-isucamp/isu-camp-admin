export type PillTone = "go" | "warn" | "no";

export type ChartCopy = {
  title: string;
  /** One line: the decision this chart supports. */
  decision: string;
  what: string;
  /** [if you see, it means ... do ...] */
  read: Array<{ see: string; means: string; action?: string }>;
  pills: Array<{ tone: PillTone; text: string }>;
  data: string;
};

export type GroupCopy = {
  id: string;
  name: string;
  tag: string;
  sub: string;
  cards: ChartCopy[];
};

/** Wording from the approved "grouped" mockup. Each group's first card is its #1. */
export const DECISION_GROUPS: GroupCopy[] = [
  {
    id: "both",
    name: "Both: what people want vs what is ready",
    tag: "Usable today · sharper as usage grows",
    sub: "These put demand and readiness on the same chart, so they answer “what should we work on first?” directly.",
    cards: [
      {
        title: "Fix-first matrix",
        decision: "Which place does staff fix this week?",
        what: "Each dot is a place. Further right means more people searched for it. Higher up means more of its information is ready: photo, description, linked entrance (so it can be navigated to) and indoor rooms.",
        read: [
          { see: "Red dots, bottom right", means: "many people want this place but it is not ready.", action: "Fix these first; it is the biggest payoff per hour of work." },
          { see: "Top right", means: "popular and ready.", action: "Just keep it up to date." },
          { see: "Bottom left", means: "not ready, but nobody looks for it.", action: "Leave it for later, or decide it never needs routing (e.g. an oval or a parking lot)." },
          { see: "Top left", means: "ready but rarely searched.", action: "Either it is fine, or people don’t know it exists." },
        ],
        pills: [{ tone: "go", text: "Strongest decision" }, { tone: "go", text: "Data exists today" }],
        data: "UserHistory + Place completeness + entrance link",
      },
      {
        title: "Indoor demand vs indoor coverage",
        decision: "Which building’s rooms do we map next?",
        what: "Buildings ranked by how many people navigate to them. Red means no rooms are mapped inside it yet; blue means rooms are mapped.",
        read: [
          { see: "Long red bar", means: "many people go to this building but can’t find a room inside it.", action: "Map its rooms next." },
          { see: "Long blue bar", means: "indoor mapping is being used.", action: "Keep room info current." },
          { see: "Short blue bars", means: "rooms were mapped where few people go.", action: "Don’t expand indoor mapping there yet." },
        ],
        pills: [{ tone: "go", text: "Clear next step" }, { tone: "warn", text: "Indoor only" }],
        data: "UserHistory.Building_id + floors/rooms per Place",
      },
      {
        title: "Effort vs demand",
        decision: "Which popular place is overdue for an admin check?",
        what: "For each place: on the left, how many times admins edited it; on the right, how many people searched for it.",
        read: [
          { see: "Long right, tiny left (red)", means: "popular places that admins rarely touch.", action: "Schedule a check of their info." },
          { see: "Long left, tiny right", means: "lots of admin time where few people go.", action: "Fine if the place is new; otherwise effort is misplaced." },
          { see: "Very long left bar", means: "could be rework (editing the same thing again and again).", action: "Look at the activity log." },
        ],
        pills: [{ tone: "go", text: "Novel angle" }, { tone: "warn", text: "More edits ≠ better data" }],
        data: "audit_log + UserHistory",
      },
    ],
  },
  {
    id: "readiness",
    name: "Campus readiness: what admins have mapped",
    tag: "Reliable today, needs no users",
    sub: "Built only from the Places, entrances, pathways and rooms in the admin portal. Answers “is the campus map good enough for people to use?”.",
    cards: [
      {
        title: "Where places drop out",
        decision: "What kind of data work do we assign next?",
        what: "Starts with all active places. Each bar counts the places that pass that check and every check above it. A big step down shows where the work is stuck.",
        read: [
          { see: "Big drop at “Routable”", means: "entrances aren’t linked to pathways, so the app refuses to navigate there.", action: "Assign entrance linking in the Map Editor before anything else." },
          { see: "Drop at “Has photo”", means: "a photo drive is needed.", action: "Cheap; can go to student assistants." },
          { see: "Tiny “Has indoor rooms”", means: "indoor mapping has barely started.", action: "Decide if it is in scope this semester." },
          { see: "Bars almost level", means: "the map is complete.", action: "Move attention to the User App charts." },
        ],
        pills: [{ tone: "go", text: "Clear at a glance" }, { tone: "go", text: "Works with zero usage" }],
        data: "Place, route node, photo and room tables",
      },
      {
        title: "Single points of failure",
        decision: "Which path is risky to close?",
        what: "Each bar is one pathway. Its length is how many place-to-place walking routes break if that pathway is closed.",
        read: [
          { see: "Long red bar", means: "closing it cuts places off.", action: "Before approving a closure, announce it and mark another way in; long-term, add a second link." },
          { see: "Short bar", means: "closing it only makes some trips a bit longer.", action: "Safe to close with a simple notice." },
          { see: "All bars short", means: "the network has backup routes everywhere.", action: "Nothing to do." },
        ],
        pills: [{ tone: "go", text: "Real what-if" }, { tone: "warn", text: "Pathway names need to be clear" }],
        data: "Pathways + route nodes (route simulation)",
      },
      {
        title: "Reach by travel mode",
        decision: "Which travel modes can we promise users?",
        what: "From the main gate, how many of the routable places each travel mode can reach. Each square is one place.",
        read: [
          { see: "Car far below walking", means: "roads aren’t tagged for vehicles, or there are no drop-off points.", action: "Tag the missing roads, or tell users vehicle routing is limited." },
          { see: "Walking below the total", means: "a place is disconnected from the network.", action: "Fix its pathway in the Map Editor." },
          { see: "All modes equal", means: "every mode the app offers really works." },
        ],
        pills: [{ tone: "go", text: "Clear at a glance" }, { tone: "warn", text: "Only matters if vehicle routing is promoted" }],
        data: "Pathways + allowed modes + entrances",
      },
    ],
  },
  {
    id: "usage",
    name: "User App: what people do in the app",
    tag: "Gets better as usage grows",
    sub: "Built from the search/navigation history the User App saves. Today this is thin, and users can delete their own history, so read these as early signals.",
    cards: [
      {
        title: "Quietest-hours heatmap",
        decision: "When do we close a path, edit the map or run a backup?",
        what: "Each square is one hour of one weekday. Darker means more people started navigating at that time. The outlined block is the quietest window.",
        read: [
          { see: "Dark band on weekday mornings", means: "students navigating to their first classes.", action: "Don’t close paths or publish map changes then." },
          { see: "Light block (outlined)", means: "the safest window.", action: "Schedule closures, map edits and backups here." },
          { see: "Dark on a usually quiet day", means: "an event is happening.", action: "Check what was searched and prepare those places." },
          { see: "Everything pale", means: "too few users yet.", action: "Read it as “not enough data”, not “campus is empty”." },
        ],
        pills: [{ tone: "go", text: "Concrete action" }, { tone: "warn", text: "Sparse until usage grows" }],
        data: "UserHistory.created_at",
      },
      {
        title: "Movers this month",
        decision: "Which places need a check before the next rush?",
        what: "Each line is a place. The left end is last month’s searches and the right end is this month’s. A steep climb means sudden demand.",
        read: [
          { see: "Steep rise at Registrar/Cashier", means: "seasonal rush (enrollment, payments).", action: "Check their hours, photos and directions before the next rush." },
          { see: "Rise with no obvious event", means: "an office may have moved or opened.", action: "Verify its pin and description." },
          { see: "Sharp drop", means: "a closure, a relocation, or users deleting their history.", action: "Confirm before acting." },
        ],
        pills: [{ tone: "go", text: "Clear at a glance" }, { tone: "no", text: "Needs more usage" }],
        data: "UserHistory, two periods",
      },
      {
        title: "Who searches what",
        decision: "Whose needs should each kind of place’s info serve first?",
        what: "For each kind of place, the share of searches made by Students, Staff and Visitors.",
        read: [
          { see: "Visitors large in Offices", means: "visitors rely on the app to find offices.", action: "Prioritise office descriptions, hours and photos." },
          { see: "A group almost missing", means: "the app isn’t reaching them, or they rarely pick that account type.", action: "A promotion decision, not a map fix." },
        ],
        pills: [{ tone: "warn", text: "Weak action" }, { tone: "warn", text: "Thin data" }],
        data: "UserHistory + account type + classification",
      },
    ],
  },
];
