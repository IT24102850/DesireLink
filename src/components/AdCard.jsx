import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { districtName } from "../../shared/locations.js";
import { VerifiedBadge } from "./ui.jsx";

export default function AdCard({ ad }) {
  const { t, lang } = useI18n();
  return (
    <Link to={`/ad/${ad.id}`} className="ad-card">
      <div className="thumb">
        {ad.photo ? (
          <img src={ad.photo} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className={`placeholder ${ad.gender}`} aria-hidden="true">
            <span>{ad.title?.[0]?.toUpperCase() || "D"}</span>
          </div>
        )}
        <div className="thumb-shade" />
        <VerifiedBadge compact />
        {ad.photoCount > 1 && <span className="photo-count">{ad.photoCount}</span>}
        <div className="thumb-meta">
          <span className="age">{ad.age}</span>
          <span className={`gender-dot ${ad.gender}`}>{t(ad.gender)}</span>
        </div>
      </div>
      <div className="card-body">
        <h3>{ad.title}</h3>
        <p className="place">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
          {districtName(ad.districtId, lang)}
        </p>
        {ad.tags?.length > 0 && (
          <div className="chips small">
            {ad.tags.slice(0, 3).map((k) => <span key={k} className="chip">{t(`tag.${k}`)}</span>)}
          </div>
        )}
      </div>
    </Link>
  );
}
