// Multi-language infrastructure (PB6 reversal — English only until brand #6).
// This module provides the infrastructure; actual translation strings are
// added per-language when a pilot brand requests non-English support.

// "ar" added for Arabic/ME storefronts (panel P0: absent entirely).
// RTL CSS is a separate widget-layer concern; this covers locale detection.
export type SupportedLocale = "en" | "fr" | "de" | "es" | "it" | "pt" | "ja" | "zh" | "ar";

export const DEFAULT_LOCALE: SupportedLocale = "en";

export type TranslationKey =
  | "mira.greeting.first"
  | "mira.greeting.returning"
  | "widget.fit.heading"
  | "widget.tryon.heading"
  | "widget.signup.heading"
  | "widget.signup.otp.prompt"
  | "widget.combo.try_look"
  | "widget.combo.add_all";

// English strings (complete)
const EN: Record<TranslationKey, string> = {
  "mira.greeting.first": "Hey! Found something you like?",
  "mira.greeting.returning": "Welcome back! Want to pick up where we left off?",
  "widget.fit.heading": "Find your fit",
  "widget.tryon.heading": "Try it on",
  "widget.signup.heading": "Save your style",
  "widget.signup.otp.prompt": "Enter the 6-digit code we sent to {email}",
  "widget.combo.try_look": "Try this look →",
  "widget.combo.add_all": "Add all to bag",
};

// Partial dictionaries — keys not present fall back to English.
const LOCALES: Record<SupportedLocale, Partial<Record<TranslationKey, string>>> = {
  en: EN,

  // French
  fr: {
    "mira.greeting.first":       "Bonjour ! Vous avez trouvé quelque chose qui vous plaît ?",
    "mira.greeting.returning":   "Bon retour ! On reprend là où on s'était arrêtés ?",
    "widget.fit.heading":        "Trouvez votre taille",
    "widget.tryon.heading":      "Essayez-le",
    "widget.signup.heading":     "Sauvegardez votre style",
    "widget.signup.otp.prompt":  "Entrez le code à 6 chiffres envoyé à {email}",
    "widget.combo.try_look":     "Essayez ce look →",
    "widget.combo.add_all":      "Tout ajouter au panier",
  },

  // German
  de: {
    "mira.greeting.first":       "Hey! Haben Sie etwas Schönes gefunden?",
    "mira.greeting.returning":   "Willkommen zurück! Möchten Sie weitermachen?",
    "widget.fit.heading":        "Ihre Größe finden",
    "widget.tryon.heading":      "Anprobieren",
    "widget.signup.heading":     "Stil speichern",
    "widget.signup.otp.prompt":  "Geben Sie den 6-stelligen Code ein, den wir an {email} gesendet haben",
    "widget.combo.try_look":     "Diesen Look ausprobieren →",
    "widget.combo.add_all":      "Alles in den Warenkorb",
  },

  // Spanish
  es: {
    "mira.greeting.first":       "¡Hola! ¿Encontraste algo que te gusta?",
    "mira.greeting.returning":   "¡Bienvenido de nuevo! ¿Seguimos donde lo dejamos?",
    "widget.fit.heading":        "Encuentra tu talla",
    "widget.tryon.heading":      "Pruébatelo",
    "widget.signup.heading":     "Guarda tu estilo",
    "widget.signup.otp.prompt":  "Ingresa el código de 6 dígitos que enviamos a {email}",
    "widget.combo.try_look":     "Prueba este look →",
    "widget.combo.add_all":      "Agregar todo al carrito",
  },

  it: {}, // TODO: Italian
  pt: {}, // TODO: Portuguese
  ja: {}, // TODO: Japanese
  zh: {}, // TODO: Chinese
  ar: {}, // TODO: Arabic — RTL layout requires widget dir='rtl' separately
};

export function t(key: TranslationKey, locale: SupportedLocale = DEFAULT_LOCALE, vars?: Record<string, string>): string {
  const raw = LOCALES[locale]?.[key] ?? EN[key];
  if (!vars) return raw;
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), raw);
}

export function detectLocale(acceptLanguage?: string): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const lang = acceptLanguage.split(",")[0]?.split("-")[0]?.toLowerCase() ?? "en";
  const supported = Object.keys(LOCALES) as SupportedLocale[];
  return supported.includes(lang as SupportedLocale) ? (lang as SupportedLocale) : DEFAULT_LOCALE;
}
