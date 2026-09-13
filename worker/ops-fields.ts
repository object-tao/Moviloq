import { documentTypes, type ConfigKind, type ResourceKind } from "../shared/operations";
import { vehicleIds } from "../shared/pricing";

export type Label = readonly [string, string];
export type Field = { key: string; label: Label; type?: "text" | "number" | "email" | "checkbox" | "textarea" | "select" | "list"; options?: readonly string[]; required?: boolean; max?: number; min?: number; step?: string };
const f = (key: string, zh: string, en: string, extra: Partial<Field> = {}): Field => ({ key, label: [zh, en], ...extra });
const contacts = [f("contact", "联系人", "Contact"), f("email", "联系邮箱", "Contact email", { type: "email" }), f("phone", "联系电话", "Phone"), f("area", "服务区域说明", "Service area notes"), f("source", "资料来源与授权依据", "Source and authorization basis", { required: true }), f("authorized", "已获授权录入这些资料", "Authorized to record this information", { type: "checkbox" }), f("notes", "内部备注（不要填写密码）", "Internal notes (no passwords)", { type: "textarea" })];
const dimensions = [f("capacityKg", "载重上限（kg）", "Payload limit (kg)", { type: "number", required: true, min: 0.1 }), f("lengthCm", "货厢长度（cm）", "Cargo length (cm)", { type: "number", required: true, min: 1 }), f("widthCm", "货厢宽度（cm）", "Cargo width (cm)", { type: "number", required: true, min: 1 }), f("heightCm", "货厢高度（cm）", "Cargo height (cm)", { type: "number", required: true, min: 1 })];
export const resourceFields: Record<ResourceKind, Field[]> = {
  fleet: [f("legalName", "公司法定名称", "Legal company name", { required: true }), f("registrationNumber", "企业注册编号", "Business registration number"), ...contacts],
  driver: [f("vehicleClasses", "允许驾驶车型（可多选）", "Permitted vehicle classes", { type: "list", options: vehicleIds, required: true }), ...contacts],
  vehicle: [f("vehicleClass", "车型", "Vehicle class", { type: "select", options: vehicleIds, required: true }), f("country", "注册国家", "Registration country", { type: "select", options: ["DE"] }), f("registration", "车牌 / 车辆唯一编号", "Registration / unique vehicle identifier", { required: true }), ...dimensions, f("equipment", "设备与装卸条件", "Equipment and loading facilities"), ...contacts],
};
const enabled = f("enabled", "启用（仅开发估价/内容，不开放正式交易）", "Enabled (preview only, no live transactions)", { type: "checkbox" });
const net = (key: string, zh: string, en: string) => f(key, `${zh}（EUR，未税）`, `${en} (EUR, net)`, { type: "number", min: 0, required: true });
export const configFields: Record<ConfigKind, Field[]> = {
  region: [enabled, f("city", "城市", "City", { type: "select", options: ["Frankfurt"] }), f("country", "国家", "Country", { type: "select", options: ["DE"] }), f("timezone", "运营时区", "Operating timezone", { type: "select", options: ["Europe/Berlin"] }), f("radiusKm", "候选服务半径（km）", "Candidate radius (km)", { type: "number", required: true, min: 1, max: 200 }), f("centreLat", "中心纬度", "Centre latitude", { type: "number", required: true, step: "0.000001" }), f("centreLng", "中心经度", "Centre longitude", { type: "number", required: true, step: "0.000001" }), f("openingHours", "营业时段（当地时间）", "Opening hours (local time)", { required: true }), f("boundaryNotes", "边界及限制说明", "Boundaries and restrictions", { type: "textarea", required: true })],
  vehicle: [enabled, ...dimensions],
  pricing: [enabled, net("baseNet", "起步费", "Base fare"), f("includedKm", "起步含里程（km）", "Included distance (km)", { type: "number", min: 0, required: true }), f("tier1UntilKm", "第一段截止总里程（km）", "First tier ends at total distance (km)", { type: "number", min: 0, required: true }), net("perKmNet", "第一段每公里", "First tier per km"), net("tier2PerKmNet", "第二段每公里", "Second tier per km"), net("extraStopNet", "额外站点费", "Additional stop"), net("loadingHelpNet", "司机协助装卸", "Driver loading help"), net("helperNet", "额外搬运人员", "Additional helper"), f("freeWaitMinutes", "免费等候分钟", "Free waiting minutes", { type: "number", min: 0, step: "1", required: true }), f("waitBlockMinutes", "等候计费单位（分钟）", "Waiting block (minutes)", { type: "number", min: 1, step: "1", required: true }), net("waitBlockNet", "每单位等候费", "Waiting charge per block"), f("priorityRate", "优先附加比例（0.12 = 12%）", "Priority rate (0.12 = 12%)", { type: "number", min: 0, max: 1, required: true }), f("vatRate", "工程估价税率（0.19 = 19%，非税务建议）", "Preview tax rate (0.19 = 19%, not tax advice)", { type: "number", min: 0, max: 1, required: true })],
  requirements: [f("requiredDocuments", "该主体必须提交的资料类型", "Required document types", { type: "list", options: documentTypes, required: true }), f("locallyConfirmed", "当地负责人已确认审核清单", "Local responsible person confirmed this checklist", { type: "checkbox", required: true })],
  content: [enabled, f("category", "内容分类", "Content category", { type: "select", options: ["faq", "announcement", "service"] }), f("titleZh", "中文标题", "Chinese title", { required: true, max: 140 }), f("titleEn", "英文标题", "English title", { required: true, max: 140 }), f("bodyZh", "中文正文（纯文本）", "Chinese body (plain text)", { type: "textarea", required: true, max: 6000 }), f("bodyEn", "英文正文（纯文本）", "English body (plain text)", { type: "textarea", required: true, max: 6000 })],
};
export function parseFields(fields: Field[], body: Record<string, string | File | (string | File)[]>) {
  return Object.fromEntries(fields.map(field => {
    const raw = body[field.key];
    const value = typeof raw === "string" ? raw : "";
    return [field.key, field.type === "checkbox" ? value === "on" : field.type === "number" ? value === "" ? NaN : Number(value) : field.type === "list" ? (Array.isArray(raw) ? raw.filter(item => typeof item === "string") : value ? [value] : []) : value];
  }));
}
