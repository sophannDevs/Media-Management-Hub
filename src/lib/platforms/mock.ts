import { PublishError, type PublishRequest } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared simulated publish used until real OAuth integrations exist.
 * Fails the same way the real APIs would for the common cases, so the
 * retry / error-handling flow can be exercised end to end.
 */
export async function simulatePublish(platform: string, req: PublishRequest, urlFor: (id: string) => string) {
  await sleep(600 + Math.random() * 600);

  if (req.account.status === "TOKEN_EXPIRED" || (req.account.tokenExpiresAt && req.account.tokenExpiresAt < new Date())) {
    throw new PublishError(
      platform === "facebook"
        ? "OAuthException (190): Error validating access token — the session has expired."
        : "401 Unauthorized: Request had invalid authentication credentials (token expired).",
      "AUTH",
      false,
    );
  }
  if (req.account.status !== "CONNECTED") {
    throw new PublishError(`Account "${req.account.name}" is not connected.`, "AUTH", false);
  }
  if (!req.video) {
    throw new PublishError("No final video attached to this content.", "VALIDATION", false);
  }

  const failureRate = Number(process.env.MOCK_PUBLISH_FAILURE_RATE ?? 0);
  if (failureRate > 0 && Math.random() < failureRate) {
    throw new PublishError(
      platform === "youtube"
        ? "quotaExceeded: The request cannot be completed because you have exceeded your quota."
        : "Temporary network error while uploading the video.",
      platform === "youtube" ? "QUOTA" : "NETWORK",
      true,
    );
  }

  const externalId = `${platform.slice(0, 2)}_${Math.random().toString(36).slice(2, 12)}`;
  return { externalId, url: urlFor(externalId) };
}
