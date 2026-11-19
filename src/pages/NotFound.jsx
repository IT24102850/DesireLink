import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../components/ui.jsx";

export default function NotFound() {
  const { t } = useI18n();
  useDocumentTitle("404");
  return (
    <div className="empty big">
      <p className="huge">404</p>
      <p>{t("notFound")}</p>
      <Link to="/" className="btn glow">{t("goHome")}</Link>
    </div>
  );
}
