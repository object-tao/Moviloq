import { calculateQuote, vehicles, type QuoteRequest } from "../shared/pricing";
import { configSchemas, liveConfigs, type ConfigRow } from "../shared/operations";

export async function publishedConfigs(db?: D1Database) {
  if (!db) return new Map<string, ConfigRow>();
  const rows = await db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY kind, scope ORDER BY effective_at DESC, publication_sequence DESC, id DESC) AS rank
    FROM ops_configs WHERE status = 'published' AND effective_at <= ?) WHERE rank = 1`).bind(new Date().toISOString()).all<ConfigRow>();
  return liveConfigs(rows.results);
}
export function configuredVehicles(configs: Map<string, ConfigRow>): typeof vehicles {
  const catalog = structuredClone(vehicles);
  for (const id of Object.keys(catalog) as (keyof typeof vehicles)[]) {
    const row = configs.get(`vehicle:${id}`);
    if (!row) continue;
    const data = configSchemas.vehicle.parse(JSON.parse(row.data_json));
    if (!data.enabled) { delete catalog[id]; continue; }
    Object.assign(catalog[id], { capacityKg: data.capacityKg, cargoSizeCm: [data.lengthCm, data.widthCm, data.heightCm] });
  }
  return catalog;
}
export function quoteWithConfig(input: QuoteRequest, configs: Map<string, ConfigRow>) {
  const region = configs.get("region:frankfurt");
  if (region && !configSchemas.region.parse(JSON.parse(region.data_json)).enabled) throw new Error("SERVICE_UNAVAILABLE");
  if (!configuredVehicles(configs)[input.vehicleId]) throw new Error("VEHICLE_UNAVAILABLE");
  const row = configs.get(`pricing:${input.vehicleId}`);
  if (!row) return calculateQuote(input);
  const data = configSchemas.pricing.parse(JSON.parse(row.data_json));
  if (!data.enabled) throw new Error("VEHICLE_UNAVAILABLE");
  return calculateQuote(input, data, row.id);
}
