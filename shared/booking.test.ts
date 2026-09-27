import { describe, expect, it } from "vitest";
import { blankBooking, bookingSchema, quoteInput, restoreBookingLocations, validSchedule } from "./booking";
import { bookingCountries, formatStopLocation, validBookingCity } from "./locations";
import { calculateQuote, quoteRequestSchema } from "./pricing";

function sample() {
  const booking = blankBooking();
  booking.pickup.city = "Frankfurt am Main";
  booking.dropoffs[0].city = "Berlin";
  booking.pickup.address = "Test pickup Frankfurt";
  booking.dropoffs[0].address = "Test destination Frankfurt";
  booking.cargo.description = "Test boxes";
  return booking;
}

describe("delivery draft validation", () => {
  it("accepts city-only routes without a street address and preserves location fields", () => {
    const booking = sample();
    booking.pickup.address = "";
    Object.assign(booking.dropoffs[0], { countryCode: "PL", city: "Warsaw", address: "" });
    const parsed = bookingSchema.parse(booking);
    expect(parsed.pickup).toMatchObject({ countryCode: "DE", city: "Frankfurt am Main", address: "" });
    expect(parsed.dropoffs[0]).toMatchObject({ countryCode: "PL", city: "Warsaw", address: "" });
  });
  it("rejects missing, unknown and mismatched country/city pairs", () => {
    for (const location of [{ countryCode: "", city: "" }, { countryCode: "DE", city: "" }, { countryCode: "XX", city: "Berlin" }, { countryCode: "PL", city: "Berlin" }, { countryCode: "DE", city: "<script>" }]) {
      const booking = sample(); Object.assign(booking.pickup, location);
      expect(bookingSchema.safeParse(booking).success).toBe(false);
    }
    const booking = sample(); booking.dropoffs[0].city = "Madrid";
    expect(bookingSchema.safeParse(booking).success).toBe(false);
  });
  it("restores legacy address-only drafts without guessing locations or dropping data", () => {
    const booking = sample();
    const legacyStop = { address: "Legacy street and postcode", contactName: "Test", phone: "", notes: "Keep this" };
    const restored = restoreBookingLocations({ ...booking, pickup: legacyStop, dropoffs: [legacyStop] });
    expect(restored.pickup).toEqual({ ...legacyStop, countryCode: "", city: "" });
    expect(restored.dropoffs[0]).toEqual(restored.pickup);
    expect(bookingSchema.safeParse(restored).success).toBe(false);
    expect(formatStopLocation(restored.pickup, "zh")).toBe(legacyStop.address);
    expect(restoreBookingLocations(booking)).toEqual(booking);
  });
  it("uses stable city values and localized draft summaries", () => {
    expect(new Set(bookingCountries.map(country => country.code)).size).toBe(bookingCountries.length);
    for (const country of bookingCountries) {
      expect(new Set(country.cities.map(([name]) => name)).size).toBe(country.cities.length);
      for (const [city] of country.cities) expect(validBookingCity(country.code, city)).toBe(true);
    }
    expect(formatStopLocation({ countryCode: "ES", city: "Madrid", address: "" }, "zh")).toBe("西班牙 · 马德里");
    expect(formatStopLocation({ countryCode: "PL", city: "Warsaw", address: "Sample street" }, "en")).toBe("Poland · Warsaw · Sample street");
  });
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
