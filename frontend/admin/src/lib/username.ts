/** The longest administrator username the backend stores, counted in characters as Python's len() counts them. */
export const USERNAME_MAX_LENGTH = 255;

/**
 * The problem with an administrator username, or undefined when it can be saved. Add Administrator and
 * My Profile both use it. The backend applies the same checks (`app/routes/admins.py`,
 * `app/routes/profile.py`): trimmed, not empty, at most 255 characters, unique ignoring case. Nothing
 * else is checked, so a username with a space or only two characters is accepted.
 */
export function usernameIssue(value: string): string | undefined {
  const username = value.trim();
  if (!username) return "Username is required.";
  if ([...username].length > USERNAME_MAX_LENGTH) return `Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`;
  return undefined;
}
