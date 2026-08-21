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
  const logout = async () => {
    try {
      await services.auth.logout();
    } finally {
      setSession(null);
    }
  };
  return (
    <Auth.Provider
      value={useMemo(() => ({ session, login, logout, loading }), [session, loading])}
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
