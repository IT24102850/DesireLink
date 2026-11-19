import { useEffect, useState } from "react";
import { useI18n, LANGS } from "../i18n";

const KEY = "dl_age_ok";

export default function AgeGate() {
  const { t, lang, setLang } = useI18n();
  const [ok, setOk] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.body.classList.toggle("no-scroll", !ok);
  }, [ok]);

  if (ok) return null;
  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="age-card">
        <img src="/logo-mark.png" alt="" width="120" height="113" className="age-logo" />
        <div className="wordmark">Desire<span>Link</span></div>
        <div className="lang-pills" role="group" aria-label={t("language")}>
          {LANGS.map((l) => (
            <button key={l.code} type="button" className={l.code === lang ? "active" : ""} onClick={() => setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
        <h1 id="age-title">{t("ageGateTitle")}</h1>
        <p>{t("ageGateText")}</p>
        <div className="age-actions">
          <button
            className="btn glow"
            autoFocus
            onClick={() => {
              try {
                localStorage.setItem(KEY, "1");
              } catch {}
              setOk(true);
            }}
          >
            {t("ageGateEnter")}
          </button>
          <a className="btn ghost" href="https://www.google.com" rel="noreferrer">
            {t("ageGateLeave")}
          </a>
        </div>
      </div>
    </div>
  );
}
