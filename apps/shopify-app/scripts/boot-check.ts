/* Reproduces the server.ts boot preamble against the real env to surface the
 * exact crash that fails the Railway deploy. Run:
 *   railway run --service stylique-app -- npx tsx apps/shopify-app/scripts/boot-check.ts
 */
import { validateRequiredEnvVars } from "../app/lib/startup-validation.server";
import { assertRequiredDatabaseShape } from "../app/lib/database-shape.server";

console.log("NODE_ENV =", process.env.NODE_ENV, " PORT =", process.env.PORT ?? "(unset)");
try {
  validateRequiredEnvVars();
  console.log("✓ validateRequiredEnvVars OK");
} catch (e: any) {
  console.error("✗ validateRequiredEnvVars THREW:\n" + (e?.message ?? e));
  process.exit(2);
}
try {
  await assertRequiredDatabaseShape();
  console.log("✓ assertRequiredDatabaseShape OK");
} catch (e: any) {
  console.error("✗ assertRequiredDatabaseShape THREW:\n" + (e?.message ?? e));
  process.exit(3);
}
console.log("✓✓ BOOT PREAMBLE OK — guards are not the deploy blocker");
process.exit(0);
