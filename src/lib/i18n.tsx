import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type Language = "en" | "zh";

const messages = {
  en: {
    nav: {
      personal: "Personal",
      business: "Business",
      partner: "Drive with us",
      track: "Track",
      login: "Log in",
      book: "Book a delivery"
    },
    hero: {
      eyebrow: "Launching in Frankfurt",
      titleA: "Move anything.",
      titleB: "Know what happens next.",
      body: "Clear quotes, verified delivery partners and live progress — from pickup to proof of delivery.",
      primary: "Get an estimate",
      secondary: "Become a partner"
    },
    common: {
      frankfurt: "Frankfurt am Main",
      beta: "Frankfurt pilot",
      learnMore: "Learn more",
      comingSoon: "Coming in the next release"
    }
  },
  zh: {
    nav: {
      personal: "个人服务",
      business: "企业服务",
      partner: "成为承运方",
      track: "订单追踪",
      login: "登录",
      book: "预约运输"
    },
    hero: {
      eyebrow: "即将于法兰克福上线",
      titleA: "轻松发货。",
      titleB: "全程心中有数。",
      body: "透明报价、认证承运方与实时进度，从取货一直看到签收凭证。",
      primary: "获取估价",
      secondary: "成为承运方"
    },
    common: {
      frankfurt: "德国·法兰克福",
      beta: "法兰克福试运营",
      learnMore: "了解更多",
      comingSoon: "将在下一版本开放"
    }
  }
} as const;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (typeof messages)[Language];
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("moviloq-language") : null;
    if (stored === "en" || stored === "zh") {
      return stored;
    }
    if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
      return "zh";
    }
    return "en";
  });

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    window.localStorage.setItem("moviloq-language", language);
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, t: messages[language] }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return context;
}
