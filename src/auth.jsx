import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./lib/api.js";
import { useI18n } from "./i18n";
import { Spinner } from "./components/ui.jsx";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const { setLang } = useI18n();
  const [user, setUserState] = useState(undefined); // undefined = loading

  const setUser = useCallback(
    (u) => {
      setUserState(u);
      if (u?.locale) setLang(u.locale);
    },
    [setLang]
  );

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUserState(u);
      return u;
    } catch {
      setUserState(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthCtx.Provider value={{ user, setUser, refresh, loading: user === undefined }}>{children}</AuthCtx.Provider>;
}

export function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}
