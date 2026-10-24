import {
  createContext,
  useCallback,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "../../types";
import { services } from "../../services/api";
import { PERMISSION_DENIED_EVENT } from "../../services/errors";
interface AuthValue {
  session: Session | null;
  login: (u: string, p: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  /** Takes the identity fields of a saved profile; role and permissions stay what the server last reported for the session. */
  updateSession: (profile: Pick<Session, "id" | "username" | "email">) => void;
  /** Reads the session from the server again, e.g. after a refusal shows its role has changed. */
  refreshSession: () => Promise<void>;
}
const Auth = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Counts sign-ins and sign-outs, so a read can tell whether the session it was for is still the one in place.
  const sessionEpoch = useRef(0);
  const sessionRead = useRef(0);
  useEffect(() => {
    let mounted = true;
    void services.auth.me()
      .then((current) => {
        if (mounted) setSession(current);
      })
      .catch(() => {
        if (mounted) setSession(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const login = async (u: string, p: string, remember?: boolean) => {
    const s = await services.auth.login(u, p, remember);
    sessionEpoch.current += 1;
    setSession(s);
  };
  // A response may only update the exact session that initiated it. A saved profile says who the
  // account is, never what it may do, so role and permissions are kept: replacing them would
  // drop the switches, and a session that reports none allows everything.
  const updateSession = (profile: Pick<Session, "id" | "username" | "email">) => {
    setSession((current) => current && current === session && String(current.id) === String(profile.id)
      ? { ...current, username: profile.username, email: profile.email }
      : current);
  };
  // A failed read leaves the current session alone.
  // A read that comes back after the session it was for ended, or for another account, is ignored.
  const refreshSession = useCallback(async () => {
    const startedIn = sessionEpoch.current;
    const read = ++sessionRead.current;
    let fresh: Session | null;
    try {
      fresh = await services.auth.me();
    } catch {
      return;
    }
    if (startedIn !== sessionEpoch.current || read !== sessionRead.current) return;
    setSession((current) => {
      if (!current) return current;
      if (!fresh) return null;
      return String(current.id) === String(fresh.id) ? fresh : current;
    });
  }, []);
  useEffect(() => {
    if (!session) return;
    let lastRefresh = -Infinity;
    const revalidate = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastRefresh < 30_000) return;
      lastRefresh = Date.now();
      void refreshSession();
    };
    const onRefusal = () => { void refreshSession(); };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener(PERMISSION_DENIED_EVENT, onRefusal);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener(PERMISSION_DENIED_EVENT, onRefusal);
    };
  }, [session?.id, refreshSession]);
  const logout = async () => {
    try {
      await services.auth.logout();
    } finally {
      sessionEpoch.current += 1;
      setSession(null);
    }
  };
  return (
    <Auth.Provider
      value={useMemo(() => ({ session, login, logout, loading, updateSession, refreshSession }), [session, loading])}
    >
      {children}
    </Auth.Provider>
  );
}
export function useAuth() {
  const value = useContext(Auth);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
