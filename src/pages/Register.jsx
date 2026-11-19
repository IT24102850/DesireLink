import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { normalizeLkPhone } from "../../shared/constants.js";
import { Captcha, ErrorText, useDocumentTitle } from "../components/ui.jsx";

export default function Register() {
  const { t, lang } = useI18n();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", phone: "", password: "", acceptTerms: false });
  const [captcha, setCaptcha] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((tok) => setCaptcha(tok), []);
  useDocumentTitle(t("joinTitle"));

  const phoneBad = f.phone && !normalizeLkPhone(f.phone);

  const submit = async (e) => {
    e.preventDefault();
    if (phoneBad) return setErr({ code: "INVALID_PHONE" });
    setBusy(true);
    setErr(null);
    try {
      const { user } = await api.register({ ...f, locale: lang, captcha });
      setUser(user);
      nav("/confirm-email", { replace: true });
    } catch (ex) {
      setErr(ex);
      setCaptchaKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>{t("joinTitle")}</h1>
      <p className="muted">{t("joinText")}</p>
      <label>
        {t("email")}
        <input type="email" autoComplete="email" required maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label>
        {t("phone")}
        <input
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          placeholder="077 123 4567"
          aria-invalid={phoneBad || undefined}
          aria-describedby="phone-help"
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
        <small id="phone-help" className={phoneBad ? "error" : "muted"}>{phoneBad ? t("err.INVALID_PHONE") : t("phoneHelp")}</small>
      </label>
      <label>
        {t("password")}
        <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby="pw-help" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <small id="pw-help" className="muted">{t("passwordHelp")}</small>
      </label>
      <label className="check-label">
        <input type="checkbox" required checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} />
        <span>
          {t("iAgree")} <Link to="/legal/terms" target="_blank">{t("termsLink")}</Link>, <Link to="/legal/content" target="_blank">{t("contentPolicyLink")}</Link> {t("and")}{" "}
          <Link to="/legal/privacy" target="_blank">{t("privacyLink")}</Link>.
        </span>
      </label>
      <Captcha key={captchaKey} onToken={onToken} />
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy}>{t("register")}</button>
      <p className="form-links">
        <span>{t("haveAccount")} <Link to="/login">{t("login")}</Link></span>
      </p>
    </form>
  );
}
