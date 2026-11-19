import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { ErrorText, useDocumentTitle } from "../components/ui.jsx";

export default function ConfirmEmail() {
  const { t } = useI18n();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  useDocumentTitle(t("confirmEmailTitle"));

  useEffect(() => {
    if (user?.emailVerified) nav(user.role === "ADMIN" ? "/admin" : "/verify", { replace: true });
  }, [user, nav]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.confirmEmail(code.trim());
      setUser(r.user);
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr(null);
    setInfo("");
    try {
      await api.resendEmailCode();
      setInfo(t("codeSent"));
    } catch (ex) {
      setErr(ex);
    }
  };

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>{t("confirmEmailTitle")}</h1>
      <p>{t("confirmEmailText", { email: user?.email || "" })}</p>
      <label>
        {t("code")}
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <ErrorText error={err} />
      {info && <p className="ok-text" role="status">{info}</p>}
      <button className="btn glow block" disabled={busy || code.length !== 6}>{t("confirm")}</button>
      <button type="button" className="text-button" onClick={resend}>{t("resendCode")}</button>
    </form>
  );
}
