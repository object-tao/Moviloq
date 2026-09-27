import { calculateQuote, vehicleIds, vehicles, type QuoteRequest, type VehicleReference } from "../shared/pricing";
import { configSchemas, liveConfigs, type ConfigRow } from "../shared/operations";
import { bookingCountries, type Country } from "../shared/locations";
import { defaultParameters, defaultSite, type PublicSettings } from "../shared/settings";

export async function publishedConfigs(db?: D1Database) {
  if (!db) return new Map<string, ConfigRow>();
  const rows = await db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY kind, scope ORDER BY effective_at DESC, publication_sequence DESC, id DESC) AS rank
    FROM ops_all_configs WHERE status = 'published' AND effective_at <= ?) WHERE rank = 1`).bind(new Date().toISOString()).all<ConfigRow>();
  return liveConfigs(rows.results);
}
export function configuredVehicles(configs: Map<string, ConfigRow>): typeof vehicles {
  const catalog = structuredClone(vehicles);
  for (const id of Object.keys(catalog) as (keyof typeof vehicles)[]) {
    const row = configs.get(`vehicle:${id}`);
    if (!row) continue;
    const data = configSchemas.vehicle.parse(JSON.parse(row.data_json));
    if (!data.enabled) { delete catalog[id]; continue; }
    Object.assign(catalog[id], { ...data, capacityKg: data.capacityKg, cargoSizeCm: [data.lengthCm, data.widthCm, data.heightCm] });
  }
  return catalog;
}
export async function publishedVehicleReferences(db?: D1Database): Promise<VehicleReference[]> {
  if (!db) return [];
  const rows = await db.prepare(`SELECT id,name_zh,name_en,notes_zh,notes_en
    FROM ops_vehicle_type_catalog WHERE status='reference' ORDER BY sort_order,id`).all<{
      id: string; name_zh: string; name_en: string | null; notes_zh: string; notes_en: string | null;
    }>();
  return rows.results.filter(row=>!vehicleIds.includes(row.id as typeof vehicleIds[number])).map(row => ({ id: row.id, nameZh: row.name_zh, nameEn: row.name_en, notesZh: row.notes_zh, notesEn: row.notes_en }));
}
export function configuredSettings(configs: Map<string, ConfigRow>): PublicSettings {
  const site = configs.get("site:website"); const parameters = configs.get("parameters:booking");
  const countries = new Map<string, Country>(bookingCountries.map((country, index) => [country.code, { ...country, cities: [...country.cities], enabled: true, sortOrder: index }]));
  for (const row of configs.values()) if (row.kind === "country") {
    const data = configSchemas.country.parse(JSON.parse(row.data_json));
    countries.set(row.scope, { ...countries.get(row.scope), code: row.scope, en: data.nameEn, zh: data.nameZh, enabled: data.enabled, sortOrder: data.sortOrder, cities: countries.get(row.scope)?.cities ?? [] });
  }
  const cityOrder = new Map<string, number>();
  for (const row of configs.values()) if (row.kind === "city") {
    const data = configSchemas.city.parse(JSON.parse(row.data_json)); const country = countries.get(data.countryCode);
    if (!country) continue;
    country.cities = [...country.cities.filter(([name]) => name !== data.cityValue), [data.cityValue, data.nameZh, data.nameEn]];
    country.disabledCities = [...(country.disabledCities ?? []).filter(name => name !== data.cityValue), ...(data.enabled ? [] : [data.cityValue])];
    cityOrder.set(`${country.code}:${data.cityValue}`, data.sortOrder);
  }
  for (const country of countries.values()) {
    const original = bookingCountries.find(item => item.code === country.code);
    const order = (name: string) => cityOrder.get(`${country.code}:${name}`) ?? original?.cities.findIndex(([value]) => value === name) ?? 9999;
    country.cities = [...country.cities].sort((a,b) => order(a[0])-order(b[0]) || a[0].localeCompare(b[0]));
  }
  return { site: site ? configSchemas.site.parse(JSON.parse(site.data_json)) : { ...defaultSite }, parameters: parameters ? configSchemas.parameters.parse(JSON.parse(parameters.data_json)) : { ...defaultParameters }, countries: [...countries.values()].sort((a,b) => (a.sortOrder ?? 0)-(b.sortOrder ?? 0) || a.code.localeCompare(b.code)) };
}
export function quoteWithConfig(input: QuoteRequest, configs: Map<string, ConfigRow>) {
  const parameters = configuredSettings(configs).parameters;
  if (input.distanceKm > parameters.maxDistanceKm || input.extraStops >= parameters.maxDropoffs) throw new Error("BOOKING_LIMIT_EXCEEDED");
  const region = configs.get("region:frankfurt");
  if (region && !configSchemas.region.parse(JSON.parse(region.data_json)).enabled) throw new Error("SERVICE_UNAVAILABLE");
  if (!configuredVehicles(configs)[input.vehicleId]) throw new Error("VEHICLE_UNAVAILABLE");
  const row = configs.get(`pricing:${input.vehicleId}`);
  const data = row ? configSchemas.pricing.parse(JSON.parse(row.data_json)) : undefined;
  if (data && !data.enabled) throw new Error("VEHICLE_UNAVAILABLE");
  const quote = calculateQuote(input, data, row?.id);
  return { ...quote, validForMinutes: parameters.quoteValidityMinutes, expiresAt: new Date(Date.parse(quote.quotedAt) + parameters.quoteValidityMinutes * 60000).toISOString() };
}
