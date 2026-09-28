import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { blankBooking, blankStop, createBookingSchema, quoteInput, validSchedule, type BookingInput, type BookingStop } from "../../shared/booking";
import { vehicles, type QuoteEstimate, type VehicleReference } from "../../shared/pricing";
import { bookingCountry } from "../../shared/locations";
import { ArrowIcon, TruckIcon } from "../components/Icons";
import { ApiError, getDraft, getVehicleCatalog, requestQuote, saveDraft } from "../lib/api";
import { bookingCopy, bookingError } from "../lib/booking-copy";
import { formatCurrency } from "../lib/format";
import { useLanguage } from "../lib/i18n";

import { useSettings } from "../lib/settings";

const vehicleNames = {
  bike: ["Bike", "自行车"], "cargo-bike": ["Cargo bike", "货运自行车"], car: ["Car", "轿车"],
  caddy: ["Caddy", "小型厢式车"], transporter: ["Transporter", "厢式货车"], "xl-transporter": ["XL Transporter", "加长厢式货车"],
  "heavy-datongdao-5-axle": ["Datongdao · 5 axles", "大通道5轴"], "heavy-datongdao-6-axle": ["Datongdao · 6 axles", "大通道6轴"],
  "heavy-120m3-5-axle": ["120 m³ truck · 5 axles", "120立方车5轴"], "heavy-120m3-6-axle": ["120 m³ truck · 6 axles", "120立方车6轴"],
  "heavy-130m3": ["130 m³ truck", "130立方车"], "heavy-140m3": ["140 m³ truck", "140立方车"],
  "heavy-flatbed-13m-5-axle": ["13 m flatbed · 5 axles", "13米平板5轴"], "heavy-flatbed-13m-6-axle": ["13 m flatbed · 6 axles", "13米平板6轴"],
  "heavy-flatbed-17m-5-axle": ["17 m flatbed · 5 axles", "17米平板车5轴"], "heavy-flatbed-17m-6-axle": ["17 m flatbed · 6 axles", "17米平板车6轴"]
} as const;

export function BookingPage() {
  const { language } = useLanguage();
  const {countries,parameters,ready:settingsReady,failed:settingsFailed}=useSettings();
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
  const [catalog, setCatalog] = useState(vehicles);
  const [referenceCatalog, setReferenceCatalog] = useState<VehicleReference[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  useEffect(() => {
    let active = true;
    getVehicleCatalog().then(result => { if (active) { setCatalog(Object.fromEntries(result.vehicles.map(vehicle => [vehicle.id, vehicle])) as typeof vehicles); setReferenceCatalog(result.references ?? []); setCatalogReady(true); } }).catch(() => { if (active) setError(t.failed); });
    return () => { active = false; };
  }, []);
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
    }).catch((caught) => { if (active) setLoadError(bookingError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED", language,parameters)); })
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
    if (!catalogReady || !settingsReady) { setError(t.failed); return null; }
    const result = createBookingSchema(catalog,countries,parameters).safeParse(booking);
    if (!result.success) {
      const capacity = result.error.issues.find((issue) => ["OVERWEIGHT", "OVERVOLUME", "OVERSIZED"].includes(issue.message));
      setError(capacity?.message === "OVERWEIGHT" ? t.overweight : capacity?.message === "OVERVOLUME" ? t.overvolume : capacity ? t.oversized : t.invalid);
      return null;
    }
    if (!validSchedule(result.data,Date.now(),parameters)) { setError(zh?`预约须提前 ${parameters.minScheduleMinutes} 分钟，且不超过 ${parameters.maxScheduleDays} 天。`:`Schedule ${parameters.minScheduleMinutes} minutes to ${parameters.maxScheduleDays} days ahead.`); return null; }
    return result.data;
  }
  async function calculate(event: FormEvent) {
    event.preventDefault(); const input = validate(); if (!input) return;
    setBusy("quote"); setError(""); setSaved(false);
    try { setEstimate(await requestQuote(quoteInput(input))); setClock(Date.now()); }
    catch (caught) { setError(bookingError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED",language,parameters)); }
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
    } catch (caught) { setError(bookingError(caught instanceof ApiError ? caught.code : "REQUEST_FAILED", language,parameters)); }
    finally { setBusy(null); }
  }

  function stopFields(stop: BookingStop, index: number) {
    const pickup = index === -1;
    const country = bookingCountry(stop.countryCode,countries);
    const fieldId = pickup ? "pickup" : `dropoff-${index}`;
    return <div className="stop-card" key={pickup ? "pickup" : index}>
      <div className="stop-card-heading"><strong><span className={pickup ? "stop-marker" : "stop-marker stop-marker--orange"}>{pickup ? "A" : index + 1}</span>{pickup ? t.pickup : `${t.dropoff} ${index + 1}`}</strong>
        {!pickup && booking.dropoffs.length > 1 && <div className="stop-controls"><button type="button" className="inline-button" disabled={index === 0} onClick={() => moveStop(index, -1)} aria-label={`${t.up} ${index + 1}`}>↑</button><button type="button" className="inline-button" disabled={index === booking.dropoffs.length - 1} onClick={() => moveStop(index, 1)} aria-label={`${t.down} ${index + 1}`}>↓</button><button type="button" className="inline-button danger" onClick={() => change({ ...booking, dropoffs: booking.dropoffs.filter((_, i) => i !== index) })}>{t.remove}</button></div>}
      </div>
      <div className="two-column-fields stop-location-fields">
        <div><label htmlFor={`${fieldId}-country`}>{t.country}</label><select id={`${fieldId}-country`} required value={stop.countryCode} onChange={(e) => updateStop(index, { ...stop, countryCode: e.target.value, city: "" })}>
          <option value="">{t.selectCountry}</option>{countries.filter(item=>item.enabled!==false || item.code===stop.countryCode).map(item => <option key={item.code} value={item.code} disabled={item.enabled===false}>{item[language]}{item.enabled===false?(zh?"（已停用）":" (disabled)"):""}</option>)}
        </select></div>
        <div><label htmlFor={`${fieldId}-city`}>{t.city}</label><select id={`${fieldId}-city`} required disabled={!country || country.enabled===false} value={stop.city} onChange={(e) => updateStop(index, { ...stop, city: e.target.value })}>
          <option value="">{country ? t.selectCity : t.countryFirst}</option>{country?.cities.filter(([value])=>!country.disabledCities?.includes(value)||value===stop.city).map(([value, nameZh, nameEn]) => <option key={value} value={value} disabled={country.disabledCities?.includes(value)}>{zh ? `${nameZh} / ${nameEn??value}` : nameEn??value}{country.disabledCities?.includes(value)?(zh?"（已停用）":" (disabled)"):""}</option>)}
        </select></div>
      </div>
      <details open={stop.address ? true : undefined}><summary>{t.addressDetails}</summary><label>{t.address}<input maxLength={240} autoComplete="off" placeholder={t.addressPlaceholder} value={stop.address} onChange={(e) => updateStop(index, { ...stop, address: e.target.value })} /></label></details>
      <details><summary>{t.contact} · {t.phone}</summary><div className="two-column-fields"><label>{t.contact}<input maxLength={80} value={stop.contactName} onChange={(e) => updateStop(index, { ...stop, contactName: e.target.value })} /></label><label>{t.phone}<input type="tel" maxLength={30} value={stop.phone} onChange={(e) => updateStop(index, { ...stop, phone: e.target.value })} /></label></div><label>{t.access}<input maxLength={400} value={stop.notes} onChange={(e) => updateStop(index, { ...stop, notes: e.target.value })} /></label></details>
    </div>;
  }
  const scheduledLocal = booking.scheduledAt ? new Date(Date.parse(booking.scheduledAt) - new Date(booking.scheduledAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const expired = estimate ? Date.parse(estimate.expiresAt) <= clock : false;
  return <section className="booking-page">
    <div className="container booking-heading"><span className="kicker">Moviloq / {reference || t.newDraft}</span><h1>{t.title}</h1><p>{t.subtitle}</p><Link className="text-cta" to="/drafts">{t.drafts}<ArrowIcon /></Link></div>
    {loadingDraft ? <div className="container" role="status">{t.loadingDraft}</div> : loadError ? <div className="container form-alert" role="alert">{loadError} <Link to="/drafts">{t.drafts}</Link></div> : <div className="container booking-layout">
      <form className="booking-form booking-form--details" onSubmit={calculate}>
        <fieldset className="booking-fields" disabled={busy !== null || !settingsReady || !catalogReady}>
          <section className="form-section"><div className="form-section__heading"><span>1</span><div><h2>{t.route}</h2><p>{zh ? `一个提货点，最多 ${parameters.maxDropoffs} 个送达点` : `One pickup. Up to ${parameters.maxDropoffs} drop-offs.`}</p></div></div>
            <p className="field-note location-note">{t.locationNote}</p>
            {[booking.pickup, ...booking.dropoffs].some(stop => stop.address && (!stop.countryCode || !stop.city)) && <p className="form-alert" role="status">{t.legacyLocation}</p>}
            {stopFields(booking.pickup, -1)}{booking.dropoffs.map((stop, index) => stopFields(stop, index))}
            <button className="button button--ghost button--small add-stop" type="button" disabled={booking.dropoffs.length >= parameters.maxDropoffs} onClick={() => change({ ...booking, dropoffs: [...booking.dropoffs, blankStop()] })}>+ {t.addStop}</button>
            <label>{t.distance}<input required type="number" min={1} max={parameters.maxDistanceKm} step="0.1" value={booking.distanceKm || ""} onChange={(e) => change({ ...booking, distanceKm: Number(e.target.value) })} /></label><p className="field-note">{zh?`测试里程范围 1–${parameters.maxDistanceKm} km；暂未连接地图，不代表实际路线或可承运范围。`:`Test distance: 1–${parameters.maxDistanceKm} km. No live mapping or service-area verification.`}</p>
          </section>
          <section className="form-section"><div className="form-section__heading"><span>2</span><div><h2>{t.cargo}</h2><p>{t.capacityNote}</p></div></div>
            <label>{t.description}<input required minLength={2} maxLength={160} value={booking.cargo.description} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, description: e.target.value } })} /></label>
            <div className="cargo-capacity-fields"><label>{t.quantity}<input required type="number" min={1} max={500} value={booking.cargo.quantity || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, quantity: Number(e.target.value) } })} /></label><label>{t.weight}<input required type="number" min={0.1} max={44000} step="0.1" value={booking.cargo.totalWeightKg || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, totalWeightKg: Number(e.target.value) } })} /></label><label>{t.volume}<input required type="number" min={0.01} max={500} step="0.01" value={booking.cargo.totalVolumeM3 || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, totalVolumeM3: Number(e.target.value) } })} /></label></div>
            <p className="field-note">{t.dimensions}</p><div className="dimension-fields">{([['lengthCm', t.length, 2000], ['widthCm', t.width, 400], ['heightCm', t.height, 500]] as const).map(([field, label, max]) => <label key={field}>{label}<input required type="number" min={1} max={max} value={booking.cargo[field] || ""} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, [field]: Number(e.target.value) } })} /></label>)}</div>
            <label className="simple-check"><input type="checkbox" checked={booking.cargo.fragile} onChange={(e) => change({ ...booking, cargo: { ...booking.cargo, fragile: e.target.checked } })} />{t.fragile}</label>
          </section>
          <section className="form-section"><div className="form-section__heading"><span>3</span><div><h2>{t.vehicle}</h2></div></div><div className="vehicle-options">
            {Object.values(catalog).sort((a,b)=>(a.sortOrder??100)-(b.sortOrder??100)).map((vehicle) => <label key={vehicle.id} className={`vehicle-option ${booking.vehicleId === vehicle.id ? "selected" : ""}`}><TruckIcon size={24} /><span><strong>{(zh?vehicle.nameZh:vehicle.nameEn)||vehicleNames[vehicle.id][zh ? 1 : 0]}</strong><small>{vehicle.capacityKg.toLocaleString()} kg{vehicle.effectiveVolumeM3 ? ` · ${vehicle.effectiveVolumeM3} m³` : ""} · {vehicle.cargoSizeCm.join(" × ")} cm</small>{(zh?vehicle.descriptionZh:vehicle.descriptionEn)&&<small>{zh?vehicle.descriptionZh:vehicle.descriptionEn}</small>}{vehicle.pricingStatus==="test-placeholder"&&<small className="test-price-label">{t.testPrice}</small>}</span><input type="radio" name="vehicle" value={vehicle.id} checked={booking.vehicleId === vehicle.id} onChange={() => change({ ...booking, vehicleId: vehicle.id })} /></label>)}
          </div>{referenceCatalog.length > 0 && <div className="vehicle-reference-section"><div className="vehicle-reference-heading"><h3>{t.heavyVehicleTitle}</h3><span>{t.manualQuote}</span></div><p>{t.heavyVehicleNote}</p><div className="vehicle-reference-grid">
            {referenceCatalog.map(vehicle => <article className="vehicle-reference-card" key={vehicle.id}><TruckIcon size={24} /><div><strong>{(zh?vehicle.nameZh:vehicle.nameEn)||vehicle.nameZh}</strong>{((zh?vehicle.notesZh:vehicle.notesEn)||vehicle.notesZh) && <small>{(zh?vehicle.notesZh:vehicle.notesEn)||vehicle.notesZh}</small>}</div><span>{t.manualQuote}</span></article>)}
          </div></div>}</section>
          <section className="form-section"><div className="form-section__heading"><span>4</span><div><h2>{t.when}</h2></div></div>
            <div className="schedule-options"><label className="simple-check"><input type="radio" name="serviceType" checked={booking.serviceType === "on-demand"} onChange={() => change({ ...booking, serviceType: "on-demand", scheduledAt: null })} />{t.immediate}</label><label className="simple-check"><input type="radio" name="serviceType" checked={booking.serviceType === "scheduled"} onChange={() => change({ ...booking, serviceType: "scheduled" })} />{t.scheduled}</label></div>
            {booking.serviceType === "scheduled" && <label>{t.schedule}<input type="datetime-local" required value={scheduledLocal} onChange={(e) => { const date = new Date(e.target.value); change({ ...booking, scheduledAt: Number.isFinite(date.getTime()) ? date.toISOString() : null }); }} /><p className="field-note">{zh?`提前 ${parameters.minScheduleMinutes} 分钟至 ${parameters.maxScheduleDays} 天；时间按当前浏览器时区显示：`:`Book ${parameters.minScheduleMinutes} minutes to ${parameters.maxScheduleDays} days ahead. Browser timezone:`} {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></label>}
            <div className="extras-list">{([['loadingHelp', t.loading], ['helper', t.helper], ['priority', t.priority]] as const).map(([key, label]) => <label className="simple-check" key={key}><input type="checkbox" checked={booking[key]} onChange={(e) => change({ ...booking, [key]: e.target.checked })} />{label}</label>)}</div>
            <label>{t.notes}<textarea rows={3} maxLength={600} value={booking.notes} onChange={(e) => change({ ...booking, notes: e.target.value })} /></label>
          </section>
          <button className="button quote-submit" type="submit">{busy === "quote" ? t.calculating : t.calculate}<ArrowIcon /></button>
        </fieldset>
        {!settingsReady && <p className="form-alert" role="status">{settingsFailed?(zh?"系统设置加载失败，请刷新后重试。":"Settings could not load. Please refresh."):(zh?"正在加载系统设置…":"Loading system settings…")}</p>}
        {error && <p className="form-alert" role="alert">{error}</p>}
        {saved && <p className="form-success" role="status">{t.saved}</p>}
      </form>
      <aside className="quote-panel" aria-live="polite"><div className="quote-panel__head"><strong>{t.current}</strong><span className="estimate-badge">{t.draftLabel}</span></div>
        {estimate ? <>{estimate.pricingStatus==="test-placeholder"&&<p className="form-alert test-price-alert" role="status"><strong>{t.testPrice}</strong><br />{t.testPriceNote}</p>}{estimate.pricingStatus==="confirmed-route"&&<p className="form-success" role="status"><strong>{t.confirmedRoute}</strong><br />{t.confirmedRouteNote}</p>}<div className="quote-total"><strong>{formatCurrency(estimate.total,estimate.currency,language)}</strong><span>{estimate.quoteMode==="fixed-route"?(zh?"USD 客户最终线路总价":"USD customer-final route total"):(zh?"含工程估算税额":"Includes estimated tax")}</span></div><p className="field-note">{zh ? "价格版本" : "Pricing version"}: {estimate.pricingVersion ?? "engineering-2026-09"}</p><div className="quote-route"><TruckIcon /><div><strong>{(zh?catalog[booking.vehicleId]?.nameZh:catalog[booking.vehicleId]?.nameEn)||vehicleNames[booking.vehicleId][zh ? 1 : 0]}</strong><span>{booking.distanceKm} km · {booking.dropoffs.length} {t.dropoff}</span></div></div>
          {estimate.quoteMode==="fixed-route"?<dl className="breakdown"><div className="breakdown-subtotal"><dt>{t.confirmedRoute}</dt><dd>{formatCurrency(estimate.total,estimate.currency,language)}</dd></div></dl>:<dl className="breakdown">{([['base', t.base], ['distance', t.mileage], ['stops', t.stops], ['services', t.services], ['priority', t.priorityFee]] as const).filter(([key]) => estimate.breakdown[key] > 0).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatCurrency(estimate.breakdown[key],estimate.currency,language)}</dd></div>)}<div className="breakdown-subtotal"><dt>{t.net}</dt><dd>{formatCurrency(estimate.net,estimate.currency,language)}</dd></div><div><dt>{zh ? "估算税额" : "Estimated tax"} ({Math.round(estimate.vatRate * 10000) / 100}%)</dt><dd>{formatCurrency(estimate.vat,estimate.currency,language)}</dd></div></dl>}
          {expired ? <p className="form-alert">{t.stale}</p> : <p className="field-note">{zh?`本次估价有效期 ${estimate.validForMinutes} 分钟，保存时会重新计算；并非正式订单。`:`This estimate is valid for ${estimate.validForMinutes} minutes and recalculated on saving. Not a confirmed order.`}</p>}
          <label className="simple-check consent-check"><input type="checkbox" checked={consent} disabled={busy !== null} onChange={(e) => setConsent(e.target.checked)} /><span>{t.consent} <Link to="/legal/drafts" target="_blank" rel="noreferrer">{t.privacy}</Link></span></label>
          <button type="button" className="button button--full" disabled={busy !== null || expired || !consent} onClick={() => void save()}>{busy === "save" ? t.saving : t.save}</button>
        </> : <div className="quote-empty"><div className="quote-empty__icon"><TruckIcon size={34} /></div><h3>{t.empty}</h3><p>{t.emptyText}</p></div>}
        <p className="quote-disclaimer">{estimate?.quoteMode==="fixed-route"?t.confirmedRouteNote:t.note}</p>
      </aside>
    </div>}
  </section>;
}
