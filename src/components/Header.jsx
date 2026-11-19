import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useI18n, LANGS } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";

export default function Header() {
  const { t, lang, setLang } = useI18n();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
  }, [open]);

  const changeLang = (code) => {
    setLang(code);
    if (user) api.setLocale(code).catch(() => {});
  };

  const doLogout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    nav("/");
  };

  const links = (
    <>
      <NavLink to="/" end>{t("discover")}</NavLink>
      {user?.role === "PUBLISHER" && (
        <>
          <NavLink to="/my-ads">{t("myAds")}</NavLink>
          <NavLink to="/verify">{t("verification")}</NavLink>
        </>
      )}
      {user?.role === "ADMIN" && <NavLink to="/admin">{t("admin")}</NavLink>}
      {user && <NavLink to="/account">{t("account")}</NavLink>}
    </>
  );

  return (
    <>
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label={t("siteName")}>
          <img src="/logo-mark.png" alt="" width="44" height="42" />
          <span className="wordmark">Desire<span>Link</span></span>
        </Link>

        <nav className="nav desktop" aria-label="Main">
          {links}
        </nav>

        <div className="header-actions">
          <div className="lang-switch" role="group" aria-label={t("language")}>
            {LANGS.map((l) => (
              <button key={l.code} type="button" aria-pressed={l.code === lang} className={l.code === lang ? "active" : ""} onClick={() => changeLang(l.code)} title={l.label}>
                {l.short}
              </button>
            ))}
          </div>
          {user ? (
            <>
              {user.role === "PUBLISHER" && <Link to="/post" className="btn small glow desktop-only">{t("postAd")}</Link>}
              <button className="btn small ghost desktop-only" onClick={doLogout}>{t("logout")}</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn small ghost desktop-only">{t("login")}</Link>
              <Link to="/register" className="btn small glow desktop-only">{t("register")}</Link>
            </>
          )}
          <button className="burger" aria-label={t("menu")} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(!open)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>

      <div id="mobile-menu" className={`mobile-menu ${open ? "open" : ""}`} hidden={!open}>
        <nav aria-label="Mobile">
          {links}
          {user?.role === "PUBLISHER" && <NavLink to="/post">{t("postAd")}</NavLink>}
        </nav>
        <div className="mobile-cta">
          {user ? (
            <button className="btn ghost block" onClick={doLogout}>{t("logout")}</button>
          ) : (
            <>
              <Link to="/register" className="btn glow block">{t("register")}</Link>
              <Link to="/login" className="btn ghost block">{t("login")}</Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
