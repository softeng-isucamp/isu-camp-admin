import { useNavigate } from "react-router-dom";

/** Navigation state that opens login with the username already filled in. Never stored anywhere else. */
export interface LoginPrefillState {
  username: string;
}

/** The username a recovery flow handed to login, or "" when login was opened directly. */
export const readLoginPrefill = (state: unknown): string => {
  const username = (state as Partial<LoginPrefillState> | null)?.username;
  return typeof username === "string" ? username : "";
};

/** Returns a function that opens login with `username` prefilled. */
export function useReturnToLogin() {
  const navigate = useNavigate();
  return (username: string) => navigate("/login", { state: { username } satisfies LoginPrefillState });
}
