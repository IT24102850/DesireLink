import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translations } from "./translations";

const I18nCtx = createContext(null);
export const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "si", label: "සිංහල", short: "සිං" },
  { code: "ta", label: "தமிழ்", short: "தமி" },
];

function initialLang() {
  try {
    const saved = localStorage.getItem("dl_lang");
    if (translations[saved]) return saved;
  } catch {}
  const nav = (navigator.language || "").slice(0, 2);
  return translations[nav] ? nav : "en";
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    try {
      localStorage.setItem("dl_lang", lang);
    } catch {}
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key, vars) => {
      let s = translations[lang]?.[key] ?? translations.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
      return s;
    },
    [lang]
  );
  const terr = useCallback((e) => t(`err.${e?.code || e?.message || "SERVER_ERROR"}`), [t]);

  const value = useMemo(() => ({ lang, setLang, t, terr }), [lang, t, terr]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
