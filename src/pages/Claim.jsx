// Activation page for publisher accounts created by an admin (link from the invitation email).
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { ErrorText, Notice, useDocumentTitle } from "../components/ui.jsx";

export default function Claim() {
  const { t, lang } = useI18n();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") || "";
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(t("claimTitle"));

  if (!email || !token) {
    return (
      <div className="card form narrow">
        <h1>{t("claimTitle")}</h1>
        <Notice kind="bad">{t("err.INVITE_INVALID")}</Notice>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { user } = await api.claim({ email, token, password, acceptTerms: accept, locale: lang });
      setUser(user);
      nav("/verify", { replace: true });
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>{t("claimTitle")}</h1>
      <p className="muted">{t("claimText", { email })}</p>
      <label>
        {t("newPassword")}
        <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <small className="muted">{t("passwordHelp")}</small>
      </label>
      <label className="check-label">
        <input type="checkbox" required checked={accept} onChange={(e) => setAccept(e.target.checked)} />
        <span>
          {t("iAgree")} <Link to="/legal/terms" target="_blank">{t("termsLink")}</Link>, <Link to="/legal/content" target="_blank">{t("contentPolicyLink")}</Link> {t("and")}{" "}
          <Link to="/legal/privacy" target="_blank">{t("privacyLink")}</Link>.
        </span>
      </label>
      <ErrorText error={err} />
      {err?.code === "ALREADY_ACTIVATED" && <Link className="btn ghost block" to="/login">{t("login")}</Link>}
      <button className="btn glow block" disabled={busy || !accept}>{t("activate")}</button>
    </form>
  );
}
