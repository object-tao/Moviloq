import { z } from "zod";
import type { Country } from "./locations";

const text = z.string().trim();
export const siteSchema = z.object({
  name: text.min(2).max(60),
  logoUrl: text.max(500).refine(value => !value || /^\/(?!\/)[a-zA-Z0-9/_?.=&%-]+$/.test(value) || (() => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } })(), "Use an HTTPS image URL or a local image path"),
  email: z.email().max(254), phone: text.max(40).regex(/^[+\d ()-]*$/),
  defaultLanguage: z.enum(["zh", "en"]), introductionZh: text.max(600), introductionEn: text.max(600)
});
export const parametersSchema = z.object({
  maxDropoffs: z.number().int().min(1).max(20),
  minScheduleMinutes: z.number().int().min(15).max(1440),
  maxScheduleDays: z.number().int().min(1).max(30),
  quoteValidityMinutes: z.number().int().min(1).max(60),
  maxDistanceKm: z.number().min(1).max(15000)
}).refine(value => value.minScheduleMinutes < value.maxScheduleDays * 1440, "Reservation window must be non-empty");
export const countrySchema = z.object({ enabled: z.boolean(), nameZh: text.min(1).max(80), nameEn: text.min(1).max(80), sortOrder: z.number().int().min(0).max(9999) });
export const citySchema = countrySchema.extend({ countryCode: text.regex(/^[A-Z]{2}$/), cityValue: text.min(1).max(80) });
export type SiteSettings = z.infer<typeof siteSchema>;
export type BookingParameters = z.infer<typeof parametersSchema>;
export const defaultSite: SiteSettings = { name: "Moviloq", logoUrl: "", email: "hello@moviloq.com", phone: "", defaultLanguage: "en", introductionZh: "清晰协调每一趟本地运输。", introductionEn: "Local logistics, coordinated with clarity." };
export const defaultParameters: BookingParameters = { maxDropoffs: 20, minScheduleMinutes: 15, maxScheduleDays: 30, quoteValidityMinutes: 10, maxDistanceKm: 15000 };
export type PublicSettings = { site: SiteSettings; parameters: BookingParameters; countries: Country[] };
export const cityScope = (countryCode: string, city: string) => `${countryCode}:${encodeURIComponent(city)}`;
