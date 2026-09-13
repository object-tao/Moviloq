import { z } from "zod";
import type { PricingRule } from "./operations";

export const vehicleIds = [
  "bike",
  "cargo-bike",
  "car",
  "caddy",
  "transporter",
  "xl-transporter"
] as const;

export type VehicleId = (typeof vehicleIds)[number];

export type VehicleDefinition = {
  id: VehicleId;
  capacityKg: number;
  cargoSizeCm: [number, number, number];
  baseNet: number;
  includedKm: number;
  perKmNet: number;
};

export const vehicles: Record<VehicleId, VehicleDefinition> = {
  bike: {
    id: "bike",
    capacityKg: 5,
    cargoSizeCm: [40, 30, 15],
    baseNet: 6.2,
    includedKm: 1,
    perKmNet: 1.2
  },
  "cargo-bike": {
    id: "cargo-bike",
    capacityKg: 40,
    cargoSizeCm: [60, 40, 40],
    baseNet: 6.9,
    includedKm: 1,
    perKmNet: 1.35
  },
  car: {
    id: "car",
    capacityKg: 100,
    cargoSizeCm: [100, 70, 50],
    baseNet: 7.9,
    includedKm: 1,
    perKmNet: 1.4
  },
  caddy: {
    id: "caddy",
    capacityKg: 500,
    cargoSizeCm: [180, 110, 110],
    baseNet: 13,
    includedKm: 1,
    perKmNet: 1.6
  },
  transporter: {
    id: "transporter",
    capacityKg: 1000,
    cargoSizeCm: [320, 140, 180],
    baseNet: 25.35,
    includedKm: 1,
    perKmNet: 1.69
  },
  "xl-transporter": {
    id: "xl-transporter",
    capacityKg: 1200,
    cargoSizeCm: [420, 175, 190],
    baseNet: 29.55,
    includedKm: 1,
    perKmNet: 1.89
  }
};

export const quoteRequestSchema = z.object({
  vehicleId: z.enum(vehicleIds),
  distanceKm: z.number().min(1).max(500),
  extraStops: z.number().int().min(0).max(19).default(0),
  loadingHelp: z.boolean().default(false),
  helper: z.boolean().default(false),
  waitMinutes: z.number().int().min(0).max(480).default(0),
  priority: z.boolean().default(false)
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export type QuoteBreakdown = {
  base: number;
  distance: number;
  stops: number;
  services: number;
  wait: number;
  priority: number;
};

export type QuoteEstimate = {
  currency: "EUR";
  net: number;
  vat: number;
  vatRate: number;
  total: number;
  breakdown: QuoteBreakdown;
  validForMinutes: number;
  kind: "estimate";
  quotedAt: string;
  expiresAt: string;
  pricingVersion?: string;
  pricingRule?: PricingRule;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculateQuote(input: QuoteRequest, rule?: PricingRule, pricingVersion = "engineering-2026-09"): QuoteEstimate {
  const parsed = quoteRequestSchema.parse(input);
  const vehicle = vehicles[parsed.vehicleId];
  const includedKm = rule?.includedKm ?? vehicle.includedKm;
  const boundary = rule?.tier1UntilKm ?? 500;
  const base = rule?.baseNet ?? vehicle.baseNet;
  const distance = roundMoney(Math.max(0, Math.min(parsed.distanceKm, boundary) - includedKm) * (rule?.perKmNet ?? vehicle.perKmNet) + Math.max(0, parsed.distanceKm - boundary) * (rule?.tier2PerKmNet ?? vehicle.perKmNet));
  const stops = roundMoney(parsed.extraStops * (rule?.extraStopNet ?? 4.5));
  const services = roundMoney((parsed.loadingHelp ? rule?.loadingHelpNet ?? 25.21 : 0) + (parsed.helper ? rule?.helperNet ?? 25.21 : 0));
  const wait = roundMoney(Math.max(0, Math.ceil((parsed.waitMinutes - (rule?.freeWaitMinutes ?? 10)) / (rule?.waitBlockMinutes ?? 5))) * (rule?.waitBlockNet ?? 3));
  const beforePriority = base + distance + stops + services + wait;
  const priority = parsed.priority ? roundMoney(beforePriority * (rule?.priorityRate ?? 0.12)) : 0;
  const net = roundMoney(beforePriority + priority);
  const vatRate = rule?.vatRate ?? 0.19;
  const vat = roundMoney(net * vatRate);

  return {
    currency: "EUR",
    net,
    vat,
    vatRate,
    total: roundMoney(net + vat),
    breakdown: {
      base: roundMoney(base),
      distance: roundMoney(distance),
      stops: roundMoney(stops),
      services: roundMoney(services),
      wait: roundMoney(wait),
      priority: roundMoney(priority)
    },
    validForMinutes: 10,
    kind: "estimate",
    pricingVersion,
    ...(rule ? { pricingRule: rule } : {}),
    quotedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
  };
}
