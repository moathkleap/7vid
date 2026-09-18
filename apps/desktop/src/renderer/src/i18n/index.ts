import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

export type Lang = 'ar' | 'en';

export function detectLanguage(pref: 'system' | 'ar' | 'en'): Lang {
  if (pref === 'ar' || pref === 'en') return pref;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function initI18n(): void {
  if (i18next.isInitialized) return;
  void i18next.use(initReactI18next).init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng: detectLanguage('system'),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function applyLanguage(lang: Lang): void {
  if (i18next.language !== lang) void i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export { i18next };
