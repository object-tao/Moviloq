import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowIcon, CheckIcon, PinIcon, ShieldIcon, TruckIcon } from "../components/Icons";
import { useLanguage } from "../lib/i18n";
import { getPublishedContent, type PublishedContent } from "../lib/api";

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
  const [articles, setArticles] = useState<PublishedContent[]>([]);
  useEffect(() => { let active = true; if(kind === "help") getPublishedContent().then(result => { if(active) setArticles(result.items); }).catch(() => {}); return () => { active = false; }; }, [kind]);

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
      {kind === "help" && articles.length > 0 && <div className="container published-help">{articles.map(article => <article key={article.id} className="simple-card"><h2>{zh ? article.titleZh : article.titleEn}</h2><p className="published-content-body">{zh ? article.bodyZh : article.bodyEn}</p></article>)}</div>}
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
        <div className="auth-note"><ShieldIcon size={18} />{zh ? "平台员工使用独立的账号密码后台登录" : "Platform staff use the separate password-protected admin portal"}</div>
      </div>
    </section>
  );
}

export function LegalPage() {
  const { document = "terms" } = useParams();
  const { language } = useLanguage();
  if (document === "drafts") {
    const zh = language === "zh";
    return <section className="legal-page"><div className="container legal-copy">
      <span className="kicker">Moviloq / {zh ? "开发测试" : "Development preview"}</span>
      <h1>{zh ? "草稿如何保存" : "How drafts are stored"}</h1>
      <div className="legal-notice"><ShieldIcon /><div><strong>{zh ? "目前请使用示例资料" : "Please use sample details for now"}</strong><p>{zh ? "公司尚待注册，正式隐私政策和运输条款仍需专业审核。本页只说明已实现的草稿存储行为，不是完整的隐私政策。" : "Entity registration and professional review of privacy and transport terms are pending. This page explains implemented storage behaviour; it is not a complete privacy policy."}</p></div></div>
      <h2>{zh ? "保存哪些资料" : "What is saved"}</h2>
      <p>{zh ? "仅在你点击保存后，路线、选填的联系人和电话、货物资料、时间、车型、备注及服务器计算的估价会保存在 Cloudflare D1 中。请勿填写敏感个人信息。" : "Only after you choose Save, your route, optional contact names and phone numbers, cargo details, schedule, vehicle, notes and server-calculated estimate are stored in Cloudflare D1. Do not include sensitive personal information."}</p>
      <h2>{zh ? "浏览器访问凭据" : "Browser access credential"}</h2>
      <p>{zh ? "首次保存会设置仅用于访问草稿的 Cookie（HttpOnly、HTTPS 下 Secure、SameSite=Strict）。数据库仅存其哈希值。它不是注册账户：当前浏览器的使用者都可能访问草稿。不同设备、无痕窗口，以及 moviloq.com 与 www.moviloq.com 之间不共享草稿；清除 Cookie 将失去访问权限。" : "The first save sets an access cookie (HttpOnly, Secure over HTTPS, SameSite=Strict). Only its hash is stored in the database. This is not an account: others using the same browser may access drafts. Devices, private windows, and moviloq.com versus www.moviloq.com do not share drafts. Clearing cookies removes access."}</p>
      <h2>{zh ? "到期与删除" : "Expiry and deletion"}</h2>
      <p>{zh ? "每个草稿空间最多 30 份草稿，在首次保存起 30 天后统一到期，后续修改不会延长。到期即无法通过 API 访问，每日清理任务删除主数据库中的到期记录。也可随时在“我的草稿”中删除单份。服务商备份可能在其恢复保留期内仍包含已删除记录。" : "A workspace holds up to 30 drafts and expires 30 days after its first save; edits do not extend this. API access ends at expiry, and a daily cleanup removes expired records from the live database. You can delete individual drafts from My drafts at any time. Provider backups may retain deleted records during their recovery retention period."}</p>
      <h2>{zh ? "存储位置与服务范围" : "Storage location and service scope"}</h2>
      <p>{zh ? "D1 数据库使用欧盟辖区设置。这不代表全部网络处理均发生在欧盟，也不代表已完成隐私合规审核。草稿不会向司机发布、形成运输合同或收取费用。" : "D1 uses the EU jurisdiction setting. This does not mean all network processing occurs in the EU or that a privacy compliance review is complete. Drafts are not sent to drivers, do not create transport contracts and do not collect payment."}</p>
      <Link className="button button--ghost" to="/drafts">{zh ? "返回我的草稿" : "Back to My drafts"}</Link>
    </div></section>;
  }
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
