// Re-encrypts every stored OAuth token with the current key (SEC-04).
//   npm run secrets:rotate
// Steps: add the new "id:key" entry FIRST in TOKEN_ENCRYPTION_KEYS (keep the
// old one), run this, check that nothing was unreadable, then drop the old
// entry. Tokens the key ring can't read are left as they are.
import { db } from "../src/lib/db";
import { rotateAllAccountTokens } from "../src/server/services/tokens";

const result = await rotateAllAccountTokens();
console.log(`Accounts with tokens: ${result.total}. Re-encrypted: ${result.rotated}. Already current: ${result.unchanged}. Unreadable (left alone): ${result.unreadable}.`);
await db.$disconnect();
if (result.unreadable > 0) {
  console.error("Some tokens could not be read with the configured keys. Keep the old key in TOKEN_ENCRYPTION_KEYS until they are.");
  process.exit(1);
}
