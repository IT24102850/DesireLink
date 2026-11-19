import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { checkNicEligibility } from "../../shared/nic.js";
import { ErrorText, ImageField, Notice, Spinner, StatusBadge, useDocumentTitle } from "../components/ui.jsx";

export default function Verify() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [v, setV] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [nic, setNic] = useState("");
  const [files, setFiles] = useState({ front: null, back: null, selfie: null });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(t("verifyTitle"));

  useEffect(() => {
    api.myVerification().then(setV).catch(setLoadErr);
  }, []);

  if (loadErr) return <div className="card narrow"><ErrorText error={loadErr} /></div>;
  if (!v) return <Spinner />;

  if (!user.emailVerified) {
    return (
      <div className="card form narrow">
        <h1>{t("verifyTitle")}</h1>
        <Notice kind="warn">{t("confirmEmailFirst")}</Notice>
        <Link className="btn glow block" to="/confirm-email">{t("confirmEmailTitle")}</Link>
      </div>
    );
  }

  if (v.status === "PENDING" || v.status === "APPROVED") {
    return (
      <div className="card form narrow">
        <h1>{t("verifyTitle")}</h1>
        <p>{t("status")}: <StatusBadge status={v.status} /></p>
        <p>{v.status === "APPROVED" ? t("verifyApprovedText") : t("verifyPendingText")}</p>
        <dl className="kv">
          <dt>{t("nicNumber")}</dt><dd>{v.nicMasked}</dd>
          <dt>{t("birthDate")}</dt><dd>{v.birthDate}</dd>
          <dt>{t("age")}</dt><dd>{v.age}</dd>
          <dt>{t("gender")}</dt><dd>{t(v.gender)}</dd>
        </dl>
        {v.status === "APPROVED" && <Link className="btn glow block" to="/post">{t("postAd")}</Link>}
      </div>
    );
  }

  const preview = nic.trim() ? checkNicEligibility(nic) : null;
  const allFiles = files.front && files.back && files.selfie;

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!allFiles) return setErr({ code: "FILES_REQUIRED" });
    setBusy(true);
    try {
      setV(await api.submitVerification({ nic, ...files }));
      window.scrollTo(0, 0);
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h1>{t("verifyTitle")}</h1>
      <p>{t("verifyIntro")}</p>
      {v.status === "REJECTED" && (
        <Notice kind="bad">
          <strong>{t("verifyRejectedText")}</strong>
          <br />
          {t("reason")}: {v.rejectionReason}
        </Notice>
      )}

      <label>
        {t("nicNumber")}
        <input
          value={nic}
          onChange={(e) => setNic(e.target.value.toUpperCase())}
          placeholder="200012345678 / 851000123V"
          autoComplete="off"
          spellCheck={false}
          maxLength={14}
          required
          aria-describedby="nic-help nic-preview"
        />
        <small id="nic-help" className="muted">{t("nicHelp")}</small>
      </label>

      <div id="nic-preview" aria-live="polite">
        {preview && (
          <div className={`nic-preview ${preview.valid ? "ok" : "bad"}`}>
            {preview.valid || preview.error === "UNDERAGE" ? (
              <>
                <strong>{t("nicPreview")}</strong>
                <dl className="kv">
                  <dt>{t("birthDate")}</dt><dd>{preview.birthDate}</dd>
                  <dt>{t("age")}</dt><dd>{preview.age}</dd>
                  <dt>{t("gender")}</dt><dd>{t(preview.gender)}</dd>
                </dl>
                {preview.error === "UNDERAGE" && <p className="error">{t("err.UNDERAGE")}</p>}
              </>
            ) : (
              <p className="error">{t(`err.${preview.error}`)}</p>
            )}
          </div>
        )}
      </div>

      <p className="muted">{t("photoTips")}</p>
      <div className="id-photos">
        <ImageField label={t("nicFront")} value={files.front} onChange={(f) => setFiles({ ...files, front: f })} required />
        <ImageField label={t("nicBack")} value={files.back} onChange={(f) => setFiles({ ...files, back: f })} required />
        <ImageField label={t("selfie")} help={t("selfieHelp")} capture="user" value={files.selfie} onChange={(f) => setFiles({ ...files, selfie: f })} required />
      </div>

      <Notice>{t("privacyNicNote")}</Notice>
      <ErrorText error={err} />
      <button className="btn glow block" disabled={busy || !preview?.valid || !allFiles}>
        {busy ? t("loading") : t("submitVerification")}
      </button>
    </form>
  );
}
