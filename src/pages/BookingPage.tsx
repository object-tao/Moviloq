import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { blankBooking, blankStop, bookingSchema, quoteInput, validSchedule, type BookingInput, type BookingStop } from "../../shared/booking";
import { vehicles, type QuoteEstimate } from "../../shared/pricing";
import { ArrowIcon, TruckIcon } from "../components/Icons";
import { ApiError, getDraft, requestQuote, saveDraft } from "../lib/api";
import { bookingCopy, bookingError } from "../lib/booking-copy";
import { formatEuro } from "../lib/format";
import { useLanguage } from "../lib/i18n";

const vehicleNames = {
  bike: ["Bike", "自行车"], "cargo-bike": ["Cargo bike", "货运自行车"], car: ["Car", "轿车"],
  caddy: ["Caddy", "小型厢式车"], transporter: ["Transporter", "厢式货车"], "xl-transporter": ["XL Transporter", "加长厢式货车"]
} as const;

export function BookingPage() {
  const { language } = useLanguage();
  const t = bookingCopy(language);
  const zh = language === "zh";
  const [params, setParams] = useSearchParams();
  const draftId = params.get("draft");
  const [booking, setBooking] = useState<BookingInput>(blankBooking);
  const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
  const [existing, setExisting] = useState<{ id: string; version: number }>();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<"quote" | "save" | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState(false);
  const idempotency = useRef(crypto.randomUUID());
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setError(""); setLoadError("");
    if (!draftId) { setBooking(blankBooking()); setExisting(undefined); setReference(""); setEstimate(null); setConsent(false); setSaved(false); setLoadingDraft(false); return; }
    setLoadingDraft(true);
    getDraft(draftId).then(({ draft }) => {
      if (!active) return;
      setBooking(draft.booking); setExisting({ id: draft.id, version: draft.version }); setReference(draft.reference);
      setEstimate(draft.estimate); setConsent(true);
    }).catch((caught) => { if (active) setLoadError(bookingError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED", language)); })
      .finally(() => { if (active) setLoadingDraft(false); });
    return () => { active = false; };
    // Language changes should not reload and discard unsaved input.
  }, [draftId]);

  function change(next: BookingInput) {
    setBooking(next); setEstimate(null); setError(""); setSaved(false); idempotency.current = crypto.randomUUID();
  }
  function updateStop(index: number, stop: BookingStop) {
    if (index === -1) change({ ...booking, pickup: stop });
    else change({ ...booking, dropoffs: booking.dropoffs.map((item, i) => i === index ? stop : item) });
  }
  function moveStop(index: number, delta: number) {
    const next = [...booking.dropoffs];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change({ ...booking, dropoffs: next });
  }
  function validate(): BookingInput | null {
    const result = bookingSchema.safeParse(booking);
    if (!result.success) {
      const capacity = result.error.issues.find((issue) => ["OVERWEIGHT", "OVERSIZED"].includes(issue.message));
      setError(capacity?.message === "OVERWEIGHT" ? t.overweight : capacity ? t.oversized : t.invalid);
      return null;
    }
    if (!validSchedule(result.data)) { setError(t.invalidSchedule); return null; }
    return result.data;
  }
  async function calculate(event: FormEvent) {
    event.preventDefault(); const input = validate(); if (!input) return;
    setBusy("quote"); setError(""); setSaved(false);
    try { setEstimate(await requestQuote(quoteInput(input))); setClock(Date.now()); }
    catch { setError(t.failed); }
    finally { setBusy(null); }
  }
  async function save() {
    const input = validate(); if (!input) return;
    if (!consent) { setError(t.consentRequired); return; }
    if (!estimate || Date.parse(estimate.expiresAt) <= Date.now()) { setEstimate(null); setError(t.stale); return; }
    setBusy("save"); setError("");
    try {
      const { draft } = await saveDraft(input, idempotency.current, existing);
      setExisting({ id: draft.id, version: draft.version }); setReference(draft.reference); setEstimate(draft.estimate); setSaved(true);
      if (!draftId) setParams({ draft: draft.id }, { replace: true });
    } catch (caught) { setError(bookingError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED", language)); }
    finally { setBusy(null); }
  }

  function stopFields(stop: BookingStop, index: number) {
    const pickup = index === -1;
    return <div className="stop-card" key={pickup ? "pickup" : index}>
      <div className="stop-card-heading"><strong><span className={pickup ? "stop-marker" : "stop-marker stop-marker--orange"}>{pickup ? "A" : index + 1}</span>{pickup ? t.pickup : `${t.dropoff} ${index + 1}`}</strong>
        {!pickup && booking.dropoffs.length > 1 && <div className="stop-controls"><button type="button" className="inline-button" disabled={index === 0} onClick={() => moveStop(index, -1)} aria-label={`${t.up} ${index + 1}`}>↑</button><button type="button" className="inline-button" disabled={index === booking.dropoffs.length - 1} onClick={() => moveStop(index, 1)} aria-label={`${t.down} ${index + 1}`}>↓</button><button type="button" className="inline-button danger" onClick={() => change({ ...booking, dropoffs: booking.dropoffs.filter((_, i) => i !== index) })}>{t.remove}</button></div>}
      </div>
      <label>{t.address}<input required minLength={3} maxLength={240} autoComplete="off" placeholder={pickup ? "Frankfurt Airport, 60547 Frankfurt" : "Römerberg 26, 60311 Frankfurt"} value={stop.address} onChange={(e) => updateStop(index, { ...stop, address: e.target.value })} /></label>
      <details><summary>{t.contact} · {t.phone}</summary><div className="two-column-fields"><label>{t.contact}<input maxLength={80} value={stop.contactName} onChange={(e) => updateStop(index, { ...stop, contactName: e.target.value })} /></label><label>{t.phone}<input type="tel" maxLength={30} value={stop.phone} onChange={(e) => updateStop(index, { ...stop, phone: e.target.value })} /></label></div><label>{t.access}<input maxLength={400} value={stop.notes} onChange={(e) => updateStop(index, { ...stop, notes: e.target.value })} /></label></details>
    </div>;
  }
  const scheduledLocal = booking.scheduledAt ? new Date(Date.parse(booking.scheduledAt) - new Date(booking.scheduledAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const expired = estimate ? Date.parse(estimate.expiresAt) <= clock : false;
  return <section className="booking-page">
    <div className="container booking-heading"><span className="kicker">Frankfurt / {reference || t.newDraft}</span><h1>{t.title}</h1><p>{t.subtitle}</p><Link className="text-cta" to="/drafts">{t.drafts}<ArrowIcon /></Link></div>
    {loadingDraft ? <div className="container" role="status">{t.loadingDraft}</div> : loadError ? <div className="container form-alert" role="alert">{loadError} <Link to="/drafts">{t.drafts}</Link></div> : <div className="container booking-layout">
      <form className="booking-form booking-form--details" onSubmit={calculate}>
        <fieldset className="booking-fields" disabled={busy !== null}>
          <section className="form-section"><div className="form-section__heading"><span>1</span><div><h2>{t.route}</h2><p>{zh ? "一个提货点，最多 20 个送达点" : "One pickup. Up to 20 drop-offs."}</p></div></div>
            {stopFields(booking.pickup, -1)}{booking.dropoffs.map((stop, index) => stopFields(stop, index))}
            <button className="button button--ghost button--small add-stop" type="button" disabled={booking.dropoffs.length >= 20} onClick={() => change({ ...booking, dropoffs: [...booking.dropoffs, blankStop()] })}>+ {t.addStop}</button>
            <label>{t.distance}<input required type="number" min={1} max={500} step="0.1" value={booking.distanceKm || ""} onChange={(e) => change({ ...booking, distanceKm: Number(e.target.value) })} /></label><p className="field-note">{t.mapNote}</p>
          </section>
          <section className="form-section"><div className="form-section__heading"><span>2</span><div><h2>{t.cargo}</h2><p>{t.capacityNote}</p></div></div>
            <label>{t.description}<input required minLength={2} maxLength={160} value={booking.cargo.description} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, description: e.target.value } })} /></label>
            <div className="two-column-fields"><label>{t.quantity}<input required type="number" min={1} max={500} value={booking.cargo.quantity || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, quantity: Number(e.target.value) } })} /></label><label>{t.weight}<input required type="number" min={0.1} max={1200} step="0.1" value={booking.cargo.totalWeightKg || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, totalWeightKg: Number(e.target.value) } })} /></label></div>
            <p className="field-note">{t.dimensions}</p><div className="dimension-fields">{([['lengthCm', t.length], ['widthCm', t.width], ['heightCm', t.height]] as const).map(([field, label]) => <label key={field}>{label}<input required type="number" min={1} max={500} value={booking.cargo[field] || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, [field]: Number(e.target.value) } })} /></label>)}</div>
            <label className="simple-check"><input type="checkbox" checked={booking.cargo.fragile} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, fragile: e.target.checked } })} />{t.fragile}</label>
          </section>
          <section className="form-section"><div className="form-section__heading"><span>3</span><div><h2>{t.vehicle}</h2></div></div><div className="vehicle-options">
            {Object.values(vehicles).map((vehicle) => <label key={vehicle.id} className={`vehicle-option ${booking.vehicleId === vehicle.id ? "selected" : ""}`}><TruckIcon size={24} /><span><strong>{vehicleNames[vehicle.id][zh ? 1 : 0]}</strong><small>{vehicle.capacityKg.toLocaleString()} kg · {vehicle.cargoSizeCm.join(" × ")} cm</small></span><input type="radio" name="vehicle" value={vehicle.id} checked={booking.vehicleId === vehicle.id} onChange={() => change({ ...booking, vehicleId: vehicle.id })} /></label>)}
          </div></section>
          <section className="form-section"><div className="form-section__heading"><span>4</span><div><h2>{t.when}</h2></div></div>
            <div className="schedule-options"><label className="simple-check"><input type="radio" name="serviceType" checked={booking.serviceType === "on-demand"} onChange={() => change({ ...booking, serviceType: "on-demand", scheduledAt: null })} />{t.immediate}</label><label className="simple-check"><input type="radio" name="serviceType" checked={booking.serviceType === "scheduled"} onChange={() => change({ ...booking, serviceType: "scheduled" })} />{t.scheduled}</label></div>
            {booking.serviceType === "scheduled" && <label>{t.schedule}<input type="datetime-local" required value={scheduledLocal} onChange={(e) => { const date = new Date(e.target.value); change({ ...booking, scheduledAt: Number.isFinite(date.getTime()) ? date.toISOString() : null }); }} /><p className="field-note">{t.scheduleNote} {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></label>}
            <div className="extras-list">{([['loadingHelp', t.loading], ['helper', t.helper], ['priority', t.priority]] as const).map(([key, label]) => <label className="simple-check" key={key}><input type="checkbox" checked={booking[key]} onChange={(e) => change({ ...booking, [key]: e.target.checked })} />{label}</label>)}</div>
            <label>{t.notes}<textarea rows={3} maxLength={600} value={booking.notes} onChange={(e) => change({ ...booking, notes: e.target.value })} /></label>
          </section>
          <button className="button quote-submit" type="submit">{busy === "quote" ? t.calculating : t.calculate}<ArrowIcon /></button>
        </fieldset>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {saved && <p className="form-success" role="status">{t.saved}</p>}
      </form>
      <aside className="quote-panel" aria-live="polite"><div className="quote-panel__head"><strong>{t.current}</strong><span className="estimate-badge">{t.draftLabel}</span></div>
        {estimate ? <><div className="quote-total"><strong>{formatEuro(estimate.total, language)}</strong><span>{t.vat}</span></div><div className="quote-route"><TruckIcon /><div><strong>{vehicleNames[booking.vehicleId][zh ? 1 : 0]}</strong><span>{booking.distanceKm} km · {booking.dropoffs.length} {t.dropoff}</span></div></div>
          <dl className="breakdown">{([['base', t.base], ['distance', t.mileage], ['stops', t.stops], ['services', t.services], ['priority', t.priorityFee]] as const).filter(([key]) => estimate.breakdown[key] > 0).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatEuro(estimate.breakdown[key], language)}</dd></div>)}<div className="breakdown-subtotal"><dt>{t.net}</dt><dd>{formatEuro(estimate.net, language)}</dd></div><div><dt>{t.vat}</dt><dd>{formatEuro(estimate.vat, language)}</dd></div></dl>
          {expired ? <p className="form-alert">{t.stale}</p> : <p className="field-note">{t.savedQuote}</p>}
          <label className="simple-check consent-check"><input type="checkbox" checked={consent} disabled={busy !== null} onChange={(e) => setConsent(e.target.checked)} /><span>{t.consent} <Link to="/legal/drafts" target="_blank" rel="noreferrer">{t.privacy}</Link></span></label>
          <button type="button" className="button button--full" disabled={busy !== null || expired || !consent} onClick={() => void save()}>{busy === "save" ? t.saving : t.save}</button>
        </> : <div className="quote-empty"><div className="quote-empty__icon"><TruckIcon size={34} /></div><h3>{t.empty}</h3><p>{t.emptyText}</p></div>}
        <p className="quote-disclaimer">{t.note}</p>
      </aside>
    </div>}
  </section>;
}
