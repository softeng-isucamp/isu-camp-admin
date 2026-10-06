import type { UserAccount } from "../../types";
import { mulberry32 } from "./prng";

const DAY = 86_400_000;
const firstNames = ["maria", "juan", "ana", "carlo", "bea", "miguel", "lea", "paolo", "joy", "rafael", "nina", "gabriel", "tess", "ramon", "kaye"];
const lastNames = ["santos", "reyes", "cruz", "bautista", "garcia", "mendoza", "torres", "ramos", "flores", "aquino", "dizon", "navarro"];

/**
 * Deterministic fixture accounts (fixed seed): 60 users, roughly 70% student,
 * 20% teacher, 10% visitor, registered over the 90 days before `now`.
 */
export function createMockUsers(now = Date.now()): UserAccount[] {
  const rand = mulberry32(2026);
  const users = Array.from({ length: 60 }, (_, index) => {
    const roll = rand();
    const userType = roll < 0.7 ? "student" : roll < 0.9 ? "teacher" : "visitor";
    const first = firstNames[Math.floor(rand() * firstNames.length)];
    const last = lastNames[Math.floor(rand() * lastNames.length)];
    const createdAt = new Date(now - Math.floor(rand() * 90 * 24) * DAY / 24 - index * 60_000).toISOString();
    return { id: String(index + 1), username: `${first}.${last}${index + 1}`, createdAt, userType } satisfies UserAccount;
  });
  return users.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
