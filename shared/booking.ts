import { z } from "zod";
import { vehicles, vehicleIds, type QuoteEstimate, type QuoteRequest } from "./pricing";
import { defaultParameters, type BookingParameters } from "./settings";
import { bookingCountries, bookingCountry, validBookingCity, type Country } from "./locations";

function createStopSchema(countries: readonly Country[]) { return z.object({
  countryCode: z.string().trim().length(2).refine(code => !!bookingCountry(code,countries) && bookingCountry(code,countries)?.enabled !== false, "INVALID_COUNTRY"),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().max(240).default(""),
  contactName: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(30).regex(/^[+\d ()-]*$/).default(""),
  notes: z.string().trim().max(400).default("")
}).superRefine((stop, context) => {
  if (!validBookingCity(stop.countryCode, stop.city,countries)) context.addIssue({ code: "custom", path: ["city"], message: "INVALID_CITY" });
}); }
export const stopSchema = createStopSchema(bookingCountries);

export function createBookingSchema(catalog: typeof vehicles = vehicles, countries: readonly Country[] = bookingCountries, parameters: BookingParameters = defaultParameters) { const locationSchema = createStopSchema(countries); return z.object({
  pickup: locationSchema,
  dropoffs: z.array(locationSchema).min(1).max(parameters.maxDropoffs),
  vehicleId: z.enum(vehicleIds),
  distanceKm: z.number().min(1).max(parameters.maxDistanceKm),
  serviceType: z.enum(["on-demand", "scheduled"]),
  scheduledAt: z.string().datetime().nullable(),
  cargo: z.object({
    description: z.string().trim().min(2).max(160),
    quantity: z.number().int().min(1).max(500),
    totalWeightKg: z.number().positive().max(44000),
    totalVolumeM3: z.number().positive().max(500).default(0.1),
    lengthCm: z.number().positive().max(2000),
    widthCm: z.number().positive().max(400),
    heightCm: z.number().positive().max(500),
    fragile: z.boolean()
  }),
  loadingHelp: z.boolean(),
  helper: z.boolean(),
  priority: z.boolean(),
  notes: z.string().trim().max(600).default("")
}).superRefine((value, context) => {
  const vehicle = catalog[value.vehicleId];
  if (!vehicle) { context.addIssue({ code: "custom", path: ["vehicleId"], message: "VEHICLE_UNAVAILABLE" }); return; }
  if (value.cargo.totalWeightKg > vehicle.capacityKg) {
    context.addIssue({ code: "custom", path: ["cargo", "totalWeightKg"], message: "OVERWEIGHT" });
  }
  if (vehicle.effectiveVolumeM3 && value.cargo.totalVolumeM3 > vehicle.effectiveVolumeM3) {
    context.addIssue({ code: "custom", path: ["cargo", "totalVolumeM3"], message: "OVERVOLUME" });
  }
  // Upright cargo: length/width may rotate, but height cannot be laid on its side.
  const [length, width, height] = vehicle.cargoSizeCm;
  const cargo = value.cargo;
  const fitsBase = (cargo.lengthCm <= length && cargo.widthCm <= width) || (cargo.widthCm <= length && cargo.lengthCm <= width);
  if (!fitsBase || cargo.heightCm > height) {
    context.addIssue({ code: "custom", path: ["cargo", "lengthCm"], message: "OVERSIZED" });
  }
  if (value.serviceType === "scheduled" && !value.scheduledAt) {
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "SCHEDULE_REQUIRED" });
  }
  if (value.serviceType === "on-demand" && value.scheduledAt !== null) {
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "UNEXPECTED_SCHEDULE" });
  }
}); }
export const bookingSchema = createBookingSchema();

export type BookingInput = z.infer<typeof bookingSchema>;
export type BookingStop = BookingInput["pickup"];
type StoredStop = Omit<BookingStop, "countryCode" | "city"> & Partial<Pick<BookingStop, "countryCode" | "city">>;
type StoredCargo = Omit<BookingInput["cargo"], "totalVolumeM3"> & Partial<Pick<BookingInput["cargo"], "totalVolumeM3">>;
type StoredBooking = Omit<BookingInput, "pickup" | "dropoffs" | "cargo"> & { pickup: StoredStop; dropoffs: StoredStop[]; cargo: StoredCargo };

// Read pre-location drafts without inventing a country/city or changing their address.
// Saving them still requires the user to select valid locations through stopSchema.
export function restoreBookingLocations(booking: StoredBooking): BookingInput {
  const restore = (stop: StoredStop): BookingStop => ({ ...stop, countryCode: stop.countryCode ?? "", city: stop.city ?? "" });
  return { ...booking, pickup: restore(booking.pickup), dropoffs: booking.dropoffs.map(restore), cargo: { ...booking.cargo, totalVolumeM3: booking.cargo.totalVolumeM3 ?? 0.1 } };
}
export type SavedDraft = {
  id: string;
  reference: string;
  version: number;
  booking: BookingInput;
  estimate: QuoteEstimate;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export function quoteInput(booking: BookingInput): QuoteRequest {
  return {
    vehicleId: booking.vehicleId, distanceKm: booking.distanceKm,
    pickup: { countryCode: booking.pickup.countryCode, city: booking.pickup.city },
    dropoff: { countryCode: booking.dropoffs[0].countryCode, city: booking.dropoffs[0].city },
    extraStops: booking.dropoffs.length - 1,
    loadingHelp: booking.loadingHelp, helper: booking.helper,
    priority: booking.priority, waitMinutes: 0
  };
}

export function validSchedule(booking: BookingInput, now = Date.now(), parameters: BookingParameters = defaultParameters) {
  if (booking.serviceType === "on-demand") return true;
  const time = Date.parse(booking.scheduledAt ?? "");
  return time >= now + parameters.minScheduleMinutes * 60_000 && time <= now + parameters.maxScheduleDays * 86_400_000;
}

export function blankStop(): BookingStop {
  return { countryCode: "DE", city: "", address: "", contactName: "", phone: "", notes: "" };
}

export function blankBooking(): BookingInput {
  return {
    pickup: blankStop(), dropoffs: [blankStop()], vehicleId: "transporter", distanceKm: 18,
    serviceType: "on-demand", scheduledAt: null,
    cargo: { description: "", quantity: 1, totalWeightKg: 20, totalVolumeM3: 0.1, lengthCm: 60, widthCm: 40, heightCm: 40, fragile: false },
    loadingHelp: false, helper: false, priority: false, notes: ""
  };
}
