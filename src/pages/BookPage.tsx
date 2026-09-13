import { useMemo, useState, type FormEvent } from "react";
import { ArrowIcon, CheckIcon, PinIcon, TruckIcon } from "../components/Icons";
import { requestQuote } from "../lib/api";
import { formatEuro } from "../lib/format";
import { useLanguage } from "../lib/i18n";
import type { QuoteEstimate, VehicleId } from "../../shared/pricing";

const vehicleOptions: Array<{ id: VehicleId; name: string; capacity: string }> = [
  { id: "bike", name: "Bike", capacity: "5 kg" },
  { id: "cargo-bike", name: "Cargo bike", capacity: "40 kg" },
  { id: "car", name: "Car", capacity: "100 kg" },
  { id: "caddy", name: "Caddy", capacity: "500 kg" },
  { id: "transporter", name: "Transporter", capacity: "1,000 kg" },
  { id: "xl-transporter", name: "XL Transporter", capacity: "1,200 kg" }
];

export function BookPage() {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [vehicleId, setVehicleId] = useState<VehicleId>("transporter");
  const [distanceKm, setDistanceKm] = useState(18);
  const [extraStops, setExtraStops] = useState(0);
  const [loadingHelp, setLoadingHelp] = useState(false);
  const [helper, setHelper] = useState(false);
  const [priority, setPriority] = useState(false);
  const [quote, setQuote] = useState<QuoteEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedVehicle = useMemo(
    () => vehicleOptions.find((vehicle) => vehicle.id === vehicleId)!,
    [vehicleId]
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const estimate = await requestQuote({
        vehicleId,
        distanceKm,
        extraStops,
        loadingHelp,
        helper,
        waitMinutes: 0,
        priority
      });
      setQuote(estimate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to calculate an estimate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="booking-page">
      <div className="container booking-heading">
        <span className="kicker">{zh ? "法兰克福试运营" : "Frankfurt pilot"}</span>
        <h1>{zh ? "先看看这趟要多少钱。" : "Let’s estimate your move."}</h1>
        <p>{zh ? "填写路线和车型，即可获得透明的试算价格。" : "Add the route and vehicle to get a clear, itemised estimate."}</p>
      </div>
      <div className="container booking-layout">
        <form className="booking-form" onSubmit={submit}>
          <section className="form-section">
            <div className="form-section__heading"><span>1</span><div><h2>{zh ? "路线" : "Route"}</h2><p>{zh ? "首版服务法兰克福周边约 75 公里" : "Pilot area: roughly 75 km around Frankfurt"}</p></div></div>
            <div className="route-fields">
              <label>
                <span>{zh ? "提货地址" : "Pickup address"}</span>
                <div className="input-with-icon"><PinIcon size={18} /><input required placeholder={zh ? "例如：法兰克福机场" : "e.g. Frankfurt Airport"} /></div>
              </label>
              <label>
                <span>{zh ? "送达地址" : "Drop-off address"}</span>
                <div className="input-with-icon input-with-icon--orange"><PinIcon size={18} /><input required placeholder={zh ? "例如：法兰克福市中心" : "e.g. Frankfurt city centre"} /></div>
              </label>
            </div>
            <div className="two-column-fields">
              <label>
                <span>{zh ? "预计路线距离" : "Estimated route distance"}</span>
                <div className="suffix-input"><input type="number" min="1" max="500" value={distanceKm} onChange={(event) => setDistanceKm(Number(event.target.value))} /><span>km</span></div>
              </label>
              <label>
                <span>{zh ? "额外配送站点" : "Extra drop-off stops"}</span>
                <input type="number" min="0" max="19" value={extraStops} onChange={(event) => setExtraStops(Number(event.target.value))} />
              </label>
            </div>
            <p className="field-note">{zh ? "地图自动计算与地址校验将在接入地图服务后启用。" : "Automatic map distance and address validation will activate with the mapping provider."}</p>
          </section>

          <section className="form-section">
            <div className="form-section__heading"><span>2</span><div><h2>{zh ? "选择车型" : "Choose a vehicle"}</h2><p>{zh ? "根据货物重量和尺寸选择" : "Match the weight and dimensions of your goods"}</p></div></div>
            <div className="vehicle-options">
              {vehicleOptions.map((vehicle) => (
                <button type="button" key={vehicle.id} className={vehicleId === vehicle.id ? "vehicle-option selected" : "vehicle-option"} onClick={() => setVehicleId(vehicle.id)}>
                  <TruckIcon size={24} />
                  <span><strong>{vehicle.name}</strong><small>{zh ? `最多 ${vehicle.capacity}` : `up to ${vehicle.capacity}`}</small></span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section__heading"><span>3</span><div><h2>{zh ? "附加服务" : "Add-on services"}</h2><p>{zh ? "只为需要的服务付费" : "Only pay for what the job needs"}</p></div></div>
            <div className="check-grid">
              <label className="check-card"><input type="checkbox" checked={loadingHelp} onChange={(event) => setLoadingHelp(event.target.checked)} /><span className="custom-check"><CheckIcon size={15} /></span><span><strong>{zh ? "司机协助装卸" : "Driver loading help"}</strong><small>+ €25.21 net</small></span></label>
              <label className="check-card"><input type="checkbox" checked={helper} onChange={(event) => setHelper(event.target.checked)} /><span className="custom-check"><CheckIcon size={15} /></span><span><strong>{zh ? "额外搬运人员" : "Additional helper"}</strong><small>+ €25.21 net</small></span></label>
              <label className="check-card"><input type="checkbox" checked={priority} onChange={(event) => setPriority(event.target.checked)} /><span className="custom-check"><CheckIcon size={15} /></span><span><strong>{zh ? "优先匹配" : "Priority matching"}</strong><small>+ 12%</small></span></label>
            </div>
          </section>

          <button className="button quote-submit" disabled={loading} type="submit">
            {loading ? (zh ? "计算中…" : "Calculating…") : (zh ? "计算估价" : "Calculate estimate")}<ArrowIcon />
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <aside className="quote-panel">
          <div className="quote-panel__head">
            <span>{zh ? "当前估价" : "Your estimate"}</span>
            <span className="estimate-badge">{zh ? "试算" : "BETA"}</span>
          </div>
          {quote ? (
            <>
              <div className="quote-total"><strong>{formatEuro(quote.total, language)}</strong><span>{zh ? "含 19% 增值税" : "including 19% VAT"}</span></div>
              <div className="quote-route"><PinIcon size={18} /><div><strong>{selectedVehicle.name}</strong><span>{distanceKm} km · {extraStops + 1} {zh ? "个配送点" : "drop-off point(s)"}</span></div></div>
              <dl className="breakdown">
                <div><dt>{zh ? "起步费用" : "Base fare"}</dt><dd>{formatEuro(quote.breakdown.base, language)}</dd></div>
                <div><dt>{zh ? "里程费用" : "Distance"}</dt><dd>{formatEuro(quote.breakdown.distance, language)}</dd></div>
                {quote.breakdown.stops > 0 && <div><dt>{zh ? "额外站点" : "Extra stops"}</dt><dd>{formatEuro(quote.breakdown.stops, language)}</dd></div>}
                {quote.breakdown.services > 0 && <div><dt>{zh ? "附加服务" : "Services"}</dt><dd>{formatEuro(quote.breakdown.services, language)}</dd></div>}
                {quote.breakdown.priority > 0 && <div><dt>{zh ? "优先费用" : "Priority"}</dt><dd>{formatEuro(quote.breakdown.priority, language)}</dd></div>}
                <div className="breakdown-subtotal"><dt>{zh ? "未税金额" : "Net"}</dt><dd>{formatEuro(quote.net, language)}</dd></div>
                <div><dt>VAT 19%</dt><dd>{formatEuro(quote.vat, language)}</dd></div>
              </dl>
              <div className="quote-valid"><CheckIcon />{zh ? `估价在 ${quote.validForMinutes} 分钟内有效` : `Estimate valid for ${quote.validForMinutes} minutes`}</div>
              <button className="button button--full" type="button" disabled>{zh ? "账户系统将在下一阶段开放" : "Account booking opens next"}</button>
            </>
          ) : (
            <div className="quote-empty">
              <div className="quote-empty__icon"><TruckIcon size={34} /></div>
              <h3>{zh ? "准备好获取估价" : "Ready when your route is"}</h3>
              <p>{zh ? "填写左侧信息，价格明细会显示在这里。" : "Complete the details and your itemised estimate will appear here."}</p>
            </div>
          )}
          <p className="quote-disclaimer">{zh ? "当前为开发阶段试算价格，不构成正式运输报价。" : "Development-stage estimate only. This is not yet a binding transport offer."}</p>
        </aside>
      </div>
    </section>
  );
}
