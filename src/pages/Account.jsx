import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { formatLkPhone } from "../../shared/constants.js";
import { ErrorText, useDocumentTitle } from "../components/ui.jsx";

export default function Account() {
  const { t } = useI18n();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState({ current: "", password: "" });
  const [pwErr, setPwErr] = useState(null);
  const [pwOk, setPwOk] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delErr, setDelErr] = useState(null);
  useDocumentTitle(t("accountTitle"));

  return (
    <div className="stack narrow">
      <h1>{t("accountTitle")}</h1>
      <div className="card">
        <dl className="kv">
          <dt>{t("email")}</dt><dd>{user.email}</dd>
          <dt>{t("phone")}</dt><dd>{formatLkPhone(user.phone)}</dd>
        </dl>
      </div>

      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPwErr(null);
          setPwOk(false);
          try {
            await api.changePassword(pw);
            setPw({ current: "", password: "" });
            setPwOk(true);
          } catch (ex) {
            setPwErr(ex);
          }
        }}
      >
        <h2>{t("changePassword")}</h2>
        <label>
          {t("currentPassword")}
          <input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </label>
        <label>
          {t("newPassword")}
          <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
        </label>
        <ErrorText error={pwErr} />
        {pwOk && <p className="ok-text" role="status">{t("passwordChanged")}</p>}
        <button className="btn">{t("save")}</button>
      </form>

      {user.role === "PUBLISHER" && (
        <form
          className="card form danger-zone"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!window.confirm(t("deleteAccountText"))) return;
            setDelErr(null);
            try {
              await api.deleteAccount(delPw);
              setUser(null);
              nav("/", { replace: true });
            } catch (ex) {
              setDelErr(ex);
            }
          }}
        >
          <h2>{t("dangerZone")}</h2>
          <p className="muted">{t("deleteAccountText")}</p>
          <label>
            {t("password")}
            <input type="password" autoComplete="current-password" required value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          </label>
          <ErrorText error={delErr} />
          <button className="btn danger">{t("deleteForever")}</button>
        </form>
      )}
    </div>
  );
}
