import { simulatePublish, simulateReconcile } from "./mock";
import type { PlatformProvider } from "./types";

// TODO(phase 3): replace simulatePublish with the Graph API
// (POST /{page-id}/videos with a Page access token).
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
  isMock: true,
  publish: (req, ctx) => simulatePublish("facebook", req, ctx, (id) => `https://facebook.com/watch/?v=${id}`),
  reconcile: (req) => simulateReconcile(req),
};
