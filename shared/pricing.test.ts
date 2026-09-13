import { describe, expect, it } from "vitest";
import { calculateQuote } from "./pricing";

describe("calculateQuote", () => {
  it("calculates a transparent gross estimate", () => {
    const quote = calculateQuote({
      vehicleId: "transporter",
      distanceKm: 25,
      extraStops: 1,
      loadingHelp: true,
      helper: false,
      waitMinutes: 20,
      priority: false
    });

    expect(quote.currency).toBe("EUR");
    expect(quote.total).toBeGreaterThan(quote.net);
    expect(quote.breakdown.stops).toBe(4.5);
    expect(quote.breakdown.wait).toBe(6);
  });

  it("keeps the first ten waiting minutes free", () => {
    const quote = calculateQuote({
      vehicleId: "car",
      distanceKm: 5,
      extraStops: 0,
      loadingHelp: false,
      helper: false,
      waitMinutes: 10,
      priority: false
    });

    expect(quote.breakdown.wait).toBe(0);
  });
});
