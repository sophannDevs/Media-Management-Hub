import { simulatePublish, simulateReconcile } from "./mock";
import { PublishError, type PlatformProvider, type PublishRequest } from "./types";
import { googleAuth, googleConfig, publishToYouTube, reconcileYouTube } from "./youtube-api";

// Real once GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set (PUB-07); simulated otherwise.
const real = () => googleConfig() !== null;
function requireToken(req: PublishRequest) {
  if (!req.account.accessToken || !req.account.externalId) throw new PublishError(`"${req.account.name}" has no Google sign-in: reconnect the channel with Google.`, "AUTH", false);
  return req.account.accessToken;
}

export const youtube: PlatformProvider = {
  id: "youtube",
  name: "YouTube",
  accountNoun: "Channel",
  captionLabel: "Description",
  visibilityOptions: [
    { value: "PUBLIC", label: "Public", description: "Everyone can watch" },
    { value: "UNLISTED", label: "Unlisted", description: "Anyone with the link" },
    { value: "PRIVATE", label: "Private", description: "Only you" },
  ],
  defaultVisibility: "PUBLIC",
  maxTitleLength: 100,
  maxCaptionLength: 5000,
  supportsThumbnail: true,
  get isMock() {
    return !real();
  },
  auth: googleAuth,
  publish: (req, ctx) => (real() ? publishToYouTube(req, ctx, requireToken(req)) : simulatePublish("youtube", req, ctx, (id) => `https://youtu.be/${id}`)),
  reconcile: (req, uploadState) => (real() ? reconcileYouTube(uploadState, requireToken(req)) : simulateReconcile(req)),
};
