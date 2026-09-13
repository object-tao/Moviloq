import { describe, expect, it } from "vitest";
import app from "./index";

describe("Moviloq API", () => {
  it("reports a healthy test environment", async () => {
    const response = await app.request(
      "/api/health",
      undefined,
      { ENVIRONMENT: "test" }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "moviloq",
      environment: "test"
    });
  });

  it("returns a validated itemised quote", async () => {
    const response = await app.request("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "transporter",
        distanceKm: 18,
        extraStops: 1,
        loadingHelp: true,
        helper: false,
        waitMinutes: 0,
        priority: false
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      quote: {
        currency: "EUR",
        kind: "estimate",
        breakdown: { stops: 4.5 }
      }
    });
  });

  it("rejects malformed quote requests", async () => {
    const response = await app.request("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId: "spaceship", distanceKm: -1 })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_QUOTE_REQUEST"
    });
  });
});
