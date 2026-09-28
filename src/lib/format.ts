export function formatCurrency(value: number, currency: "EUR" | "USD", language: "en" | "zh") {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-DE", {
    style: "currency",
    currency
  }).format(value);
}

export const formatEuro = (value: number, language: "en" | "zh") => formatCurrency(value,"EUR",language);
