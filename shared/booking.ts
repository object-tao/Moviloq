import { z } from "zod";
import { vehicles, vehicleIds, type QuoteEstimate, type QuoteRequest } from "./pricing";
import { bookingCountry, validBookingCity } from "./locations";

export const stopSchema = z.object({
  countryCode: z.string().trim().length(2).refine(code => !!bookingCountry(code), "INVALID_COUNTRY"),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().max(240).default(""),
  contactName: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(30).regex(/^[+\d ()-]*$/).default(""),
  notes: z.string().trim().max(400).default("")
}).superRefine((stop, context) => {
  if (!validBookingCity(stop.countryCode, stop.city)) context.addIssue({ code: "custom", path: ["city"], message: "INVALID_CITY" });
});

export function createBookingSchema(catalog: typeof vehicles = vehicles) { return z.object({
  pickup: stopSchema,
  dropoffs: z.array(stopSchema).min(1).max(20),
  vehicleId: z.enum(vehicleIds),
  distanceKm: z.number().min(1).max(500),
  serviceType: z.enum(["on-demand", "scheduled"]),
  scheduledAt: z.string().datetime().nullable(),
  cargo: z.object({
    description: z.string().trim().min(2).max(160),
    quantity: z.number().int().min(1).max(500),
    totalWeightKg: z.number().positive().max(1200),
    lengthCm: z.number().positive().max(500),
    widthCm: z.number().positive().max(250),
    heightCm: z.number().positive().max(250),
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
type StoredBooking = Omit<BookingInput, "pickup" | "dropoffs"> & { pickup: StoredStop; dropoffs: StoredStop[] };

// Read pre-location drafts without inventing a country/city or changing their address.
// Saving them still requires the user to select valid locations through stopSchema.
export function restoreBookingLocations(booking: StoredBooking): BookingInput {
  const restore = (stop: StoredStop): BookingStop => ({ ...stop, countryCode: stop.countryCode ?? "", city: stop.city ?? "" });
  return { ...booking, pickup: restore(booking.pickup), dropoffs: booking.dropoffs.map(restore) };
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
    extraStops: booking.dropoffs.length - 1,
    loadingHelp: booking.loadingHelp, helper: booking.helper,
    priority: booking.priority, waitMinutes: 0
  };
}

export function validSchedule(booking: BookingInput, now = Date.now()) {
  if (booking.serviceType === "on-demand") return true;
  const time = Date.parse(booking.scheduledAt ?? "");
  return time >= now + 15 * 60_000 && time <= now + 30 * 86_400_000;
}

export function blankStop(): BookingStop {
  return { countryCode: "DE", city: "", address: "", contactName: "", phone: "", notes: "" };
}

export function blankBooking(): BookingInput {
  return {
    pickup: blankStop(), dropoffs: [blankStop()], vehicleId: "transporter", distanceKm: 18,
    serviceType: "on-demand", scheduledAt: null,
    cargo: { description: "", quantity: 1, totalWeightKg: 20, lengthCm: 60, widthCm: 40, heightCm: 40, fragile: false },
    loadingHelp: false, helper: false, priority: false, notes: ""
  };
}
