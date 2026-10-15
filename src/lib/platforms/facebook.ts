import { facebookAuth, metaConfig, publishToFacebook, reconcileFacebook } from "./facebook-api";
import { simulatePublish, simulateReconcile } from "./mock";
import { PublishError, type PlatformProvider, type PublishRequest } from "./types";

// Real once META_APP_ID / META_APP_SECRET are set (PUB-07); simulated otherwise.
const real = () => metaConfig() !== null;
function requireTokens(req: PublishRequest) {
  if (!req.account.accessToken || !req.account.externalId) throw new PublishError(`"${req.account.name}" has no Facebook sign-in: reconnect the Page with Facebook.`, "AUTH", false);
  return { pageToken: req.account.accessToken, userToken: req.account.refreshToken };
}

export const facebook: PlatformProvider = {
  id: "facebook",
  name: "Facebook",
  accountNoun: "Page",
  captionLabel: "Caption",
  visibilityOptions: [
    { value: "PUBLISH", label: "Publish at scheduled time" },
    { value: "DRAFT", label: "Save as Page draft" },
  ],
  defaultVisibility: "PUBLISH",
  maxTitleLength: 255,
  maxCaptionLength: 63206,
  supportsThumbnail: true,
  get isMock() {
    return !real();
  },
  auth: facebookAuth,
  publish: (req, ctx) => (real() ? publishToFacebook(req, ctx, requireTokens(req)) : simulatePublish("facebook", req, ctx, (id) => `https://facebook.com/watch/?v=${id}`)),
  reconcile: (req, uploadState) => (real() ? reconcileFacebook(uploadState, req.account.externalId, requireTokens(req)) : simulateReconcile(req)),
};
