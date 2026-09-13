import type { QuoteEstimate, QuoteRequest, VehicleDefinition } from "../../shared/pricing";
import type { BookingInput, SavedDraft } from "../../shared/booking";

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "REQUEST_FAILED" }));
    throw new ApiError(body.error ?? "REQUEST_FAILED", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const listDrafts = () => jsonRequest<{ drafts: SavedDraft[] }>("/api/drafts");
export const getVehicleCatalog = () => jsonRequest<{ vehicles: VehicleDefinition[] }>("/api/vehicles");
export type PublishedContent = { id: string; category: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string };
export const getPublishedContent = () => jsonRequest<{ items: PublishedContent[] }>("/api/content");
export const getDraft = (id: string) => jsonRequest<{ draft: SavedDraft }>(`/api/drafts/${encodeURIComponent(id)}`);
export const saveDraft = (booking: BookingInput, key: string, existing?: { id: string; version: number }) =>
  jsonRequest<{ draft: SavedDraft }>(existing ? `/api/drafts/${encodeURIComponent(existing.id)}` : "/api/drafts", {
    method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ booking, version: existing?.version })
  });
export const deleteDraft = (draft: SavedDraft) => jsonRequest<void>(`/api/drafts/${encodeURIComponent(draft.id)}`, { method: "DELETE", headers: { "If-Match": String(draft.version) } });

type QuoteResponse = {
  quote: QuoteEstimate;
};

export async function requestQuote(input: QuoteRequest): Promise<QuoteEstimate> {
  const response = await fetch("/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Unable to calculate an estimate right now.");
  }

  const data = (await response.json()) as QuoteResponse;
  return data.quote;
}
