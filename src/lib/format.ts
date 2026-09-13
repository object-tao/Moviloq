export function formatEuro(value: number, language: "en" | "zh") {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-DE", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}
