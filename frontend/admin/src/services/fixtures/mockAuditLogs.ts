import type { AuditEntry } from "../../types";
import { mulberry32 } from "./prng";

const HOUR = 3_600_000;
const adminActors = ["admin_justine", "admin_marco", "admin_liza"];
const adminActions: [string, string][] = [
  ["Updated Location", "University Library"],
  ["Positioned Location", "Registrar's Office"],
  ["Updated Location", "College of Engineering"],
  ["Created Location", "Science Laboratory 2"],
  ["Edited Building Footprint", "Administration Building"],
  ["Created Pathway", "Main Gate to Library"],
  ["Updated Route Node", "Node 14"],
  ["Deleted Location", "Old Storage Room"],
];
const userActions: [string, string, string][] = [
  ["maria.santos1", "Searched Location", "University Library"],
  ["juan.reyes7", "Searched Location", "Cafeteria"],
  ["ana.cruz12", "Registered Account", "ana.cruz12"],
];
const systemActions: [string, string][] = [
  ["Nightly Backup Completed", "Database"],
  ["Search Index Rebuilt", "Locations"],
];

/** ~40 deterministic audit entries spread over the 90 days before `now`, newest first. */
export function createMockAuditLogs(now = Date.now()): AuditEntry[] {
  const rand = mulberry32(7);
  const entries: AuditEntry[] = [];
  for (let i = 0; i < 40; i += 1) {
    const createdAt = new Date(now - Math.floor(rand() * 90 * 24) * HOUR - (i + 1) * 60_000).toISOString();
    const roll = rand();
    if (i % 5 === 0) {
      const actor = adminActors[Math.floor(rand() * adminActors.length)];
      entries.push({ id: `seed-${i}`, actor, action: "Logged In", target: "Admin Portal", detail: `${actor} signed in to the admin portal.`, createdAt, category: "Admin" });
    } else if (roll < 0.75) {
      const [action, target] = adminActions[Math.floor(rand() * adminActions.length)];
      const actor = adminActors[Math.floor(rand() * adminActors.length)];
      entries.push({ id: `seed-${i}`, actor, action, target, detail: `${action} for ${target}.`, createdAt, category: "Admin" });
    } else if (roll < 0.9) {
      const [actor, action, target] = userActions[Math.floor(rand() * userActions.length)];
      entries.push({ id: `seed-${i}`, actor, action, target, createdAt, category: "User" });
    } else {
      const [action, target] = systemActions[Math.floor(rand() * systemActions.length)];
      entries.push({ id: `seed-${i}`, actor: "system", action, target, createdAt, category: "System" });
    }
  }
  return entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
