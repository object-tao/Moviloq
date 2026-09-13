import type { QuoteEstimate, QuoteRequest } from "../../shared/pricing";

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
