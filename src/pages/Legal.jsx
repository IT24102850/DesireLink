import { useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { legal, LEGAL_UPDATED } from "../i18n/legal.js";
import { useDocumentTitle } from "../components/ui.jsx";
import NotFound from "./NotFound.jsx";

const TITLES = { terms: "terms", content: "contentPolicy", privacy: "privacy" };
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || `support@${typeof location !== "undefined" ? location.hostname.replace(/^www\./, "") : "desirelink.lk"}`;

export default function Legal() {
  const { doc } = useParams();
  const { t, lang } = useI18n();
  useDocumentTitle(TITLES[doc] ? t(TITLES[doc]) : "");
  const sections = legal[doc]?.[lang] || legal[doc]?.en;
  if (!sections) return <NotFound />;
  return (
    <article className="card legal">
      <h1>{t(TITLES[doc])}</h1>
      <p className="muted small">{t("lastUpdated")}: {LEGAL_UPDATED}</p>
      {sections.map(([h, p]) => (
        <section key={h}>
          <h2>{h}</h2>
          <p>{p.replaceAll("{contact}", CONTACT)}</p>
        </section>
      ))}
    </article>
  );
}
