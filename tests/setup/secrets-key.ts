import { generateKeySpec, TOKEN_KEYS_ENV } from "@/lib/secrets";

// Stored OAuth tokens are encrypted (SEC-04). Each test run gets its own key,
// so the tests never need the developer's .env and a leaked test database
// holds nothing readable.
process.env[TOKEN_KEYS_ENV] ??= generateKeySpec("test");
