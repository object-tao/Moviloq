import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { calculateQuote, quoteRequestSchema, vehicles } from "../shared/pricing";
import { drafts, expireDrafts, type DraftBindings } from "./drafts";

type Bindings = DraftBindings;

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", secureHeaders());
app.route("/api/drafts", drafts);

app.get("/api/health", async (context) => {
  if (context.env.DB) await context.env.DB.prepare("SELECT 1 FROM visitor_sessions LIMIT 1").all();
  return context.json({
    ok: true,
    service: "moviloq",
    environment: context.env.ENVIRONMENT ?? "development",
    timestamp: new Date().toISOString(),
    storage: context.env.DB ? "ready" : "unconfigured"
  });
});

app.get("/api/vehicles", (context) =>
  context.json({
    vehicles: Object.values(vehicles).map(({ id, capacityKg, cargoSizeCm }) => ({
      id,
      capacityKg,
      cargoSizeCm
    }))
  })
);

app.post("/api/quotes", async (context) => {
  const body: unknown = await context.req.json().catch(() => null);
  const parsed = quoteRequestSchema.safeParse(body);

  if (!parsed.success) {
    return context.json(
      {
        error: "INVALID_QUOTE_REQUEST",
        message: "The quote request contains invalid values.",
        issues: parsed.error.issues
      },
      422
    );
  }

  return context.json({ quote: calculateQuote(parsed.data) });
});

app.notFound((context) => {
  if (context.req.path.startsWith("/api/")) {
    return context.json({ error: "NOT_FOUND", message: "API route not found." }, 404);
  }

  return context.text("Not found", 404);
});

app.onError((error, context) => {
  console.error("Unhandled worker error", error);
  return context.json({ error: "INTERNAL_ERROR", message: "Something went wrong." }, 500);
});

export { app };
export default { fetch: app.fetch, scheduled: (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => ctx.waitUntil(expireDrafts(env)) };
