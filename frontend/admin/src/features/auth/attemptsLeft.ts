/** At or below this many attempts the "attempts left" message turns urgent. */
export const URGENT_ATTEMPTS_THRESHOLD = 2;

export const isUrgentAttempts = (attemptsRemaining: number) => attemptsRemaining <= URGENT_ATTEMPTS_THRESHOLD;

/** "4 attempts left.", shared by login and the recovery code step. */
export const attemptsLeftText = (attemptsRemaining: number) =>
  attemptsRemaining <= 0
    ? "No attempts left."
    : `${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} left.`;
