import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "../../types";
import { services } from "../../services/api";
interface AuthValue {
  session: Session | null;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  updateSession: (profile: Session) => void;
  /** Reads the session from the server again, e.g. after a refusal shows its role has changed. */
  refreshSession: () => Promise<void>;
}
const Auth = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
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
  const login = async (u: string, p: string) => {
    const s = await services.auth.login(u, p);
    setSession(s);
  };
  // A response may only update the exact session that initiated it.
  const updateSession = (profile: Session) => {
    setSession((current) => current && current === session && String(current.id) === profile.id ? profile : current);
  };
  // Only an explicit request re-reads the session; a failed read leaves the current one alone.
  // A read that comes back after sign-out, or for another account, is ignored.
  const refreshSession = async () => {
    let fresh: Session | null;
    try {
      fresh = await services.auth.me();
    } catch {
      return;
    }
    setSession((current) => {
      if (!current) return current;
      if (!fresh) return null;
      return String(current.id) === String(fresh.id) ? fresh : current;
    });
  };
  const logout = async () => {
    try {
      await services.auth.logout();
    } finally {
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
