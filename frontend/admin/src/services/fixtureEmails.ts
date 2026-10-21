import type { AccountProfile } from "./profile";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * The fixture's one shared email pool: an address is taken when any other
 * administrator holds it, as their primary or their alternative, ignoring case.
 */
export const emailInUse = (
  accounts: Pick<AccountProfile, "id" | "email" | "alternativeEmail">[],
  email: string,
  excludingId?: string,
): boolean => {
  const wanted = normalizeEmail(email);
  return accounts.some((record) => record.id !== excludingId
    && (normalizeEmail(record.email) === wanted || (!!record.alternativeEmail && normalizeEmail(record.alternativeEmail) === wanted)));
};

export const EMAIL_IN_USE_MESSAGE = "That email address is already in use";
