// Owner-confirmed payload/volume. Dimensions and tariffs are explicit test placeholders.
const commonPlaceholderPricing = {
  includedKm: 100,
  tier1UntilKm: 1000,
  extraStopNet: 80,
  loadingHelpNet: 150,
  helperNet: 150,
  freeWaitMinutes: 60,
  waitBlockMinutes: 30,
  waitBlockNet: 25,
  priorityRate: 0.08,
  pricingStatus: "test-placeholder" as const
};

export const heavyVehicleIds = [
  "heavy-datongdao-5-axle",
  "heavy-datongdao-6-axle",
  "heavy-120m3-5-axle",
  "heavy-120m3-6-axle",
  "heavy-130m3",
  "heavy-140m3",
  "heavy-flatbed-13m-5-axle",
  "heavy-flatbed-13m-6-axle",
  "heavy-flatbed-17m-5-axle",
  "heavy-flatbed-17m-6-axle"
] as const;

export const heavyVehicles = {
  "heavy-datongdao-5-axle": { id:"heavy-datongdao-5-axle",nameZh:"大通道5轴",nameEn:"Datongdao · 5 axles",descriptionZh:"有效 90 m³ · 载重 22,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 90 m³ · payload 22,000 kg; dimensions and rates are test placeholders.",sortOrder:200,effectiveVolumeM3:90,capacityKg:22000,cargoSizeCm:[1360,245,270] as [number,number,number],baseNet:320,perKmNet:1.75,tier2PerKmNet:1.45,...commonPlaceholderPricing },
  "heavy-datongdao-6-axle": { id:"heavy-datongdao-6-axle",nameZh:"大通道6轴",nameEn:"Datongdao · 6 axles",descriptionZh:"有效 90 m³ · 载重 23,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 90 m³ · payload 23,000 kg; dimensions and rates are test placeholders.",sortOrder:201,effectiveVolumeM3:90,capacityKg:23000,cargoSizeCm:[1360,245,270] as [number,number,number],baseNet:350,perKmNet:1.9,tier2PerKmNet:1.58,...commonPlaceholderPricing },
  "heavy-120m3-5-axle": { id:"heavy-120m3-5-axle",nameZh:"120立方车5轴",nameEn:"120 m³ truck · 5 axles",descriptionZh:"有效 120 m³ · 载重 22,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 120 m³ · payload 22,000 kg; dimensions and rates are test placeholders.",sortOrder:202,effectiveVolumeM3:120,capacityKg:22000,cargoSizeCm:[1360,245,360] as [number,number,number],baseNet:380,perKmNet:2,tier2PerKmNet:1.65,...commonPlaceholderPricing },
  "heavy-120m3-6-axle": { id:"heavy-120m3-6-axle",nameZh:"120立方车6轴",nameEn:"120 m³ truck · 6 axles",descriptionZh:"有效 120 m³ · 载重 23,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 120 m³ · payload 23,000 kg; dimensions and rates are test placeholders.",sortOrder:203,effectiveVolumeM3:120,capacityKg:23000,cargoSizeCm:[1360,245,360] as [number,number,number],baseNet:410,perKmNet:2.15,tier2PerKmNet:1.78,...commonPlaceholderPricing },
  "heavy-130m3": { id:"heavy-130m3",nameZh:"130立方车",nameEn:"130 m³ truck",descriptionZh:"有效 130 m³ · 载重 22,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 130 m³ · payload 22,000 kg; dimensions and rates are test placeholders.",sortOrder:204,effectiveVolumeM3:130,capacityKg:22000,cargoSizeCm:[1360,250,382] as [number,number,number],baseNet:430,perKmNet:2.25,tier2PerKmNet:1.85,...commonPlaceholderPricing },
  "heavy-140m3": { id:"heavy-140m3",nameZh:"140立方车",nameEn:"140 m³ truck",descriptionZh:"有效 140 m³ · 载重 22,000 kg；尺寸与价格为测试占位。",descriptionEn:"Effective volume 140 m³ · payload 22,000 kg; dimensions and rates are test placeholders.",sortOrder:205,effectiveVolumeM3:140,capacityKg:22000,cargoSizeCm:[1360,250,412] as [number,number,number],baseNet:460,perKmNet:2.4,tier2PerKmNet:1.98,...commonPlaceholderPricing },
  "heavy-flatbed-13m-5-axle": { id:"heavy-flatbed-13m-5-axle",nameZh:"13米平板5轴",nameEn:"13 m flatbed · 5 axles",descriptionZh:"有效方数 200 m³ · 载重 21,500 kg；开放式装载尺寸与价格为测试占位。",descriptionEn:"Effective volume 200 m³ · payload 21,500 kg; open-load dimensions and rates are test placeholders.",sortOrder:206,effectiveVolumeM3:200,capacityKg:21500,cargoSizeCm:[1300,250,300] as [number,number,number],baseNet:500,perKmNet:2.6,tier2PerKmNet:2.15,...commonPlaceholderPricing },
  "heavy-flatbed-13m-6-axle": { id:"heavy-flatbed-13m-6-axle",nameZh:"13米平板6轴",nameEn:"13 m flatbed · 6 axles",descriptionZh:"有效方数 200 m³ · 载重 28,000 kg；开放式装载尺寸与价格为测试占位。",descriptionEn:"Effective volume 200 m³ · payload 28,000 kg; open-load dimensions and rates are test placeholders.",sortOrder:207,effectiveVolumeM3:200,capacityKg:28000,cargoSizeCm:[1300,250,300] as [number,number,number],baseNet:560,perKmNet:2.9,tier2PerKmNet:2.4,...commonPlaceholderPricing },
  "heavy-flatbed-17m-5-axle": { id:"heavy-flatbed-17m-5-axle",nameZh:"17米平板车5轴",nameEn:"17 m flatbed · 5 axles",descriptionZh:"有效方数 200 m³ · 载重 22,000 kg；开放式装载尺寸与价格为测试占位。",descriptionEn:"Effective volume 200 m³ · payload 22,000 kg; open-load dimensions and rates are test placeholders.",sortOrder:208,effectiveVolumeM3:200,capacityKg:22000,cargoSizeCm:[1700,250,300] as [number,number,number],baseNet:600,perKmNet:3.1,tier2PerKmNet:2.55,...commonPlaceholderPricing },
  "heavy-flatbed-17m-6-axle": { id:"heavy-flatbed-17m-6-axle",nameZh:"17米平板车6轴",nameEn:"17 m flatbed · 6 axles",descriptionZh:"有效方数 200 m³ · 载重 28,000 kg；开放式装载尺寸与价格为测试占位。",descriptionEn:"Effective volume 200 m³ · payload 28,000 kg; open-load dimensions and rates are test placeholders.",sortOrder:209,effectiveVolumeM3:200,capacityKg:28000,cargoSizeCm:[1700,250,300] as [number,number,number],baseNet:680,perKmNet:3.5,tier2PerKmNet:2.9,...commonPlaceholderPricing }
} as const;
