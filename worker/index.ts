import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { quoteRequestSchema } from "../shared/pricing";
import { publishedConfigs, configuredVehicles, quoteWithConfig } from "./public-config";
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

app.get("/api/vehicles", async c => c.json({ vehicles: Object.values(configuredVehicles(await publishedConfigs(c.env?.DB))) }));
app.get("/api/content", async c => {
  const configs = await publishedConfigs(c.env?.DB);
  return c.json({ items: [...configs.values()].filter(row => row.kind === "content").map(row => ({ id: row.scope, ...JSON.parse(row.data_json) })).filter(item => item.enabled) });
});

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

  try { return context.json({ quote: quoteWithConfig(parsed.data, await publishedConfigs(context.env?.DB)) }); }
  catch (error) {
    if (error instanceof Error && ["SERVICE_UNAVAILABLE", "VEHICLE_UNAVAILABLE"].includes(error.message)) return context.json({ error: error.message }, 422);
    throw error;
  }
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
