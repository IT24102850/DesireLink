import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import { DISTRICTS } from "../../shared/locations.js";
import { AD_TAGS } from "../../shared/constants.js";
import AdCard from "../components/AdCard.jsx";
import { ErrorText, Spinner, useDocumentTitle } from "../components/ui.jsx";

const KEYS = ["gender", "ageMin", "ageMax", "districtId", "tags"];
const fromParams = (p) => Object.fromEntries(KEYS.map((k) => [k, p.get(k) || ""]));

export default function Home() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => fromParams(params), [params]);
  const [form, setForm] = useState(applied);
  const [state, setState] = useState({ items: [], total: 0, page: 1, loading: true, error: null });
  const [drawer, setDrawer] = useState(false);
  useDocumentTitle("");

  useEffect(() => setForm(applied), [applied]);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .listAds({ ...applied, page: 1 })
      .then((r) => alive && setState({ items: r.items, total: r.total, page: 1, loading: false, error: null, pageSize: r.pageSize }))
      .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: e })));
    return () => {
      alive = false;
    };
  }, [applied]);

  const loadMore = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.listAds({ ...applied, page: state.page + 1 });
      setState((s) => ({ ...s, items: [...s.items, ...r.items], page: r.page, total: r.total, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  };

  const apply = (next) => {
    const p = new URLSearchParams();
    for (const k of KEYS) if (next[k]) p.set(k, next[k]);
    setParams(p, { replace: false });
    setDrawer(false);
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const selectedTags = form.tags ? form.tags.split(",") : [];
  const toggleTag = (k) => {
    const next = selectedTags.includes(k) ? selectedTags.filter((x) => x !== k) : [...selectedTags, k];
    const f = { ...form, tags: next.join(",") };
    setForm(f);
    apply(f);
  };
  const quickGender = (g) => {
    const f = { ...form, gender: form.gender === g ? "" : g };
    setForm(f);
    apply(f);
  };
  const activeCount = KEYS.filter((k) => applied[k]).length;

  return (
    <>
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy">
          <span className="eyebrow">{t("heroEyebrow")}</span>
          <h1>
            {t("heroTitle")} <em>{t("heroAccent")}</em>
          </h1>
          <p>{t("heroText")}</p>
          <div className="hero-actions">
            <a href="#browse" className="btn glow">{t("heroCta")}</a>
            <Link to={user ? "/post" : "/register"} className="btn ghost">{t("heroCtaPublish")}</Link>
          </div>
          <ul className="trust-row">
            <li>{t("trustVerified")}</li>
            <li>{t("trustAdults")}</li>
            <li>{t("trustPrivate")}</li>
          </ul>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-ring" />
          <img src="/logo-mark.png" alt="" width="320" height="301" />
        </div>
      </section>

      <section id="browse" className="browse">
        <div className="quick-bar">
          <div className="gender-pills" role="group" aria-label={t("gender")}>
            {["female", "male", "transgender"].map((g) => (
              <button key={g} type="button" className={`pill ${g} ${applied.gender === g ? "active" : ""}`} aria-pressed={applied.gender === g} onClick={() => quickGender(g)}>
                {t(g)}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost small filter-toggle" onClick={() => setDrawer(true)} aria-controls="filters">
            {t("filters")} {activeCount > 0 && <span className="count">{activeCount}</span>}
          </button>
        </div>

        <div className="chips scroll" role="group" aria-label={t("lookingFor")}>
          {AD_TAGS.map((k) => (
            <button key={k} type="button" className={`chip toggle ${selectedTags.includes(k) ? "active" : ""}`} aria-pressed={selectedTags.includes(k)} onClick={() => toggleTag(k)}>
              {t(`tag.${k}`)}
            </button>
          ))}
        </div>

        <div className="layout">
          <aside id="filters" className={`filters ${drawer ? "open" : ""}`} aria-label={t("filters")}>
            <div className="filters-head">
              <h2>{t("refineSearch")}</h2>
              <button type="button" className="icon-btn drawer-close" aria-label={t("close")} onClick={() => setDrawer(false)}>×</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                apply(form);
              }}
            >
              <label>
                {t("gender")}
                <select value={form.gender} onChange={set("gender")}>
                  <option value="">{t("all")}</option>
                  <option value="female">{t("female")}</option>
                  <option value="male">{t("male")}</option>
                  <option value="transgender">{t("transgender")}</option>
                </select>
              </label>
              <fieldset className="age-range">
                <legend>{t("ageRange")}</legend>
                <label>
                  <span className="sr-only">{t("ageRange")} </span>{t("ageFrom")}
                  <input type="number" inputMode="numeric" min="18" max="99" placeholder="18" value={form.ageMin} onChange={set("ageMin")} />
                </label>
                <span className="dash" aria-hidden="true">–</span>
                <label>
                  <span className="sr-only">{t("ageRange")} </span>{t("ageTo")}
                  <input type="number" inputMode="numeric" min="18" max="99" placeholder="99" value={form.ageMax} onChange={set("ageMax")} />
                </label>
              </fieldset>
              <label>
                {t("district")}
                <select value={form.districtId} onChange={set("districtId")}>
                  <option value="">{t("anyDistrict")}</option>
                  {[...DISTRICTS]
                    .sort((a, b) => a[lang].localeCompare(b[lang], lang))
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d[lang]}</option>
                    ))}
                </select>
              </label>
              <button className="btn glow block" type="submit">{t("search")}</button>
              <button type="button" className="btn ghost block" onClick={() => apply({ gender: "", ageMin: "", ageMax: "", districtId: "", tags: "" })}>
                {t("clearFilters")}
              </button>
            </form>
          </aside>
          {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} />}

          <section aria-live="polite" aria-busy={state.loading}>
            <p className="results-count">{t("resultsCount", { n: state.total })}</p>
            <ErrorText error={state.error} />
            {!state.loading && !state.error && state.items.length === 0 && (
              <div className="empty">
                <p>{t("noAds")}</p>
                <p className="muted">{t("noAdsHint")}</p>
              </div>
            )}
            <div className="grid">
              {state.items.map((a) => (
                <AdCard key={a.id} ad={a} />
              ))}
            </div>
            {state.loading && <Spinner />}
            {!state.loading && state.items.length < state.total && (
              <div className="center">
                <button className="btn ghost" onClick={loadMore}>{t("loadMore")}</button>
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
}
