import type { UserAccountType } from "../types";

export const accountTypes: { key: UserAccountType; label: string; color: string }[] = [
  { key: "student", label: "Student", color: "#2a78d6" },
  { key: "teacher", label: "Teacher", color: "#eb6834" },
  { key: "visitor", label: "Visitor", color: "#1baf7a" },
];

export const accountTypeLabel = (type: UserAccountType) =>
  accountTypes.find((entry) => entry.key === type)!.label;

export const accountTypeColor = (type: UserAccountType) =>
  accountTypes.find((entry) => entry.key === type)!.color;

/** Case-insensitive parse of a backend/URL value; anything unrecognized is null. */
export const parseAccountType = (value: unknown): UserAccountType | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return accountTypes.find((entry) => entry.key === normalized)?.key ?? null;
};
