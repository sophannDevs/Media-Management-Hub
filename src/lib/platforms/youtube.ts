import { simulatePublish } from "./mock";
import type { PlatformProvider } from "./types";

// TODO(phase 2): replace simulatePublish with the YouTube Data API v3
// (videos.insert resumable upload + thumbnails.set) using the account's OAuth token.
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
  isMock: true,
  publish: (req) => simulatePublish("youtube", req, (id) => `https://youtu.be/${id}`),
};
