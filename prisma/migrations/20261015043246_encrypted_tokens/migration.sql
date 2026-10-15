-- SEC-04: tokens are stored as ciphertext from now on ("enc:v1:<key id>:…", src/lib/secrets.ts).
-- Every value stored before this was a simulated token ("mock…"), never a real credential:
-- cleared rather than kept as plain text. Reconnecting an account stores an encrypted one.
UPDATE "SocialAccount" SET "accessToken" = NULL WHERE "accessToken" IS NOT NULL AND "accessToken" NOT LIKE 'enc:v1:%';
UPDATE "SocialAccount" SET "refreshToken" = NULL WHERE "refreshToken" IS NOT NULL AND "refreshToken" NOT LIKE 'enc:v1:%';
