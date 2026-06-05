import { describe, it, expect } from "vitest";
import { t, detectLocale, DEFAULT_LOCALE, type SupportedLocale, type TranslationKey } from "../i18n/index.js";

describe("t() — basic lookups", () => {
  it("returns the English string for a known key", () => {
    expect(t("mira.greeting.first")).toBe("Hey! Found something you like?");
  });

  it("returns the English string when locale is explicitly 'en'", () => {
    expect(t("widget.fit.heading", "en")).toBe("Find your fit");
  });

  it("returns the English string for widget.tryon.heading", () => {
    expect(t("widget.tryon.heading")).toBe("Try it on");
  });

  it("returns the English string for widget.signup.heading", () => {
    expect(t("widget.signup.heading")).toBe("Save your style");
  });

  it("returns the English string for widget.combo.try_look", () => {
    expect(t("widget.combo.try_look")).toBe("Try this look →");
  });

  it("returns the English string for widget.combo.add_all", () => {
    expect(t("widget.combo.add_all")).toBe("Add all to bag");
  });

  it("returns the English string for mira.greeting.returning", () => {
    expect(t("mira.greeting.returning")).toBe("Welcome back! Want to pick up where we left off?");
  });

  it("returns the English string for widget.signup.otp.prompt (no vars)", () => {
    const raw = t("widget.signup.otp.prompt");
    expect(raw).toContain("{email}");  // unresolved var when no vars passed
  });
});

describe("t() — locale translations and English fallback", () => {
  // Locales that have full translations
  it("French uses its own translated string when available", () => {
    expect(t("widget.fit.heading", "fr")).toBe("Trouvez votre taille");
  });

  it("German uses its own translated string when available", () => {
    expect(t("widget.fit.heading", "de")).toBe("Ihre Größe finden");
  });

  it("Spanish uses its own translated string when available", () => {
    expect(t("widget.fit.heading", "es")).toBe("Encuentra tu talla");
  });

  // Locales with empty dictionaries fall back to English
  const emptyLocales: SupportedLocale[] = ["it", "pt", "ja", "zh"];

  for (const locale of emptyLocales) {
    it(`falls back to English for locale '${locale}' (empty dict)`, () => {
      expect(t("widget.fit.heading", locale)).toBe("Find your fit");
    });
  }

  it("Italian falls back to English for all keys (empty dict)", () => {
    const keys: TranslationKey[] = [
      "mira.greeting.first",
      "mira.greeting.returning",
      "widget.fit.heading",
      "widget.tryon.heading",
      "widget.signup.heading",
      "widget.combo.try_look",
      "widget.combo.add_all",
    ];
    for (const key of keys) {
      expect(t(key, "it")).toBe(t(key, "en"));
    }
  });
});

describe("t() — variable substitution", () => {
  it("substitutes {email} in otp.prompt", () => {
    const result = t("widget.signup.otp.prompt", "en", { email: "user@example.com" });
    expect(result).toBe("Enter the 6-digit code we sent to user@example.com");
    expect(result).not.toContain("{email}");
  });

  it("substitutes multiple variables", () => {
    // Even though only {email} is in the key, verify the reduce handles multiple vars cleanly
    const result = t("widget.signup.otp.prompt", "en", { email: "a@b.com", other: "ignored" });
    expect(result).toBe("Enter the 6-digit code we sent to a@b.com");
  });

  it("leaves unrecognized vars untouched", () => {
    // Pass a var name that doesn't appear in the template
    const result = t("widget.fit.heading", "en", { unknown: "value" });
    expect(result).toBe("Find your fit");
  });

  it("does not mutate the template when no vars provided", () => {
    const r1 = t("widget.signup.otp.prompt", "en");
    const r2 = t("widget.signup.otp.prompt", "en");
    expect(r1).toBe(r2);
    expect(r1).toContain("{email}");
  });

  it("substitutes on locale with its own template (fr has {email} in template)", () => {
    const result = t("widget.signup.otp.prompt", "fr", { email: "test@example.com" });
    // French has its own template but also uses {email} placeholder
    expect(result).toContain("test@example.com");
    expect(result).not.toContain("{email}");
  });

  it("substitutes on empty-dict locale (it falls back to EN template)", () => {
    const result = t("widget.signup.otp.prompt", "it", { email: "test@example.com" });
    expect(result).toBe("Enter the 6-digit code we sent to test@example.com");
  });
});

describe("detectLocale()", () => {
  it("returns DEFAULT_LOCALE ('en') when no header provided", () => {
    expect(detectLocale()).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });

  it("detects 'fr' from Accept-Language: fr", () => {
    expect(detectLocale("fr")).toBe("fr");
  });

  it("detects 'de' from Accept-Language: de-DE,de;q=0.9", () => {
    expect(detectLocale("de-DE,de;q=0.9")).toBe("de");
  });

  it("detects 'es' from Accept-Language: es-MX,es;q=0.8", () => {
    expect(detectLocale("es-MX,es;q=0.8")).toBe("es");
  });

  it("detects 'ja' from Accept-Language: ja-JP", () => {
    expect(detectLocale("ja-JP")).toBe("ja");
  });

  it("detects 'zh' from Accept-Language: zh-CN", () => {
    expect(detectLocale("zh-CN")).toBe("zh");
  });

  it("falls back to 'en' for unsupported locale (e.g. 'ko')", () => {
    expect(detectLocale("ko-KR,ko;q=0.9")).toBe("en");
  });

  it("falls back to 'en' for gibberish Accept-Language", () => {
    expect(detectLocale("zz-ZZ")).toBe("en");
  });

  it("is case-insensitive for the language tag", () => {
    expect(detectLocale("FR")).toBe("fr");
    expect(detectLocale("DE-AT")).toBe("de");
  });

  it("picks the first language when multiple are listed", () => {
    expect(detectLocale("fr,en;q=0.9,de;q=0.8")).toBe("fr");
  });

  it("DEFAULT_LOCALE constant is 'en'", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });
});
