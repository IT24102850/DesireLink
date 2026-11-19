import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { ErrorText, useDocumentTitle } from "../components/ui.jsx";

export function safeNext(next, fallback) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export default function Login() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(t("login"));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { user } = await api.login(f);
      setUser(user);
      const home = !user.emailVerified ? "/confirm-email" : "/my-listings";
      nav(safeNext(params.get("next"), home), { replace: true });
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form narrow" onSubmit={submit} noValidate={false}>
      <h1>{t("welcomeBack")}</h1>
      <label>
        {t("email")}
        <input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label>
        {t("password")}
        <input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </label>
      <ErrorText error={err} />
      {err?.code === "USE_ADMIN_LOGIN" && <Link className="btn ghost block" to="/admin/login">🔒 {t("adminPortal")}</Link>}
      <button className="btn glow block" disabled={busy}>{t("login")}</button>
      <p className="form-links">
        <Link to="/forgot-password">{t("forgotPassword")}</Link>
        <span>{t("noAccount")} <Link to="/register">{t("register")}</Link></span>
      </p>
    </form>
  );
}
