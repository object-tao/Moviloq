import { describe, expect, it } from "vitest";
import { blankBooking, bookingSchema, quoteInput, validSchedule } from "./booking";
import { calculateQuote, quoteRequestSchema } from "./pricing";

function sample() {
  const booking = blankBooking();
  booking.pickup.address = "Test pickup Frankfurt";
  booking.dropoffs[0].address = "Test destination Frankfurt";
  booking.cargo.description = "Test boxes";
  return booking;
}

describe("delivery draft validation", () => {
  it("normalizes input and removes untrusted extra fields", () => {
    const booking = sample();
    booking.pickup.address = "  Test pickup  ";
    const result = bookingSchema.parse({ ...booking, estimate: { total: 0 }, extraStops: 0 });
    expect(result.pickup.address).toBe("Test pickup");
    expect(result).not.toHaveProperty("estimate");
    expect(result).not.toHaveProperty("extraStops");
  });
  it("requires both ends of the route and bounded cargo input", () => {
    expect(bookingSchema.safeParse(blankBooking()).success).toBe(false);
    expect(bookingSchema.safeParse({ ...sample(), dropoffs: [] }).success).toBe(false);
    for (const quantity of [0, -1, 1.2, 501]) {
      const booking = sample(); booking.cargo.quantity = quantity;
      expect(bookingSchema.safeParse(booking).success).toBe(false);
    }
  });
  it("charges additional stops from the actual route and caps it at 20", () => {
    const booking = sample();
    booking.dropoffs = Array.from({ length: 20 }, () => ({ ...booking.dropoffs[0] }));
    expect(bookingSchema.safeParse(booking).success).toBe(true);
    expect(quoteInput(booking).extraStops).toBe(19);
    expect(calculateQuote(quoteInput(booking)).breakdown.stops).toBe(85.5);
    booking.dropoffs.push({ ...booking.dropoffs[0] });
    expect(bookingSchema.safeParse(booking).success).toBe(false);
  });
  it("enforces total vehicle weight, including exact capacity", () => {
    const booking = sample(); booking.cargo.totalWeightKg = 1000;
    expect(bookingSchema.safeParse(booking).success).toBe(true);
    booking.cargo.totalWeightKg = 1000.1;
    const result = bookingSchema.safeParse(booking);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.message)).toContain("OVERWEIGHT");
  });
  it("allows upright base rotation, never rotating height", () => {
    const booking = sample(); booking.vehicleId = "car";
    Object.assign(booking.cargo, { lengthCm: 60, widthCm: 90, heightCm: 50 });
    expect(bookingSchema.safeParse(booking).success).toBe(true);
    booking.cargo.heightCm = 51;
    const result = bookingSchema.safeParse(booking);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.message)).toContain("OVERSIZED");
  });
  it("requires a consistent schedule and validates its time window", () => {
    const booking = sample(); booking.serviceType = "scheduled";
    expect(bookingSchema.safeParse(booking).success).toBe(false);
    const now = Date.UTC(2026, 8, 13, 12);
    for (const [delta, expected] of [[899999, false], [900000, true], [2592000000, true], [2592000001, false]] as const) {
      booking.scheduledAt = new Date(now + delta).toISOString();
      expect(validSchedule(booking, now)).toBe(expected);
    }
    booking.serviceType = "on-demand";
    expect(bookingSchema.safeParse(booking).success).toBe(false);
  });
  it("keeps displayed cents equal to the subtotal with a fractional distance", () => {
    const quote = calculateQuote(quoteRequestSchema.parse({ vehicleId: "transporter", distanceKm: 18.3, priority: true, loadingHelp: true }));
    const cents = Object.values(quote.breakdown).reduce((sum, line) => sum + Math.round(line * 100), 0);
    expect(Math.round(quote.net * 100)).toBe(cents);
    expect(Math.round(quote.total * 100)).toBe(cents + Math.round(quote.vat * 100));
    expect(Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt)).toBeGreaterThanOrEqual(600000);
  });
});
