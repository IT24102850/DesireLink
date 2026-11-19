// Separate admin portal: own layout, own session (password + TOTP), no public chrome.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useSearchParams, Link } from "react-router-dom";
import qrcode from "qrcode-generator";
import { useI18n, LANGS } from "../i18n";
import { api } from "../lib/api.js";
import { ErrorText, Notice, Spinner, useDocumentTitle } from "../components/ui.jsx";
import Admin from "../pages/Admin.jsx";

const Ctx = createContext(null);
const useAdmin = () => useContext(Ctx);

function useNoIndex() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);
}

export default function AdminApp() {
  useNoIndex();
  const [state, setState] = useState({ loading: true });
  const refresh = useCallback(async () => {
    try {
      setState({ loading: false, ...(await api.adminAuth.me()) });
    } catch {
      setState({ loading: false, admin: null, stage: "PASSWORD" });
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);

  if (state.loading) return <div className="admin-shell"><Spinner /></div>;
  return (
    <Ctx.Provider value={value}>
      <div className="admin-shell">
        <Routes>
          <Route path="login" element={state.admin ? <Navigate to="/admin" replace /> : <AdminLogin />} />
          <Route path="*" element={state.admin ? <AdminLayout><Admin /></AdminLayout> : <Navigate to="/admin/login" replace />} />
        </Routes>
      </div>
    </Ctx.Provider>
  );
}

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t("language")}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={l.code === lang} className={l.code === lang ? "active" : ""} onClick={() => setLang(l.code)} title={l.label}>
          {l.short}
        </button>
      ))}
    </div>
  );
}

function AdminLayout({ children }) {
  const { t } = useI18n();
  const { admin, refresh } = useAdmin();
  const nav = useNavigate();
  const logout = async () => {
    await api.adminAuth.logout().catch(() => {});
    await refresh();
    nav("/admin/login", { replace: true });
  };
  return (
    <>
      <header className="admin-header">
        <div className="container admin-header-inner">
          <div className="brand">
            <img src="/logo-mark.png" alt="" width="36" height="34" />
            <span className="wordmark small">Desire<span>Link</span></span>
            <span className="admin-pill">🔒 {t("adminPortal")}</span>
          </div>
          <div className="header-actions">
            <span className="muted small admin-who">{t("signedInAs")} <strong>{admin.email}</strong></span>
            <LangSwitch />
            <button className="btn small ghost" onClick={logout}>{t("logout")}</button>
          </div>
        </div>
      </header>
      <main className="container main">{children}</main>
    </>
  );
}

// ---- sign-in flow ------------------------------------------------------------------------
function AdminLogin() {
  const { t } = useI18n();
  const { stage: initialStage, email: pendingEmail, refresh } = useAdmin();
  const [params] = useSearchParams();
  const [stage, setStage] = useState(initialStage || "PASSWORD");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  useDocumentTitle(t("adminPortal"));

  return (
    <div className="admin-login">
      <div className="admin-login-brand">
        <img src="/logo-mark.png" alt="" width="72" height="68" />
        <div className="wordmark">Desire<span>Link</span></div>
        <span className="admin-pill">🔒 {t("adminPortal")}</span>
        <LangSwitch />
      </div>
      {params.get("expired") && stage === "PASSWORD" && <Notice kind="warn">{t("adminSessionExpired")}</Notice>}
      {recoveryCodes ? (
        <RecoveryCodes codes={recoveryCodes} onDone={refresh} />
      ) : stage === "ENROLL" ? (
        <Enroll email={pendingEmail} onDone={setRecoveryCodes} />
      ) : stage === "MFA" ? (
        <VerifyMfa onDone={refresh} />
      ) : (
        <PasswordStep onNext={setStage} />
      )}
      <p className="muted small center-text">{t("adminLoginNote")}</p>
      <p className="center-text small"><Link to="/">← {t("backToSite")}</Link></p>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = (fn) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

function PasswordStep({ onNext }) {
  const { t } = useI18n();
  const [f, setF] = useState({ email: "", password: "" });
  const { busy, err, run } = useSubmit();
  return (
    <form className="card form" onSubmit={run(async () => onNext((await api.adminAuth.login(f.email, f.password)).stage))}>
      <h1>{t("adminSignIn")}</h1>
      <label>
        {t("email")}
        <input type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label>
        {t("password")}
        <input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </label>
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy}>{t("login")}</button>
      <p className="form-links"><Link to="/forgot-password">{t("forgotPassword")}</Link></p>
    </form>
  );
}

function CodeInput({ value, onChange, label }) {
  return (
    <label>
      {label}
      <input
        className="code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </label>
  );
}

function Enroll({ email, onDone }) {
  const { t } = useI18n();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const { busy, err, run } = useSubmit();
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    api.adminAuth.setup().then(setSetup).catch(setLoadErr);
  }, []);

  const qr = useMemo(() => {
    if (!setup) return null;
    const q = qrcode(0, "M");
    q.addData(setup.uri);
    q.make();
    return q.createDataURL(6, 3);
  }, [setup]);

  if (loadErr) return <div className="card"><ErrorText error={loadErr} /></div>;
  if (!setup) return <Spinner />;
  return (
    <form className="card form" onSubmit={run(async () => onDone((await api.adminAuth.enable(code)).recoveryCodes))}>
      <h1>{t("mfaSetupTitle")}</h1>
      <p className="muted">{t("mfaSetupText")}</p>
      <div className="qr-box">
        <img src={qr} alt="QR code" width="240" height="240" />
      </div>
      <p className="small muted">{t("mfaManualKey")}</p>
      <code className="totp-key">{setup.secret.match(/.{1,4}/g).join(" ")}</code>
      <p className="small muted">{email}</p>
      <CodeInput label={t("mfaCode")} value={code} onChange={setCode} />
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy || code.length !== 6}>{t("verify")}</button>
    </form>
  );
}

function VerifyMfa({ onDone }) {
  const { t } = useI18n();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [rc, setRc] = useState("");
  const { busy, err, run } = useSubmit();
  return (
    <form className="card form" onSubmit={run(async () => { await api.adminAuth.verify(useRecovery ? { recoveryCode: rc } : { code }); await onDone(); })}>
      <h1>{t("mfaVerifyTitle")}</h1>
      {useRecovery ? (
        <label>
          {t("recoveryCode")}
          <input autoComplete="off" autoFocus required placeholder="XXXX-XXXX-XXXX" value={rc} onChange={(e) => setRc(e.target.value.toUpperCase())} />
        </label>
      ) : (
        <>
          <p className="muted">{t("mfaVerifyText")}</p>
          <CodeInput label={t("mfaCode")} value={code} onChange={setCode} />
        </>
      )}
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy || (useRecovery ? rc.length < 12 : code.length !== 6)}>{t("verify")}</button>
      <button type="button" className="text-button" onClick={() => setUseRecovery(!useRecovery)}>
        {useRecovery ? t("useAuthenticator") : t("useRecoveryCode")}
      </button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="card form">
      <h1>{t("recoveryTitle")}</h1>
      <Notice kind="warn">{t("recoveryText")}</Notice>
      <ol className="recovery-codes">
        {codes.map((c) => <li key={c}><code>{c}</code></li>)}
      </ol>
      <button
        type="button"
        className="btn ghost block"
        onClick={async () => {
          await navigator.clipboard?.writeText(codes.join("\n")).catch(() => {});
          setCopied(true);
        }}
      >
        {copied ? t("copied") : t("copyCodes")}
      </button>
      <button type="button" className="btn glow block" onClick={onDone}>{t("recoverySaved")}</button>
    </div>
  );
}
