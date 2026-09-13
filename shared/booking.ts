import { z } from "zod";
import { vehicles, vehicleIds, type QuoteEstimate, type QuoteRequest } from "./pricing";

export const stopSchema = z.object({
  address: z.string().trim().min(3).max(240),
  contactName: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(30).regex(/^[+\d ()-]*$/).default(""),
  notes: z.string().trim().max(400).default("")
});

export const bookingSchema = z.object({
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
  const vehicle = vehicles[value.vehicleId];
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
});

export type BookingInput = z.infer<typeof bookingSchema>;
export type BookingStop = BookingInput["pickup"];
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
  return { address: "", contactName: "", phone: "", notes: "" };
}

export function blankBooking(): BookingInput {
  return {
    pickup: blankStop(), dropoffs: [blankStop()], vehicleId: "transporter", distanceKm: 18,
    serviceType: "on-demand", scheduledAt: null,
    cargo: { description: "", quantity: 1, totalWeightKg: 20, lengthCm: 60, widthCm: 40, heightCm: 40, fragile: false },
    loadingHelp: false, helper: false, priority: false, notes: ""
  };
}
