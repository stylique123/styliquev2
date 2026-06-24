import { afterEach, describe, expect, it } from "vitest";
import { missingRequiredEnvVars } from "./startup-validation.server";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function setBaseEnv(scopes: string) {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = "postgres://stylique:stylique@localhost:5432/stylique";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.SHOPIFY_API_KEY = "test-key";
  process.env.SHOPIFY_API_SECRET = "test-secret";
  process.env.SHOPIFY_APP_URL = "https://example.ngrok-free.app";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.SHOPIFY_SCOPES = scopes;
}

describe("startup Shopify scope validation", () => {
  afterEach(resetEnv);

  it("fails when ScriptTag injection scope is missing", () => {
    setBaseEnv("read_products,read_inventory,read_orders");

    expect(missingRequiredEnvVars().join("\n")).toContain("write_script_tags");
  });

  it("passes the required Shopify scope contract", () => {
    setBaseEnv("read_products,read_inventory,read_orders,write_script_tags");

    expect(missingRequiredEnvVars()).toEqual([]);
  });
});
