import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import AgeGate from "./components/AgeGate.jsx";
import { Spinner } from "./components/ui.jsx";
import { AuthProvider, RequireRole } from "./auth.jsx";
import { useI18n } from "./i18n";
import Home from "./pages/Home.jsx";
import AdDetail from "./pages/AdDetail.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ConfirmEmail from "./pages/ConfirmEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import Legal from "./pages/Legal.jsx";
import NotFound from "./pages/NotFound.jsx";

const Verify = lazy(() => import("./pages/Verify.jsx"));
const PostAd = lazy(() => import("./pages/PostAd.jsx"));
const MyAds = lazy(() => import("./pages/MyAds.jsx"));
const Account = lazy(() => import("./pages/Account.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  const { t } = useI18n();
  return (
    <AuthProvider>
      <ScrollToTop />
      <AgeGate />
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main" className="container main">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/ad/:id" element={<AdDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/legal/:doc" element={<Legal />} />
            <Route path="/confirm-email" element={<RequireRole><ConfirmEmail /></RequireRole>} />
            <Route path="/account" element={<RequireRole><Account /></RequireRole>} />
            <Route path="/verify" element={<RequireRole role="PUBLISHER"><Verify /></RequireRole>} />
            <Route path="/post" element={<RequireRole role="PUBLISHER"><PostAd /></RequireRole>} />
            <Route path="/edit/:id" element={<RequireRole role="PUBLISHER"><PostAd /></RequireRole>} />
            <Route path="/my-ads" element={<RequireRole role="PUBLISHER"><MyAds /></RequireRole>} />
            <Route path="/admin" element={<RequireRole role="ADMIN"><Admin /></RequireRole>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <img src="/logo-mark.png" alt="" width="40" height="38" />
            <div>
              <strong className="wordmark small">Desire<span>Link</span></strong>
              <p>{t("footerAdults")}</p>
            </div>
          </div>
          <nav className="footer-links" aria-label="Legal">
            <Link to="/legal/terms">{t("terms")}</Link>
            <Link to="/legal/content">{t("contentPolicy")}</Link>
            <Link to="/legal/privacy">{t("privacy")}</Link>
          </nav>
          <p className="footer-note">{t("footerReport")}</p>
          <p className="footer-note">© {new Date().getFullYear()} DesireLink · 18+</p>
        </div>
      </footer>
    </AuthProvider>
  );
}
