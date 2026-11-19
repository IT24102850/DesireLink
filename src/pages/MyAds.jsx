import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";
import { districtName } from "../../shared/locations.js";
import { ErrorText, Spinner, StatusBadge, useDocumentTitle } from "../components/ui.jsx";

export default function MyAds() {
  const { t, lang } = useI18n();
  const [ads, setAds] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState("");
  useDocumentTitle(t("myAds"));

  const load = () => api.myAds().then((r) => setAds(r.items)).catch(setErr);
  useEffect(() => {
    load();
  }, []);

  const act = async (fn, okMsg) => {
    setErr(null);
    setMsg("");
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      await load();
    } catch (e) {
      setErr(e);
    }
  };

  const fmt = (d) => (d ? new Date(d).toLocaleDateString(lang === "en" ? "en-GB" : lang + "-LK") : "");

  return (
    <>
      <div className="page-head">
        <h1>{t("myAds")}</h1>
        <Link to="/post" className="btn glow small">＋ {t("postAd")}</Link>
      </div>
      <ErrorText error={err} />
      {msg && <p className="ok-text" role="status">{msg}</p>}
      {!ads && !err && <Spinner />}
      {ads?.length === 0 && <div className="empty"><p>{t("noMyAds")}</p></div>}
      <div className="my-ads">
        {ads?.map((a) => (
          <div key={a.id} className="card my-ad">
            <Link to={`/ad/${a.id}`} className="my-ad-thumb">
              {a.photo ? <img src={a.photo} alt="" loading="lazy" /> : <div className={`placeholder ${a.gender}`}><span>{a.title[0]}</span></div>}
            </Link>
            <div className="my-ad-body">
              <div className="row between wrap">
                <h3><Link to={`/ad/${a.id}`}>{a.title}</Link></h3>
                <StatusBadge status={a.status} />
              </div>
              <p className="muted small">
                {t(a.gender)} · {a.age} {t("years")} · {districtName(a.districtId, lang)}
                {a.expiresAt && a.status === "APPROVED" && <> · {t("expires")} {fmt(a.expiresAt)}</>}
                {a.views > 0 && <> · {a.views} {t("views")}</>}
              </p>
              {a.rejectReason && (a.status === "REJECTED" || a.status === "REMOVED") && (
                <p className="error small">{t("reason")}: {a.rejectReason}</p>
              )}
              <div className="row wrap">
                {a.status !== "REMOVED" && <Link to={`/edit/${a.id}`} className="btn ghost small">{t("edit")}</Link>}
                {(a.canRenew || a.status === "EXPIRED") && (
                  <button className="btn small" onClick={() => act(() => api.renewAd(a.id), t("renewed"))}>{t("renew")}</button>
                )}
                <button className="btn ghost small danger" onClick={() => window.confirm(t("confirmDelete")) && act(() => api.deleteAd(a.id))}>{t("delete")}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
