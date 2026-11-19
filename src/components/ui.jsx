import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";

export function Spinner({ label }) {
  const { t } = useI18n();
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label || t("loading")}</span>
    </div>
  );
}

export function ErrorText({ error }) {
  const { terr } = useI18n();
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {typeof error === "string" ? error : terr(error)}
    </p>
  );
}

export function Notice({ kind = "info", children }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

const BADGE = { APPROVED: "ok", PENDING: "warn", PENDING_REVIEW: "warn", REJECTED: "bad", REMOVED: "bad", EXPIRED: "muted", NOT_SUBMITTED: "muted" };
export function StatusBadge({ status }) {
  const { t } = useI18n();
  return <span className={`badge ${BADGE[status] || ""}`}>{t(`status.${status}`)}</span>;
}

export function VerifiedBadge({ compact }) {
  const { t } = useI18n();
  return (
    <span className="verified" title={t("verifiedExplain")}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.2 3.2 1.2 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.3 13 2.1 9.8l3-1.7.9-3.3 3.4.4z" />
        <path fill="#1a0d12" d="M10.3 15.6l-3-3 1.4-1.4 1.6 1.6 4.6-4.6 1.4 1.4z" />
      </svg>
      {!compact && t("verifiedBadge")}
    </span>
  );
}

/** Modal dialog with a focus trap-lite and Escape to close. */
export function Dialog({ open, title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    ref.current?.querySelector("input,textarea,select,button")?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Ask for a reason (moderation). Resolves the promise-like via onSubmit. */
export function ReasonDialog({ open, title, label, required = true, onCancel, onSubmit }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (required && !text.trim()) return;
          onSubmit(text.trim());
        }}
      >
        <label>
          {label}
          <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} required={required} />
        </label>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
          <button type="submit" className="btn">{t("submit")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Cloudflare Turnstile (only rendered if the server has a site key) ---------------
let configPromise;
const getConfig = () => (configPromise ||= api.config().catch(() => ({})));
let scriptPromise;
const loadTurnstile = () =>
  (scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = reject;
    document.head.appendChild(s);
  }));

export function Captcha({ onToken }) {
  const { lang } = useI18n();
  const box = useRef(null);
  useEffect(() => {
    let id;
    let cancelled = false;
    getConfig().then(async (cfg) => {
      if (!cfg.turnstileSiteKey || cancelled) return onToken("");
      const ts = await loadTurnstile();
      if (cancelled || !box.current) return;
      id = ts.render(box.current, {
        sitekey: cfg.turnstileSiteKey,
        theme: "dark",
        language: lang,
        callback: onToken,
        "expired-callback": () => onToken(""),
      });
    });
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [lang, onToken]);
  return <div ref={box} className="captcha" />;
}

// ---- image picker with preview ---------------------------------------------------------
export function ImageField({ label, help, value, onChange, capture, required }) {
  const { t } = useI18n();
  const id = useId();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!value) return setUrl(null);
    const u = URL.createObjectURL(value);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);
  return (
    <div className="image-field">
      <span className="field-label" id={`${id}-l`}>{label}</span>
      <label htmlFor={id} className={`image-drop ${url ? "has" : ""}`}>
        {url ? <img src={url} alt="" /> : <span className="plus" aria-hidden="true">＋</span>}
        <span className="image-drop-text">{url ? t("changePhoto") : t("choosePhoto")}</span>
      </label>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture={capture}
        required={required && !value}
        aria-labelledby={`${id}-l`}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {help && <small className="muted">{help}</small>}
    </div>
  );
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · DesireLink` : "DesireLink · Verified adult personals in Sri Lanka";
  }, [title]);
}
