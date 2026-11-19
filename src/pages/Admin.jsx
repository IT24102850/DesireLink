import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api.js";
import { districtName } from "../../shared/locations.js";
import { Dialog, ErrorText, ImageField, Notice, ReasonDialog, Spinner, StatusBadge, useDocumentTitle } from "../components/ui.jsx";
import { checkNicEligibility } from "../../shared/nic.js";
import { normalizeLkPhone } from "../../shared/constants.js";

const TABS = ["stats", "verifications", "ads", "reports", "users", "audit"];

export default function Admin() {
  const { t } = useI18n();
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  useDocumentTitle(t("admin"));

  const loadStats = useCallback(() => api.admin.stats().then(setStats).catch(() => {}), []);
  useEffect(() => {
    loadStats();
  }, [loadStats, tab]);

  const badge = { verifications: stats?.pendingVerifications, ads: stats?.pendingAds, reports: stats?.openReports };

  return (
    <div className="admin">
      <h1>{t("admin")}</h1>
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
            {t(`tab${k[0].toUpperCase() + k.slice(1)}`)}
            {badge[k] > 0 && <span className="count">{badge[k]}</span>}
          </button>
        ))}
      </div>
      {tab === "stats" && <Stats stats={stats} go={setTab} />}
      {tab === "verifications" && <Verifications onChange={loadStats} />}
      {tab === "ads" && <Ads onChange={loadStats} />}
      {tab === "reports" && <Reports onChange={loadStats} />}
      {tab === "users" && <Users />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useFmt() {
  const { lang } = useI18n();
  return (d) => (d ? new Date(d).toLocaleString(lang === "en" ? "en-GB" : lang + "-LK") : "");
}

function StatusFilter({ value, options, onChange, prefix = "status." }) {
  const { t } = useI18n();
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o} className={value === o ? "active" : ""} aria-pressed={value === o} onClick={() => onChange(o)}>
          {t(prefix + o)}
        </button>
      ))}
    </div>
  );
}

function Pager({ page, total, pageSize, onPage }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn ghost small" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("prev")}</button>
      <span>{t("pageOf", { page, pages })}</span>
      <button className="btn ghost small" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("next")}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------
function Stats({ stats, go }) {
  const { t } = useI18n();
  if (!stats) return <Spinner />;
  const link = { pendingVerifications: "verifications", pendingAds: "ads", openReports: "reports" };
  return (
    <div className="stat-grid">
      {Object.entries(stats).map(([k, v]) => (
        <button key={k} className={`stat ${link[k] && v > 0 ? "hot" : ""}`} onClick={() => link[k] && go(link[k])} disabled={!link[k]}>
          <span className="stat-value">{v}</span>
          <span className="stat-label">{t(`stats.${k}`)}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------
function Verifications({ onChange }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const [status, setStatus] = useState("PENDING");
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [nics, setNics] = useState({});
  const [rejecting, setRejecting] = useState(null);

  const load = useCallback(() => {
    setItems(null);
    api.admin.verifications(status).then((r) => setItems(r.items)).catch(setErr);
  }, [status]);
  useEffect(load, [load]);

  const review = async (id, approve, reason) => {
    setErr(null);
    try {
      await api.admin.reviewVerification(id, approve, reason);
      load();
      onChange();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <>
      <StatusFilter value={status} options={["PENDING", "APPROVED", "REJECTED"]} onChange={setStatus} />
      <ErrorText error={err} />
      {!items && <Spinner />}
      {items?.length === 0 && <p className="muted">{t("nothingPending")}</p>}
      {status === "PENDING" && items?.length > 0 && <p className="notice info">{t("adminChecklist")}</p>}
      {items?.map((v) => (
        <div key={v.id} className="card review">
          <div className="review-head">
            <div>
              <strong>{v.email}</strong> · {v.phone}
              <div className="muted small">{t("accountCreated")}: {fmt(v.accountCreated)} · {t("submitted")}: {fmt(v.submittedAt)}</div>
            </div>
            <StatusBadge status={v.status} />
          </div>
          <dl className="kv inline">
            <dt>{t("nicNumber")}</dt>
            <dd>
              <code>{nics[v.id] || v.nicMasked}</code>{" "}
              {!nics[v.id] && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      const r = await api.admin.revealNic(v.id);
                      setNics((n) => ({ ...n, [v.id]: r.nic }));
                    } catch (e) {
                      setErr(e);
                    }
                  }}
                >
                  {t("showNic")}
                </button>
              )}
            </dd>
            <dt>{t("birthDate")}</dt><dd>{v.birthDate}</dd>
            <dt>{t("age")}</dt><dd>{v.age}</dd>
            <dt>{t("gender")}</dt><dd>{t(v.gender)}</dd>
          </dl>
          {v.images ? (
            <div className="id-images">
              {[["front", t("nicFront")], ["back", t("nicBack")], ["selfie", t("selfie")]].map(([k, label]) => (
                <figure key={k}>
                  <a href={v.images[k]} target="_blank" rel="noreferrer"><img src={v.images[k]} alt={label} loading="lazy" /></a>
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted small">{t("idImagesDeleted")}</p>
          )}
          {v.rejectionReason && <p className="error small">{t("reason")}: {v.rejectionReason}</p>}
          {v.status === "PENDING" && (
            <div className="row">
              <button className="btn ok" onClick={() => review(v.id, true)}>{t("approve")}</button>
              <button className="btn danger" onClick={() => setRejecting(v.id)}>{t("reject")}</button>
            </div>
          )}
        </div>
      ))}
      <ReasonDialog
        open={Boolean(rejecting)}
        title={t("reject")}
        label={t("rejectReasonPrompt")}
        onCancel={() => setRejecting(null)}
        onSubmit={(reason) => {
          const id = rejecting;
          setRejecting(null);
          review(id, false, reason);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------
function Ads({ onChange }) {
  const { t, lang } = useI18n();
  const fmt = useFmt();
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState(null); // { id, action }

  const load = useCallback(() => {
    setData(null);
    api.admin.ads(status, page).then(setData).catch(setErr);
  }, [status, page]);
  useEffect(load, [load]);

  const act = async (id, action, reason) => {
    setErr(null);
    try {
      await api.admin.reviewAd(id, action, reason);
      load();
      onChange();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <>
      <StatusFilter value={status} options={["PENDING_REVIEW", "APPROVED", "REJECTED", "REMOVED"]} onChange={(s) => { setStatus(s); setPage(1); }} />
      <ErrorText error={err} />
      {!data && <Spinner />}
      {data?.items.length === 0 && <p className="muted">{t("nothingPending")}</p>}
      {data?.items.map((a) => (
        <div key={a.id} className="card review">
          <div className="review-head">
            <div>
              <Link to={`/p/${a.id}`} target="_blank"><strong>{a.title}</strong></Link>
              <div className="muted small">
                {t(a.gender)} · {a.age} {t("years")} · {districtName(a.districtId, lang)} · {t("publisher")}: {a.publisherEmail}
                {a.publisherBanned && <> · <span className="error">{t("banned")}</span></>}
              </div>
              <div className="muted small">{fmt(a.createdAt)}{a.openReports > 0 && <> · <span className="error">{a.openReports} {t("openReports")}</span></>}</div>
            </div>
            <StatusBadge status={a.status} />
          </div>
          {a.gender === "transgender" && <p className="notice warn small">NIC: {t(a.nicGender)} → {t("transgender")}</p>}
          {a.photos?.length > 0 && (
            <div className="review-photos">
              {a.photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" loading="lazy" /></a>)}
            </div>
          )}
          <p className="desc">{a.description}</p>
          {a.tags?.length > 0 && <div className="chips small">{a.tags.map((k) => <span key={k} className="chip">{t(`tag.${k}`)}</span>)}</div>}
          {a.rejectReason && <p className="error small">{t("reason")}: {a.rejectReason}</p>}
          <div className="row wrap">
            {a.status === "PENDING_REVIEW" && (
              <>
                <button className="btn ok" onClick={() => act(a.id, "approve")}>{t("approve")}</button>
                <button className="btn danger" onClick={() => setPending({ id: a.id, action: "reject" })}>{t("reject")}</button>
              </>
            )}
            {a.status !== "REMOVED" && <button className="btn ghost danger" onClick={() => setPending({ id: a.id, action: "remove" })}>{t("remove")}</button>}
          </div>
        </div>
      ))}
      {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      <ReasonDialog
        open={Boolean(pending)}
        title={pending ? t(pending.action) : ""}
        label={t("rejectReasonPrompt")}
        onCancel={() => setPending(null)}
        onSubmit={(reason) => {
          const p = pending;
          setPending(null);
          act(p.id, p.action, reason);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------
function Reports({ onChange }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const [status, setStatus] = useState("OPEN");
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(() => {
    setItems(null);
    api.admin.reports(status).then((r) => setItems(r.items)).catch(setErr);
  }, [status]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setErr(null);
    try {
      await fn();
      load();
      onChange();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <>
      <StatusFilter value={status} options={["OPEN", "RESOLVED", "DISMISSED"]} onChange={setStatus} prefix="report.status." />
      <ErrorText error={err} />
      {!items && <Spinner />}
      {items?.length === 0 && <p className="muted">{t("nothingPending")}</p>}
      {items?.map((r) => (
        <div key={r.id} className={`card review ${r.reason === "MINOR" || r.reason === "NON_CONSENSUAL" ? "urgent" : ""}`}>
          <div className="review-head">
            <div>
              <strong>{t(`report.${r.reason}`)}</strong>
              <div className="muted small">{fmt(r.createdAt)}</div>
            </div>
            <StatusBadge status={r.ad.status} />
          </div>
          {r.details && <p className="desc">“{r.details}”</p>}
          <p><Link to={`/p/${r.ad.id}`} target="_blank">{r.ad.title}</Link></p>
          {r.status === "OPEN" && (
            <div className="row wrap">
              {r.ad.status !== "REMOVED" && <button className="btn danger" onClick={() => setRemoving(r.ad.id)}>{t("remove")}</button>}
              <button className="btn ghost" onClick={() => run(() => api.admin.resolveReport(r.id, "resolve"))}>{t("resolve")}</button>
              <button className="btn ghost" onClick={() => run(() => api.admin.resolveReport(r.id, "dismiss"))}>{t("dismiss")}</button>
            </div>
          )}
        </div>
      ))}
      <ReasonDialog
        open={Boolean(removing)}
        title={t("remove")}
        label={t("rejectReasonPrompt")}
        onCancel={() => setRemoving(null)}
        onSubmit={(reason) => {
          const id = removing;
          setRemoving(null);
          run(() => api.admin.reviewAd(id, "remove", reason));
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------
function Users() {
  const { t } = useI18n();
  const fmt = useFmt();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [banning, setBanning] = useState(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.admin.users(query, page).then(setData).catch(setErr);
  }, [query, page]);
  useEffect(load, [load]);

  const setBanned = async (id, banned, reason) => {
    setErr(null);
    try {
      await api.admin.setBanned(id, banned, reason);
      load();
    } catch (e) {
      setErr(e);
    }
  };

  const resend = async (u) => {
    setErr(null);
    setMsg("");
    try {
      await api.admin.resendInvite(u.id);
      setMsg(t("inviteSent", { email: u.email }));
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <>
      <div className="users-toolbar">
        <form className="search-row" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q.trim()); }}>
          <input type="search" placeholder={t("searchUsers")} aria-label={t("searchUsers")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">{t("search")}</button>
        </form>
        <button className="btn glow" onClick={() => { setMsg(""); setAdding(true); }}>＋ {t("addPublisher")}</button>
      </div>
      {msg && <p className="ok-text" role="status">{msg}</p>}
      <ErrorText error={err} />
      {!data && <Spinner />}
      {data?.items.length === 0 && <p className="muted">{t("nothingPending")}</p>}
      <div className="user-list">
        {data?.items.map((u) => (
          <div key={u.id} className="card user-row">
            <div>
              <strong>{u.email}</strong> · {u.phone}
              <div className="muted small">
                {fmt(u.createdAt)} · {u.ads} {t("tabAds").toLowerCase()}
                {!u.emailVerified && <> · {t("emailUnverified")}</>}
              </div>
              {u.banned && u.bannedReason && <div className="error small">{t("reason")}: {u.bannedReason}</div>}
            </div>
            <div className="row">
              {u.invited && <span className="badge warn">{t("notActivated")}</span>}
              <StatusBadge status={u.status} />
              {u.banned && <span className="badge bad">{t("banned")}</span>}
              {u.invited && !u.banned && <button className="btn small ghost" onClick={() => resend(u)}>{t("resendInvite")}</button>}
              <button className={`btn small ${u.banned ? "ghost" : "danger"}`} onClick={() => (u.banned ? setBanned(u.id, false) : setBanning(u.id))}>
                {u.banned ? t("unban") : t("ban")}
              </button>
            </div>
          </div>
        ))}
      </div>
      {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      <AddPublisher
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(email) => {
          setAdding(false);
          setMsg(t("publisherCreated", { email }));
          setPage(1);
          setQuery("");
          load();
        }}
      />
      <ReasonDialog
        open={Boolean(banning)}
        title={t("ban")}
        label={t("banReasonPrompt")}
        onCancel={() => setBanning(null)}
        onSubmit={(reason) => {
          const id = banning;
          setBanning(null);
          setBanned(id, true, reason);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------
// Admin adds a publisher on someone's behalf. The account stays inactive until
// the person activates it from the emailed link (own password + terms).
const EMPTY_PUBLISHER = { email: "", phone: "", locale: "si", nic: "", consent: false };

function AddPublisher({ open, onClose, onCreated }) {
  const { t } = useI18n();
  const [f, setF] = useState(EMPTY_PUBLISHER);
  const [files, setFiles] = useState({ front: null, back: null, selfie: null });
  const [withId, setWithId] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setF(EMPTY_PUBLISHER);
      setFiles({ front: null, back: null, selfie: null });
      setWithId(false);
      setErr(null);
    }
  }, [open]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const phoneBad = Boolean(f.phone) && !normalizeLkPhone(f.phone);
  const preview = withId && f.nic.trim() ? checkNicEligibility(f.nic) : null;
  const idReady = !withId || Boolean(preview?.valid && files.front && files.back && files.selfie);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fields = { email: f.email, phone: f.phone, locale: f.locale, consent: f.consent ? "true" : "false", nic: withId ? f.nic : "" };
      await api.admin.createPublisher(fields, withId ? files : {});
      onCreated(f.email.trim().toLowerCase());
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={t("addPublisher")} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted small">{t("addPublisherText")}</p>
        <label>
          {t("email")}
          <input type="email" required maxLength={254} value={f.email} onChange={set("email")} />
        </label>
        <label>
          {t("phone")}
          <input type="tel" inputMode="tel" required placeholder="077 123 4567" aria-invalid={phoneBad || undefined} value={f.phone} onChange={set("phone")} />
          {phoneBad && <small className="error">{t("err.INVALID_PHONE")}</small>}
        </label>
        <label>
          {t("emailLanguage")}
          <select value={f.locale} onChange={set("locale")}>
            <option value="si">සිංහල</option>
            <option value="ta">தமிழ்</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="check-label">
          <input type="checkbox" checked={withId} onChange={(e) => setWithId(e.target.checked)} />
          <span>{t("addIdNow")}</span>
        </label>
        {withId && (
          <fieldset className="stack">
            <label>
              {t("nicNumber")}
              <input
                value={f.nic}
                onChange={(e) => setF({ ...f, nic: e.target.value.toUpperCase() })}
                placeholder="200012345678 / 851000123V"
                autoComplete="off"
                spellCheck={false}
                maxLength={14}
                required
              />
            </label>
            {preview && (
              <div className={"nic-preview " + (preview.valid ? "ok" : "bad")}>
                {(preview.valid || preview.error === "UNDERAGE") && (
                  <dl className="kv inline">
                    <dt>{t("birthDate")}</dt><dd>{preview.birthDate}</dd>
                    <dt>{t("age")}</dt><dd>{preview.age}</dd>
                    <dt>{t("gender")}</dt><dd>{t(preview.gender)}</dd>
                  </dl>
                )}
                {!preview.valid && <p className="error">{t("err." + preview.error)}</p>}
              </div>
            )}
            <div className="id-photos">
              <ImageField label={t("nicFront")} value={files.front} onChange={(x) => setFiles({ ...files, front: x })} required />
              <ImageField label={t("nicBack")} value={files.back} onChange={(x) => setFiles({ ...files, back: x })} required />
              <ImageField label={t("selfie")} value={files.selfie} onChange={(x) => setFiles({ ...files, selfie: x })} required />
            </div>
            <small className="muted">{t("addIdNote")}</small>
          </fieldset>
        )}

        <label className="check-label consent-box">
          <input type="checkbox" required checked={f.consent} onChange={set("consent")} />
          <span>{t("consentConfirm")}</span>
        </label>
        <Notice>{t("inviteExplain")}</Notice>
        <ErrorText error={err} />
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button>
          <button className="btn glow" disabled={busy || !f.consent || phoneBad || !idReady}>{busy ? t("loading") : t("createAndInvite")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------
function Audit() {
  const fmt = useFmt();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.admin.audit(page).then(setData).catch(setErr);
  }, [page]);
  return (
    <>
      <ErrorText error={err} />
      {!data && <Spinner />}
      {data && (
        <div className="table-wrap">
          <table className="audit">
            <thead>
              <tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>{fmt(a.createdAt)}</td>
                  <td>{a.admin}</td>
                  <td><code>{a.action}</code></td>
                  <td>{a.targetType}:{a.targetId.slice(-8)}</td>
                  <td className="small">{a.details ? Object.values(a.details).join(" · ") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
    </>
  );
}
