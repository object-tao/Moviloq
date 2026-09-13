import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowIcon, CheckIcon, PinIcon, ShieldIcon, TruckIcon } from "../components/Icons";
import { useLanguage } from "../lib/i18n";

type InfoKind = "personal" | "business" | "partners" | "help";

const infoContent = {
  personal: {
    eyebrow: ["Personal delivery", "个人运输"],
    title: ["One clear place to move the things that matter.", "搬运重要物品，全程清楚可控。"],
    body: ["From a single box to furniture and equipment, choose a vehicle, see the estimate and follow every step.", "从一个纸箱到家具设备，选择车型、查看估价并追踪每一步。"],
    bullets: [["Immediate or scheduled delivery", "即时或预约运输"], ["Up to 20 drop-off points", "最多 20 个配送站点"], ["Live progress and digital proof", "实时进度与数字签收"]]
  },
  business: {
    eyebrow: ["For business", "企业服务"],
    title: ["Flexible capacity without running another fleet.", "灵活调用运力，无需自建另一支车队。"],
    body: ["Give teams a shared view of bookings, costs and delivery records — with the controls operations need.", "让团队统一查看订单、成本和交付记录，同时保留运营所需的控制。"],
    bullets: [["Team accounts and permissions", "团队账户与权限"], ["Receipts and cost records", "收据与成本记录"], ["Repeat routes and multiple stops", "常用线路与多点配送"]]
  },
  partners: {
    eyebrow: ["Delivery partners", "承运合作伙伴"],
    title: ["Choose the jobs that fit your day and vehicle.", "选择适合你时间和车辆的订单。"],
    body: ["Join the Frankfurt pilot as an independent delivery partner or a verified fleet.", "以独立承运人或认证车队身份加入法兰克福试运营。"],
    bullets: [["Clear job and earnings details", "清楚的订单与收入信息"], ["Your choice to accept or decline", "自主接受或拒绝订单"], ["Driver, vehicle and document verification", "司机、车辆与证件审核"]]
  },
  help: {
    eyebrow: ["Help centre", "帮助中心"],
    title: ["Answers before you need to ask.", "先找到答案，再决定是否联系我们。"],
    body: ["The Frankfurt pilot support library is being prepared in English, Chinese and later German.", "法兰克福试运营帮助资料正在准备中，首发支持英文和中文，后续增加德语。"],
    bullets: [["Booking and pricing", "下单与计价"], ["Partner onboarding", "承运方入驻"], ["Safety and claims", "安全与索赔"]]
  }
} as const;

export function InfoPage({ kind }: { kind: InfoKind }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const index = zh ? 1 : 0;
  const content = infoContent[kind];

  return (
    <section className="simple-page">
      <div className="container simple-hero">
        <div>
          <span className="kicker">{content.eyebrow[index]}</span>
          <h1>{content.title[index]}</h1>
          <p>{content.body[index]}</p>
          <div className="simple-actions">
            <Link to={kind === "partners" ? "/login" : "/book"} className="button">{kind === "partners" ? (zh ? "开始申请" : "Start an application") : (zh ? "获取估价" : "Get an estimate")}<ArrowIcon /></Link>
            <a href="mailto:hello@moviloq.com" className="button button--ghost">{zh ? "联系我们" : "Contact us"}</a>
          </div>
        </div>
        <div className="simple-card">
          <div className="simple-card__icon">{kind === "partners" ? <TruckIcon size={42} /> : <ShieldIcon size={42} />}</div>
          {content.bullets.map((bullet) => <div className="simple-bullet" key={bullet[index]}><CheckIcon /><span>{bullet[index]}</span></div>)}
          <small>{zh ? "法兰克福 · 试运营" : "Frankfurt · pilot release"}</small>
        </div>
      </div>
    </section>
  );
}

export function TrackPage() {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [searched, setSearched] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSearched(true);
  }

  return (
    <section className="simple-page simple-page--compact">
      <div className="container narrow-page">
        <span className="kicker">{zh ? "订单追踪" : "Track a delivery"}</span>
        <h1>{zh ? "看看货物到哪里了。" : "See where things stand."}</h1>
        <p>{zh ? "输入订单编号和收货人验证码。" : "Enter the order number and recipient access code."}</p>
        <form className="track-form" onSubmit={submit}>
          <label><span>{zh ? "订单编号" : "Order number"}</span><input required placeholder="MVQ-2026-000001" /></label>
          <label><span>{zh ? "访问验证码" : "Access code"}</span><input required placeholder="••••••" maxLength={8} /></label>
          <button className="button" type="submit">{zh ? "查询订单" : "Track order"}<ArrowIcon /></button>
        </form>
        {searched && <div className="notice-card"><PinIcon /><div><strong>{zh ? "尚未找到公开订单" : "No public order found yet"}</strong><span>{zh ? "订单数据库将在下一开发阶段启用。" : "Order persistence is scheduled for the next development phase."}</span></div></div>}
      </div>
    </section>
  );
}

export function LoginPage() {
  const { language } = useLanguage();
  const zh = language === "zh";
  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="kicker">{zh ? "账户" : "Your account"}</span>
        <h1>{zh ? "欢迎来到 Moviloq" : "Welcome to Moviloq"}</h1>
        <p>{zh ? "账户认证将在下一开发阶段接入。" : "Secure account authentication is being connected in the next phase."}</p>
        <label><span>{zh ? "电子邮箱" : "Email address"}</span><input type="email" placeholder="you@example.com" disabled /></label>
        <button className="button button--full" disabled>{zh ? "即将开放" : "Coming next"}</button>
        <div className="auth-note"><ShieldIcon size={18} />{zh ? "管理员账户将强制使用多因素认证" : "Admin accounts will require multi-factor authentication"}</div>
      </div>
    </section>
  );
}

export function LegalPage() {
  const { document = "terms" } = useParams();
  const titles: Record<string, string> = { privacy: "Privacy policy", terms: "Terms of service", imprint: "Imprint" };
  return (
    <section className="legal-page">
      <div className="container legal-copy">
        <span className="kicker">Legal</span>
        <h1>{titles[document] ?? "Legal information"}</h1>
        <div className="legal-notice">
          <ShieldIcon />
          <div><strong>Draft pending legal entity registration</strong><p>This document will be completed and reviewed by German transport and privacy counsel before public transactions are enabled.</p></div>
        </div>
        <h2>Development-stage notice</h2>
        <p>Moviloq is currently a product under development for a Frankfurt pilot. No booking made through this preview forms a transport contract and no payment is collected.</p>
        <h2>Contact</h2>
        <p>Product enquiries: <a href="mailto:hello@moviloq.com">hello@moviloq.com</a></p>
      </div>
    </section>
  );
}
