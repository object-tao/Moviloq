import { Link } from "react-router-dom";
import { ArrowIcon, CheckIcon, ClockIcon, RouteIcon, ShieldIcon, TruckIcon } from "../components/Icons";
import { useLanguage } from "../lib/i18n";

export function HomePage() {
  const { language, t } = useLanguage();
  const zh = language === "zh";

  const features = [
    {
      icon: <ClockIcon />,
      title: zh ? "现在出发，也可提前预约" : "Now or planned ahead",
      body: zh ? "立即叫车，或提前最多 30 天安排运输。" : "Book on demand or schedule a delivery up to 30 days ahead."
    },
    {
      icon: <ShieldIcon />,
      title: zh ? "经过认证的承运方" : "Verified delivery partners",
      body: zh ? "身份、经营资质、车辆和保险均需审核。" : "Identity, trade, vehicle and insurance checks before the first job."
    },
    {
      icon: <RouteIcon />,
      title: zh ? "从取货到签收都可追踪" : "Visible from pickup to proof",
      body: zh ? "实时状态、位置更新和数字签收凭证。" : "Live status, location updates and digital proof of delivery."
    }
  ];

  const steps = zh
    ? ["输入起点、终点和货物信息", "选择合适车型并查看透明估价", "匹配认证承运方并实时追踪"]
    : ["Add your route and shipment details", "Choose a vehicle and see a clear estimate", "Match with a verified partner and follow progress"];

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" />{t.hero.eyebrow}</div>
            <h1>{t.hero.titleA}<br /><span>{t.hero.titleB}</span></h1>
            <p>{t.hero.body}</p>
            <div className="hero-actions">
              <Link to="/book" className="button">{t.hero.primary}<ArrowIcon /></Link>
              <Link to="/partners" className="button button--ghost">{t.hero.secondary}</Link>
            </div>
            <div className="trust-row">
              <span><CheckIcon />{zh ? "透明计价" : "Transparent estimates"}</span>
              <span><CheckIcon />{zh ? "自主接单" : "Partner choice"}</span>
              <span><CheckIcon />{zh ? "数字签收" : "Digital proof"}</span>
            </div>
          </div>
          <div className="hero-visual" aria-label="Illustrated Frankfurt delivery route">
            <div className="map-grid" />
            <div className="route-line route-line--one" />
            <div className="route-line route-line--two" />
            <span className="map-label map-label--airport">FRA Airport</span>
            <span className="map-label map-label--city">Innenstadt</span>
            <div className="pin pin--pickup"><span>A</span></div>
            <div className="pin pin--dropoff"><span>B</span></div>
            <div className="moving-truck"><TruckIcon size={30} /></div>
            <div className="delivery-card">
              <div className="delivery-card__top">
                <span className="status-dot" />
                <span>{zh ? "承运方正在前往取货" : "Partner heading to pickup"}</span>
              </div>
              <strong>12 min</strong>
              <small>{zh ? "预计到达" : "estimated arrival"}</small>
            </div>
            <div className="coverage-ring"><span>75 km</span></div>
          </div>
        </div>
      </section>

      <section className="proof-strip">
        <div className="container proof-grid">
          <div><strong>24/7</strong><span>{zh ? "随时提交订单" : "booking access"}</span></div>
          <div><strong>30</strong><span>{zh ? "天提前预约" : "days ahead"}</span></div>
          <div><strong>20</strong><span>{zh ? "个配送站点" : "delivery stops"}</span></div>
          <div><strong>75 km</strong><span>{zh ? "试运营服务半径" : "pilot radius"}</span></div>
        </div>
      </section>

      <section className="section section--cream">
        <div className="container">
          <div className="section-heading split-heading">
            <div>
              <span className="kicker">{zh ? "清楚、灵活、可追踪" : "Clear. Flexible. Trackable."}</span>
              <h2>{zh ? "货物在移动，信息不掉线。" : "Goods move. Information keeps up."}</h2>
            </div>
            <p>{zh ? "Moviloq 让客户、司机和收货人在同一个订单事实中协作。" : "Moviloq keeps customers, drivers and recipients aligned around one clear order record."}</p>
          </div>
          <div className="feature-grid">
            {features.map((feature, index) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-number">0{index + 1}</span>
                <div className="feature-icon">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section how-section">
        <div className="container how-grid">
          <div className="how-copy">
            <span className="kicker">{zh ? "三步完成" : "Three simple steps"}</span>
            <h2>{zh ? "从计划到送达，少一点猜测。" : "From plan to delivered, with less guesswork."}</h2>
            <p>{zh ? "价格、承运方与进度都在确认前清楚呈现。" : "See the price, partner and progress clearly before you commit."}</p>
            <Link to="/book" className="text-cta">{zh ? "开始估价" : "Start an estimate"}<ArrowIcon /></Link>
          </div>
          <ol className="step-list">
            {steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <div><strong>{step}</strong><small>{index === 0 ? (zh ? "地址可保存复用" : "Save routes for next time") : index === 1 ? (zh ? "费用逐项列明" : "Every fee explained") : (zh ? "状态实时更新" : "Live order updates")}</small></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section vehicle-section">
        <div className="container">
          <div className="section-heading">
            <span className="kicker">{zh ? "合适的车，刚好的空间" : "The right space for the job"}</span>
            <h2>{zh ? "从一束鲜花到整屋家具。" : "From flowers to a room full of furniture."}</h2>
          </div>
          <div className="vehicle-row">
            {[
              ["Bike", "5 kg", "Small & quick"],
              ["Cargo bike", "40 kg", "City-friendly"],
              ["Car", "100 kg", "Boxes & fragile goods"],
              ["Caddy", "500 kg", "Equipment & furniture"],
              ["Transporter", "1,000 kg", "Pallets & larger moves"]
            ].map(([name, capacity, use], index) => (
              <article className={`vehicle-card ${index === 4 ? "vehicle-card--featured" : ""}`} key={name}>
                <div className="vehicle-illustration"><TruckIcon size={28 + index * 3} /></div>
                <h3>{name}</h3>
                <strong>{capacity}</strong>
                <span>{use}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="partner-banner">
        <div className="container partner-banner__inner">
          <div>
            <span className="kicker kicker--light">{zh ? "承运合作伙伴" : "Delivery partners"}</span>
            <h2>{zh ? "你的时间，你的车辆，你来决定接哪些单。" : "Your time, your vehicle, your choice of jobs."}</h2>
          </div>
          <Link to="/partners" className="button button--light">{zh ? "查看入驻要求" : "See partner requirements"}<ArrowIcon /></Link>
        </div>
      </section>
    </>
  );
}
