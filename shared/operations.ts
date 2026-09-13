import { z } from "zod";
import { vehicleIds, vehicles, type VehicleId } from "./pricing";

export const resourceKinds = ["fleet", "driver", "vehicle"] as const;
export type ResourceKind = typeof resourceKinds[number];
export const roles = ["owner", "operations", "reviewer"] as const;
export type Role = typeof roles[number];
export type Permission = "resources:read" | "resources:write" | "review:write" | "config:read" | "config:write" | "config:publish" | "staff:write" | "audit:read";
const permissions: Record<Role, Permission[]> = {
  owner: ["resources:read", "resources:write", "review:write", "config:read", "config:write", "config:publish", "staff:write", "audit:read"],
  operations: ["resources:read", "resources:write", "config:read", "config:write"],
  reviewer: ["resources:read", "review:write"],
};
export function permissionsFor(role: Role) { return permissions[role] ?? []; }
export function can(role: Role, permission: Permission) { return permissionsFor(role).includes(permission); }
export const documentTypes = ["identity", "driving_licence", "vehicle_registration", "insurance", "business_registration", "other"] as const;
const text = z.string().trim();
const optionalText = text.max(600).default("");
const contactFields = {
  contact: text.max(100).default(""), email: z.union([z.email(), z.literal("")]).default(""),
  phone: text.max(40).regex(/^[+\d ()-]*$/).default(""),
  area: text.max(180).default(""), source: text.min(2).max(300), authorized: z.boolean(), notes: optionalText,
};
export const resourceSchemas = {
  fleet: z.object({ ...contactFields, legalName: text.min(2).max(160), registrationNumber: text.max(100).default("") }),
  driver: z.object({ ...contactFields, vehicleClasses: z.array(z.enum(vehicleIds)).min(1).max(6) }),
  vehicle: z.object({ ...contactFields, vehicleClass: z.enum(vehicleIds), registration: text.min(2).max(32), country: z.literal("DE"), capacityKg: z.number().positive().max(44000), lengthCm: z.number().positive().max(2000), widthCm: z.number().positive().max(400), heightCm: z.number().positive().max(500), equipment: text.max(300).default("") }),
};
export type ResourceData = z.infer<typeof resourceSchemas.fleet> | z.infer<typeof resourceSchemas.driver> | z.infer<typeof resourceSchemas.vehicle>;
export type ResourceRow = { id: string; kind: ResourceKind; name: string; status: string; fleet_id: string | null; driver_id: string | null; registration: string | null; data_json: string; version: number; created_at: string; updated_at: string };
export type DocumentRow = { id: string; resource_id: string; document_type: string; expires_on: string; status: string; filename: string; mime_type: string; byte_length: number; sequence: number; version: number; created_at: string; updated_at: string };
export const configKinds = ["region", "vehicle", "pricing", "requirements", "content"] as const;
export type ConfigKind = typeof configKinds[number];
const money = z.number().min(0).max(100000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places");
export const pricingSchema = z.object({
  enabled: z.boolean(), baseNet: money, includedKm: z.number().min(0).max(500),
  tier1UntilKm: z.number().min(0).max(500), perKmNet: money, tier2PerKmNet: money,
  extraStopNet: money, loadingHelpNet: money, helperNet: money,
  freeWaitMinutes: z.number().int().min(0).max(480), waitBlockMinutes: z.number().int().min(1).max(60), waitBlockNet: money,
  priorityRate: z.number().min(0).max(1), vatRate: z.number().min(0).max(1),
}).refine(value => value.tier1UntilKm >= value.includedKm, "Tier boundary must include the base distance");
export type PricingRule = z.infer<typeof pricingSchema>;
export const configSchemas = {
  region: z.object({ enabled: z.boolean(), city: z.literal("Frankfurt"), country: z.literal("DE"), timezone: z.literal("Europe/Berlin"), radiusKm: z.number().positive().max(200), centreLat: z.number().min(49).max(52), centreLng: z.number().min(7).max(10), openingHours: text.min(2).max(300), boundaryNotes: text.min(2).max(600) }),
  vehicle: z.object({ enabled: z.boolean(), capacityKg: z.number().positive().max(1200), lengthCm: z.number().positive().max(500), widthCm: z.number().positive().max(250), heightCm: z.number().positive().max(250) }),
  pricing: pricingSchema,
  requirements: z.object({ requiredDocuments: z.array(z.enum(documentTypes)).min(1).max(6), locallyConfirmed: z.literal(true) }),
  content: z.object({ enabled: z.boolean(), category: z.enum(["faq", "announcement", "service"]), titleZh: text.min(2).max(140), titleEn: text.min(2).max(140), bodyZh: text.min(2).max(6000), bodyEn: text.min(2).max(6000) }),
};
export type ConfigRow = { id: string; kind: ConfigKind; scope: string; title: string; data_json: string; status: string; version: number; effective_at: string | null; publication_sequence?: number; created_at: string; updated_at: string };
export function defaultPricing(id: VehicleId): PricingRule {
  return { enabled: true, baseNet: vehicles[id].baseNet, includedKm: vehicles[id].includedKm, tier1UntilKm: 500, perKmNet: vehicles[id].perKmNet, tier2PerKmNet: vehicles[id].perKmNet, extraStopNet: 4.5, loadingHelpNet: 25.21, helperNet: 25.21, freeWaitMinutes: 10, waitBlockMinutes: 5, waitBlockNet: 3, priorityRate: 0.12, vatRate: 0.19 };
}
export function scopeFor(kind: ConfigKind, scope: string) {
  return kind === "region" ? scope === "frankfurt" : kind === "pricing" || kind === "vehicle" ? vehicleIds.includes(scope as VehicleId) : kind === "requirements" ? ["fleet", "driver", ...vehicleIds.map(id => `vehicle:${id}`)].includes(scope) : /^[a-z0-9][a-z0-9-]{1,59}$/.test(scope);
}
export function liveConfigs(rows: ConfigRow[], at = new Date().toISOString()) {
  const selected = new Map<string, ConfigRow>();
  for (const row of [...rows].sort((a, b) => (b.effective_at ?? "").localeCompare(a.effective_at ?? "") || (b.publication_sequence ?? 0) - (a.publication_sequence ?? 0) || b.id.localeCompare(a.id))) {
    const key = `${row.kind}:${row.scope}`;
    if (row.status === "published" && row.effective_at && row.effective_at <= at && !selected.has(key)) selected.set(key, row);
  }
  return selected;
}
export function readiness(row: ResourceRow, documents: DocumentRow[], configs: Map<string, ConfigRow>, peers: ResourceRow[], today = new Date().toISOString().slice(0, 10)): string[] {
  const problems: string[] = [];
  const data = JSON.parse(row.data_json) as ResourceData;
  if (!data.authorized) problems.push("authorization_missing");
  if (row.status !== "approved") problems.push("review_required");
  const scope = row.kind === "vehicle" && "vehicleClass" in data ? `vehicle:${data.vehicleClass}` : row.kind;
  const policy = configs.get(`requirements:${scope}`);
  if (!policy) problems.push("policy_missing");
  else {
    const types = configSchemas.requirements.parse(JSON.parse(policy.data_json)).requiredDocuments;
    for (const type of types) {
      const latest = documents.filter(doc => doc.resource_id === row.id && doc.document_type === type).sort((a,b) => b.sequence-a.sequence)[0];
      if (!latest || latest.status !== "approved") problems.push(`document_required:${type}`);
      else if (latest.expires_on < today) problems.push(`document_expired:${type}`);
    }
  }
  if (row.fleet_id) {
    const fleet = peers.find(peer => peer.id === row.fleet_id && peer.kind === "fleet");
    if (!fleet || readiness(fleet, documents, configs, [], today).length) problems.push("fleet_not_ready");
  }
  if (row.kind === "vehicle" && row.driver_id) {
    const driver = peers.find(peer => peer.id === row.driver_id && peer.kind === "driver");
    if (!driver || driver.fleet_id !== row.fleet_id || readiness(driver, documents, configs, peers, today).length || !(JSON.parse(driver.data_json).vehicleClasses as string[]).includes("vehicleClass" in data ? data.vehicleClass : "")) problems.push("driver_not_ready");
  }
  return problems;
}
