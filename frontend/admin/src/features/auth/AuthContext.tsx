import {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "../../types";
import { services } from "../../services/api";
interface AuthValue {
  session: Session | null;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
}
const Auth = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(() => {
    const value = sessionStorage.getItem("isu-session");
    return value ? JSON.parse(value) : null;
  });
  const login = async (u: string, p: string) => {
    const s = await services.auth.login(u, p);
    setSession(s);
    sessionStorage.setItem("isu-session", JSON.stringify(s));
  };
  const logout = () => {
    void services.auth.logout();
    setSession(null);
    sessionStorage.removeItem("isu-session");
  };
  return (
    <Auth.Provider
      value={useMemo(() => ({ session, login, logout }), [session])}
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
