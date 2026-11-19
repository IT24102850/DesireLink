import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";
import { DISTRICTS } from "../../shared/locations.js";
import { AD_TAGS, LIMITS } from "../../shared/constants.js";
import { ErrorText, Notice, Spinner, useDocumentTitle } from "../components/ui.jsx";

const EMPTY = { gender: "", title: "", description: "", districtId: "", contactPhone: "", tags: [] };

export default function PostAd() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [verification, setVerification] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [kept, setKept] = useState([]); // existing photos kept when editing
  const [added, setAdded] = useState([]); // File[]
  const [err, setErr] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useDocumentTitle(editing ? t("editAd") : t("postAd"));

  useEffect(() => {
    api.myVerification().then(setVerification).catch(setLoadErr);
    if (editing) {
      api
        .getAd(id)
        .then((ad) => {
          setF({
            gender: ad.gender,
            title: ad.title,
            description: ad.description,
            districtId: String(ad.districtId),
            contactPhone: ad.contactPhone || "",
            tags: ad.tags || [],
          });
          setKept(ad.photos || []);
        })
        .catch(setLoadErr);
    }
  }, [id, editing]);

  const previews = useMemo(() => added.map((file) => ({ file, url: URL.createObjectURL(file) })), [added]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  if (loadErr) return <div className="card narrow"><ErrorText error={loadErr} /></div>;
  if (!verification) return <Spinner />;

  if (verification.status !== "APPROVED") {
    return (
      <div className="card form narrow">
        <h1>{t("postAd")}</h1>
        <Notice kind="warn">{t("verifyFirst")}</Notice>
        <Link className="btn glow block" to="/verify">{t("goVerify")}</Link>
      </div>
    );
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleTag = (k) => setF({ ...f, tags: f.tags.includes(k) ? f.tags.filter((x) => x !== k) : [...f.tags, k] });
  const slots = LIMITS.photosPerAd - kept.length - added.length;
  const nicGender = verification.gender; // male | female

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fields = { ...f, tags: f.tags };
      if (editing) await api.updateAd(id, { ...fields, keepPhotos: JSON.stringify(kept.map((p) => p.id)) }, added);
      else await api.createAd(fields, added);
      setDone(true);
      setTimeout(() => nav("/my-ads"), 1400);
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form wide" onSubmit={submit}>
      <h1>{editing ? t("editAd") : t("postAd")}</h1>
      <Notice>{t("yourAgeAuto", { age: verification.age })}</Notice>
      {editing && <Notice kind="warn">{t("editResubmitNote")}</Notice>}

      <fieldset className="gender-choice">
        <legend>{t("gender")}</legend>
        {["female", "male", "transgender"].map((g) => {
          const disabled = g !== "transgender" && g !== nicGender;
          return (
            <label key={g} className={`pill big ${g} ${f.gender === g ? "active" : ""} ${disabled ? "disabled" : ""}`}>
              <input type="radio" name="gender" value={g} checked={f.gender === g} disabled={disabled} onChange={set("gender")} required />
              {t(g)}
            </label>
          );
        })}
        <small className="muted">{t("genderMatchNote")}</small>
      </fieldset>

      <label>
        {t("title")}
        <input required minLength={3} maxLength={LIMITS.titleMax} value={f.title} onChange={set("title")} />
        <small className="muted">{t("titleHint")} · {f.title.length}/{LIMITS.titleMax}</small>
      </label>
      <label>
        {t("description")}
        <textarea required rows={6} minLength={LIMITS.descriptionMin} maxLength={LIMITS.descriptionMax} value={f.description} onChange={set("description")} />
        <small className="muted">{t("descriptionHint")} · {f.description.length}/{LIMITS.descriptionMax}</small>
      </label>
      <label>
        {t("district")}
        <select required value={f.districtId} onChange={set("districtId")}>
          <option value="">—</option>
          {[...DISTRICTS].sort((a, b) => a[lang].localeCompare(b[lang], lang)).map((d) => (
            <option key={d.id} value={d.id}>{d[lang]}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t("lookingFor")}</legend>
        <div className="chips">
          {AD_TAGS.map((k) => (
            <button type="button" key={k} className={`chip toggle ${f.tags.includes(k) ? "active" : ""}`} aria-pressed={f.tags.includes(k)} onClick={() => toggleTag(k)}>
              {t(`tag.${k}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>{t("photos")}</legend>
        <small className="muted">{t("photosHint")}</small>
        <div className="photo-grid">
          {kept.map((p) => (
            <div key={p.id} className="photo-slot">
              <img src={p.url} alt="" />
              <button type="button" className="icon-btn remove" aria-label={t("removePhoto")} onClick={() => setKept(kept.filter((x) => x.id !== p.id))}>×</button>
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={p.url} className="photo-slot">
              <img src={p.url} alt="" />
              <button type="button" className="icon-btn remove" aria-label={t("removePhoto")} onClick={() => setAdded(added.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {slots > 0 && (
            <label className="photo-slot add">
              <span aria-hidden="true">＋</span>
              <span className="small">{t("addPhotos")}</span>
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                onChange={(e) => {
                  const list = [...(e.target.files || [])].slice(0, slots);
                  setAdded([...added, ...list]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </fieldset>

      <label>
        {t("contactPhone")}
        <input type="tel" inputMode="tel" placeholder="077 123 4567" value={f.contactPhone} onChange={set("contactPhone")} />
        <small className="muted">{t("contactPhoneHelp")}</small>
      </label>

      <ErrorText error={err} />
      {done && <p className="ok-text" role="status">{t("adSubmitted")}</p>}
      <button className="btn glow block" disabled={busy || done}>{busy ? t("loading") : editing ? t("saveChanges") : t("publish")}</button>
    </form>
  );
}
