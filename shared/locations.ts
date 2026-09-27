// A curated planning catalogue, not a declaration of operational service coverage.
// Persist stable English city names and ISO country codes, never translated labels.
export type Country = { code: string; en: string; zh: string; enabled?: boolean; sortOrder?: number; disabledCities?: readonly string[]; cities: readonly (readonly [string, string, string?])[] };
export const bookingCountries: readonly Country[] = [
  { code: "DE", en: "Germany", zh: "德国", cities: [["Frankfurt am Main", "法兰克福（美因河畔）"], ["Berlin", "柏林"], ["Hamburg", "汉堡"], ["Munich", "慕尼黑"], ["Cologne", "科隆"], ["Dusseldorf", "杜塞尔多夫"], ["Stuttgart", "斯图加特"], ["Leipzig", "莱比锡"], ["Nuremberg", "纽伦堡"], ["Dresden", "德累斯顿"], ["Bremen", "不来梅"], ["Dortmund", "多特蒙德"]] },
  { code: "PL", en: "Poland", zh: "波兰", cities: [["Warsaw", "华沙"], ["Krakow", "克拉科夫"], ["Wroclaw", "弗罗茨瓦夫"], ["Poznan", "波兹南"], ["Gdansk", "格但斯克"], ["Lodz", "罗兹"]] },
  { code: "ES", en: "Spain", zh: "西班牙", cities: [["Madrid", "马德里"], ["Barcelona", "巴塞罗那"], ["Valencia", "瓦伦西亚"], ["Seville", "塞维利亚"], ["Zaragoza", "萨拉戈萨"], ["Bilbao", "毕尔巴鄂"]] },
  { code: "FR", en: "France", zh: "法国", cities: [["Paris", "巴黎"], ["Lyon", "里昂"], ["Marseille", "马赛"], ["Lille", "里尔"], ["Strasbourg", "斯特拉斯堡"], ["Toulouse", "图卢兹"]] },
  { code: "NL", en: "Netherlands", zh: "荷兰", cities: [["Amsterdam", "阿姆斯特丹"], ["Rotterdam", "鹿特丹"], ["The Hague", "海牙"], ["Utrecht", "乌得勒支"], ["Eindhoven", "埃因霍温"]] },
  { code: "BE", en: "Belgium", zh: "比利时", cities: [["Brussels", "布鲁塞尔"], ["Antwerp", "安特卫普"], ["Ghent", "根特"], ["Liege", "列日"]] },
  { code: "AT", en: "Austria", zh: "奥地利", cities: [["Vienna", "维也纳"], ["Graz", "格拉茨"], ["Linz", "林茨"], ["Salzburg", "萨尔茨堡"], ["Innsbruck", "因斯布鲁克"]] },
  { code: "CH", en: "Switzerland", zh: "瑞士", cities: [["Zurich", "苏黎世"], ["Geneva", "日内瓦"], ["Basel", "巴塞尔"], ["Bern", "伯尔尼"], ["Lausanne", "洛桑"]] },
  { code: "CZ", en: "Czechia", zh: "捷克", cities: [["Prague", "布拉格"], ["Brno", "布尔诺"], ["Ostrava", "俄斯特拉发"]] },
  { code: "IT", en: "Italy", zh: "意大利", cities: [["Rome", "罗马"], ["Milan", "米兰"], ["Turin", "都灵"], ["Bologna", "博洛尼亚"], ["Naples", "那不勒斯"]] },
  { code: "LU", en: "Luxembourg", zh: "卢森堡", cities: [["Luxembourg City", "卢森堡市"]] },
  { code: "DK", en: "Denmark", zh: "丹麦", cities: [["Copenhagen", "哥本哈根"], ["Aarhus", "奥胡斯"], ["Odense", "欧登塞"]] }
];

export const bookingCountry = (code: string, countries = bookingCountries) => countries.find(country => country.code === code);
export const validBookingCity = (countryCode: string, city: string, countries = bookingCountries) => {
  const country = bookingCountry(countryCode, countries);
  return !!country && country.enabled !== false && !country.disabledCities?.includes(city) && country.cities.some(([name]) => name === city);
};

export function formatStopLocation(stop: { countryCode?: string; city?: string; address?: string }, language: "en" | "zh", countries = bookingCountries) {
  const country = bookingCountry(stop.countryCode ?? "", countries);
  const city = country?.cities.find(([name]) => name === stop.city);
  return [country?.[language] ?? stop.countryCode, city ? language === "zh" ? city[1] : city[2] ?? city[0] : stop.city, stop.address].filter(Boolean).join(" · ");
}
