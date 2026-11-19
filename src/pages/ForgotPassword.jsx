import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";
import { Captcha, ErrorText, useDocumentTitle } from "../components/ui.jsx";

export default function ForgotPassword() {
  const { t } = useI18n();
  const [step, setStep] = useState("email");
  const [f, setF] = useState({ email: "", code: "", password: "" });
  const [captcha, setCaptcha] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((tok) => setCaptcha(tok), []);
  useDocumentTitle(t("forgotTitle"));

  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (ex) {
      setErr(ex);
      setCaptchaKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="card form narrow">
        <h1>{t("forgotTitle")}</h1>
        <p className="ok-text">{t("resetDone")}</p>
        <Link className="btn glow block" to="/login">{t("login")}</Link>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form className="card form narrow" onSubmit={run(async () => { await api.resetPassword(f); setStep("done"); })}>
        <h1>{t("forgotTitle")}</h1>
        <p>{t("resetCodeSent")}</p>
        <label>
          {t("code")}
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label>
          {t("newPassword")}
          <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <small className="muted">{t("passwordHelp")}</small>
        </label>
        <ErrorText error={err} />
        <button className="btn glow block" disabled={busy}>{t("save")}</button>
      </form>
    );
  }

  return (
    <form className="card form narrow" onSubmit={run(async () => { await api.forgotPassword({ email: f.email, captcha }); setStep("code"); })}>
      <h1>{t("forgotTitle")}</h1>
      <p className="muted">{t("forgotText")}</p>
      <label>
        {t("email")}
        <input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <Captcha key={captchaKey} onToken={onToken} />
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy}>{t("sendCode")}</button>
      <p className="form-links"><Link to="/login">← {t("login")}</Link></p>
    </form>
  );
}
