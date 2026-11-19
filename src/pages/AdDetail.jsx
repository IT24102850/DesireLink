import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";
import { districtName } from "../../shared/locations.js";
import { REPORT_REASONS } from "../../shared/constants.js";
import { Dialog, ErrorText, Spinner, StatusBadge, VerifiedBadge, useDocumentTitle } from "../components/ui.jsx";

export default function AdDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [ad, setAd] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(0);
  const [phone, setPhone] = useState(null);
  const [phoneErr, setPhoneErr] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  useDocumentTitle(ad?.title);

  useEffect(() => {
    setAd(null);
    setError(null);
    setPhone(null);
    setActive(0);
    api.getAd(id).then(setAd).catch(setError);
  }, [id]);

  if (error) return <div className="card narrow"><ErrorText error={error} /><Link to="/">← {t("goHome")}</Link></div>;
  if (!ad) return <Spinner />;

  const photos = ad.photos || [];
  const reveal = async () => {
    setPhoneErr(null);
    try {
      setPhone(await api.revealContact(ad.id));
    } catch (e) {
      setPhoneErr(e);
    }
  };

  return (
    <article className="detail">
      <Link to="/" className="back-link">← {t("back")}</Link>
      <div className="detail-grid">
        <div className="gallery">
          <div className="gallery-main">
            {photos.length ? (
              <img src={photos[active].url} alt={t("photoN", { n: active + 1 })} width={photos[active].width} height={photos[active].height} />
            ) : (
              <div className={`placeholder big ${ad.gender}`} aria-hidden="true"><span>{ad.title[0]?.toUpperCase()}</span></div>
            )}
          </div>
          {photos.length > 1 && (
            <div className="thumbs" role="tablist">
              {photos.map((p, i) => (
                <button key={p.id} role="tab" aria-selected={i === active} className={i === active ? "active" : ""} onClick={() => setActive(i)} aria-label={t("photoN", { n: i + 1 })}>
                  <img src={p.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          {ad.status && ad.status !== "APPROVED" && <StatusBadge status={ad.status} />}
          <h1>{ad.title}</h1>
          <div className="detail-meta">
            <span className="age-big">{ad.age}<small>{t("years")}</small></span>
            <span className={`gender-dot ${ad.gender}`}>{t(ad.gender)}</span>
            <span>{districtName(ad.districtId, lang)}</span>
          </div>
          <div className="verified-row">
            <VerifiedBadge />
            <small className="muted">{t("verifiedExplain")}</small>
          </div>
          {ad.tags?.length > 0 && (
            <div className="chips">
              {ad.tags.map((k) => <span key={k} className="chip hot">{t(`tag.${k}`)}</span>)}
            </div>
          )}

          <section className="about">
            <h2>{t("aboutMe")}</h2>
            <p className="desc">{ad.description}</p>
          </section>

          {ad.hasPhone && (
            <section className="contact-panel">
              <h2>{t("contact")}</h2>
              {phone ? (
                <div className="contact-actions">
                  <strong className="phone">{phone.phone}</strong>
                  <a className="btn glow" href={`tel:${phone.tel}`}>{t("callNow")}</a>
                  <a className="btn ghost" href={`https://wa.me/${phone.tel.replace("+", "")}`} target="_blank" rel="noopener noreferrer">{t("whatsapp")}</a>
                </div>
              ) : (
                <button className="btn glow block" onClick={reveal}>{t("showNumber")}</button>
              )}
              <ErrorText error={phoneErr} />
            </section>
          )}

          <p className="safety-note">{t("safetyNotice")}</p>
          <p className="muted small">
            {t("published")}: {new Date(ad.createdAt).toLocaleDateString(lang === "en" ? "en-GB" : lang + "-LK")}
            {ad.views != null && <> · {ad.views} {t("views")}</>}
          </p>
          {reported ? (
            <p className="ok-text" role="status">{t("reported")}</p>
          ) : (
            <button className="text-button danger" onClick={() => setReportOpen(true)}>⚑ {t("report")}</button>
          )}
        </div>
      </div>

      <ReportDialog open={reportOpen} adId={ad.id} onClose={() => setReportOpen(false)} onDone={() => { setReportOpen(false); setReported(true); }} />
    </article>
  );
}

function ReportDialog({ open, adId, onClose, onDone }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} title={t("reportTitle")} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api.reportAd(adId, reason, details || undefined);
            onDone();
          } catch (ex) {
            setErr(ex);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="radio-list">
          <legend>{t("reportReason")}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="check-label">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} required />
              <span>{t(`report.${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <label>
          {t("reportDetails")}
          <textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <ErrorText error={err} />
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button>
          <button className="btn danger" disabled={busy || !reason}>{t("sendReport")}</button>
        </div>
      </form>
    </Dialog>
  );
}
