/**
 * The reasons a superadmin gives when demoting another superadmin. The codes are the
 * wire contract of `PUT /api/admins/<id>/role` (#166); the labels and explanations are
 * what the dialog and System Logs show. Order is the order the dialog lists them.
 */
export const DEMOTION_REASONS = [
  { code: "role_changed", label: "Role changed", description: "Their current responsibilities no longer require superadmin access." },
  { code: "left_team", label: "No longer part of the team", description: "They have left the team or are no longer responsible for the system." },
  { code: "granted_by_mistake", label: "Access granted by mistake", description: "Their superadmin role was assigned unintentionally." },
  { code: "security_concern", label: "Security concern", description: "Their account or access may pose a security risk." },
  { code: "other", label: "Other reason", description: "A reason not covered by the options above." },
] as const;

export type DemotionReasonCode = (typeof DEMOTION_REASONS)[number]["code"];

/** Longest explanation the server accepts for "Other", after trimming. */
export const OTHER_REASON_MAX = 500;

export const REASONS_REQUIRED_MESSAGE = "Select at least one reason for this demotion.";
export const OTHER_REASON_REQUIRED_MESSAGE = "Explain the other reason.";
export const OTHER_REASON_TOO_LONG_MESSAGE = `Keep the explanation to ${OTHER_REASON_MAX} characters or fewer.`;

export const isDemotionReasonCode = (value: unknown): value is DemotionReasonCode =>
  DEMOTION_REASONS.some((reason) => reason.code === value);

/** The readable label for a code; a code this build does not know is shown as received. */
export const demotionReasonLabel = (code: string): string =>
  DEMOTION_REASONS.find((reason) => reason.code === code)?.label ?? code;

/**
 * The server's validation, shared by the form and the fixture: field-keyed messages,
 * empty when the selection is valid. `otherReason` is the raw text; it is only judged
 * (trimmed) when "other" is selected, and rejected otherwise only by the fixture/server
 * since the form never sends it then.
 */
export const demotionReasonIssues = (reasons: readonly string[], otherReason?: string): Record<string, string> => {
  const issues: Record<string, string> = {};
  if (reasons.length === 0) issues.reasons = REASONS_REQUIRED_MESSAGE;
  if (reasons.includes("other")) {
    const length = Array.from((otherReason ?? "").trim()).length;
    if (length === 0) issues.otherReason = OTHER_REASON_REQUIRED_MESSAGE;
    else if (length > OTHER_REASON_MAX) issues.otherReason = OTHER_REASON_TOO_LONG_MESSAGE;
  }
  return issues;
};
