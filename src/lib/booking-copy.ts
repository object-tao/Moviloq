import type { Language } from "./i18n";

const en = {
  title: "Plan the move. Keep the details.", subtitle: "Build your route, check the vehicle and save a delivery draft for later.",
  drafts: "My drafts", newDraft: "Plan a delivery", route: "Your route", pickup: "Pickup", dropoff: "Drop-off",
  address: "Address", contact: "Contact name (optional)", phone: "Phone (optional)", access: "Access notes (optional)",
  addStop: "Add a drop-off", remove: "Remove", up: "Move up", down: "Move down", distance: "Estimated total route distance (km)",
  mapNote: "Enter the road distance for all stops. This estimate does not verify addresses or service coverage yet.",
  cargo: "What are you moving?", description: "Goods description", quantity: "Number of pieces", weight: "Total weight (kg)",
  dimensions: "Largest item dimensions, upright (cm)", length: "Length", width: "Width", height: "Height", fragile: "Fragile goods",
  capacityNote: "The weight and largest item must fit the vehicle. Combined loading space still needs carrier confirmation.",
  vehicle: "Choose a vehicle", when: "When & extras", immediate: "As soon as available", scheduled: "Choose a date", schedule: "Pickup date and time",
  scheduleNote: "Choose 15 minutes to 30 days ahead. Time zone:", loading: "Driver loading help", helper: "Additional helper", priority: "Priority matching",
  notes: "Other instructions (optional)", calculate: "Calculate estimate", calculating: "Calculating…", save: "Save draft", saving: "Saving…",
  current: "Your estimate", empty: "Your estimate will appear here", emptyText: "Complete the route and goods details to calculate.",
  net: "Net subtotal", vat: "VAT (19%)", base: "Base fare", mileage: "Distance", stops: "Extra stops", services: "Services", priorityFee: "Priority fee",
  note: "Development prices for testing only, not an offer. Saving does not book transport or request a driver. Please use sample details until launch.",
  consent: "Save these details until this browser’s workspace expires (30 days after its first save).", privacy: "How drafts are stored", saved: "Draft saved. You can return to it from My drafts.",
  updated: "Last updated", expires: "Available until", edit: "Open draft", delete: "Delete", cancel: "Keep draft", confirmDelete: "Delete this draft?",
  noDrafts: "Your next move starts here.", noDraftsText: "Saved delivery drafts appear here so you can pick up where you left off.",
  workspaceNote: "Drafts belong to this browser and website address. They are not synced across devices. Clearing site cookies removes access. The workspace expires 30 days after its first save.",
  stale: "This estimate has expired. Recalculate before saving.", draftLabel: "Draft", loadingDraft: "Loading draft…", retry: "Try again",
  invalid: "Check the addresses, goods details and vehicle capacity. Required fields must be completed.",
  overweight: "The total weight exceeds this vehicle’s capacity. Choose a larger vehicle or adjust the cargo.",
  oversized: "The largest item does not fit this vehicle. Check its dimensions or choose a larger vehicle.",
  invalidSchedule: "Choose a pickup time between 15 minutes and 30 days from now.",
  failed: "We could not complete that request. Please try again.", conflict: "This draft changed in another tab. Reload it before saving again.",
  missing: "This draft is unavailable or belongs to another browser session.", limit: "This workspace holds up to 30 drafts. Delete one before saving a new draft.",
  rateLimited: "Too many requests. Please wait a minute and try again.", serverOffline: "Draft storage is temporarily unavailable. You can still calculate an estimate.",
  consentRequired: "Confirm draft storage before saving.", savedQuote: "Estimate valid for 10 minutes. Recalculate if you change your plans."
};
const zh: typeof en = {
  title: "把这趟运输，安排清楚。", subtitle: "填写路线与货物、核对车型，保存草稿后随时回来继续。",
  drafts: "我的草稿", newDraft: "规划运输", route: "运输路线", pickup: "提货点", dropoff: "送达点",
  address: "详细地址", contact: "联系人（选填）", phone: "电话（选填）", access: "门禁、楼层与停车说明（选填）",
  addStop: "增加送达点", remove: "移除", up: "上移", down: "下移", distance: "全部站点预计道路总里程（公里）",
  mapNote: "请填写途经全部站点的道路里程。目前估价尚未自动核验地址和服务范围。",
  cargo: "这次运送什么？", description: "货物名称", quantity: "货物件数", weight: "货物总重量（公斤）",
  dimensions: "最大单件尺寸，保持直立（厘米）", length: "长", width: "宽", height: "高", fragile: "包含易碎物品",
  capacityNote: "总重量与最大单件须符合车型限制；全部货物的实际装载空间仍需承运方确认。",
  vehicle: "选择合适的车型", when: "时间与附加服务", immediate: "尽快安排", scheduled: "指定日期", schedule: "预计提货日期与时间",
  scheduleNote: "可选择 15 分钟后至未来 30 天内。当前设备时区：", loading: "司机协助装卸", helper: "额外搬运人员", priority: "优先匹配",
  notes: "其他运输说明（选填）", calculate: "计算估价", calculating: "计算中…", save: "保存草稿", saving: "保存中…",
  current: "本次估价", empty: "准备好就可以估价", emptyText: "填写路线和货物资料后，这里会显示费用明细。",
  net: "未税金额", vat: "增值税（19%）", base: "起步费用", mileage: "里程费用", stops: "额外站点", services: "附加服务", priorityFee: "优先费用",
  note: "当前价格仅供开发测试，并非正式报价。保存不会形成运输订单，也不会呼叫司机。上线前请使用示例资料。",
  consent: "保存资料至本浏览器的草稿空间到期（首次保存起 30 天）。", privacy: "草稿如何保存", saved: "草稿已保存，可从“我的草稿”中重新打开。",
  updated: "上次修改", expires: "可访问至", edit: "打开草稿", delete: "删除", cancel: "保留草稿", confirmDelete: "确认删除这份草稿？",
  noDrafts: "下一趟运输，从这里开始。", noDraftsText: "保存后的运输草稿会显示在这里，方便之后继续完善。",
  workspaceNote: "草稿仅属于当前浏览器和当前网站地址，暂不跨设备同步。清除网站 Cookie 后将无法找回。草稿空间在首次保存 30 天后到期。",
  stale: "这份估价已过期，请重新计算后保存。", draftLabel: "草稿", loadingDraft: "正在读取草稿…", retry: "重试",
  invalid: "请检查地址、货物资料和车型容量，补全必填信息。",
  overweight: "货物总重量超过所选车型载重，请选择更大的车型或调整货物。",
  oversized: "最大单件尺寸超出车型空间，请核对尺寸或选择更大的车型。",
  invalidSchedule: "请选择从现在起 15 分钟后至未来 30 天内的提货时间。",
  failed: "本次操作未能完成，请稍后重试。", conflict: "这份草稿已在其他标签页修改，请重新打开后再保存。",
  missing: "找不到这份草稿，可能已到期、已删除或属于另一浏览器。", limit: "当前最多保存 30 份草稿，请先删除不需要的草稿。",
  rateLimited: "操作较频繁，请一分钟后重试。", serverOffline: "草稿保存暂时不可用，你仍可计算估价。",
  consentRequired: "请先确认草稿保存说明。", savedQuote: "估价有效期 10 分钟。如计划有变化，请重新计算。"
};

export const bookingCopy = (language: Language) => language === "zh" ? zh : en;
export function bookingError(code: string, language: Language) {
  const t = bookingCopy(language);
  const messages: Record<string, string> = { VERSION_CONFLICT: t.conflict, IDEMPOTENCY_CONFLICT: t.conflict, DRAFT_NOT_FOUND: t.missing, DRAFT_LIMIT_REACHED: t.limit, RATE_LIMITED: t.rateLimited, STORAGE_UNAVAILABLE: t.serverOffline, INVALID_BOOKING: t.invalid, INVALID_SCHEDULE: t.invalidSchedule };
  return messages[code] ?? t.failed;
}
