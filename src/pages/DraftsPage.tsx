import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SavedDraft } from "../../shared/booking";
import { ApiError, deleteDraft, listDrafts } from "../lib/api";
import { bookingCopy, bookingError } from "../lib/booking-copy";
import { useLanguage } from "../lib/i18n";
import { formatEuro } from "../lib/format";
import { ArrowIcon, TruckIcon } from "../components/Icons";

export function DraftsPage() {
  const { language } = useLanguage();
  const t = bookingCopy(language);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    listDrafts().then((result) => { if (active) setDrafts(result.drafts); }).catch((caught) => {
      if (active) setError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  async function remove(draft: SavedDraft) {
    setDeleting(draft.id); setError("");
    try { await deleteDraft(draft); setDrafts((current) => current.filter((item) => item.id !== draft.id)); setConfirming(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED"); }
    finally { setDeleting(null); }
  }
  const date = (value: string) => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <section className="drafts-page"><div className="container">
    <div className="drafts-heading"><div><span className="kicker">Moviloq / {t.draftLabel}</span><h1>{t.drafts}</h1></div><Link className="button" to="/book">{t.newDraft}<ArrowIcon /></Link></div>
    <p className="workspace-note">{t.workspaceNote} <Link to="/legal/drafts">{t.privacy}</Link></p>
    {error && <div className="form-alert" role="alert">{bookingError(error, language)} <button className="inline-button" onClick={() => setReload((value) => value + 1)}>{t.retry}</button></div>}
    {loading ? <p role="status">{t.loadingDraft}</p> : drafts.length === 0 && !error ? <div className="draft-empty"><TruckIcon size={45} /><h2>{t.noDrafts}</h2><p>{t.noDraftsText}</p><Link className="button button--ghost" to="/book">{t.newDraft}</Link></div> : <div className="draft-grid">
      {drafts.map((draft) => <article className="draft-card" key={draft.id}>
        <div className="draft-card-top"><span className="estimate-badge">{t.draftLabel}</span><span>{draft.reference}</span></div>
        <h2>{draft.booking.cargo.description}</h2>
        <div className="draft-address"><span>A</span><p>{draft.booking.pickup.address}</p></div>
        <div className="draft-address"><span>B</span><p>{draft.booking.dropoffs.map((stop) => stop.address).join(" → ")}</p></div>
        <div className="draft-meta"><strong>{formatEuro(draft.estimate.total, language)}</strong><span>{draft.booking.distanceKm} km · {draft.booking.dropoffs.length} {t.dropoff}</span></div>
        <p className="draft-dates">{t.updated}: {date(draft.updatedAt)}<br />{t.expires}: {date(draft.expiresAt)}</p>
        {confirming === draft.id ? <div className="draft-delete-confirm"><p>{t.confirmDelete}</p><button className="inline-button danger" disabled={deleting !== null} onClick={() => void remove(draft)}>{deleting ? t.saving : t.delete}</button><button className="inline-button" onClick={() => setConfirming(null)}>{t.cancel}</button></div> : <div className="draft-actions"><Link to={`/book?draft=${draft.id}`} className="button button--ghost button--small">{t.edit}<ArrowIcon /></Link><button className="inline-button danger" onClick={() => setConfirming(draft.id)}>{t.delete}</button></div>}
      </article>)}
    </div>}
  </div></section>;
}
