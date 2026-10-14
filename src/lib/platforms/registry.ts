import { facebook } from "./facebook";
import type { PlatformProvider } from "./types";
import { youtube } from "./youtube";

const providers: Record<string, PlatformProvider> = {
  [youtube.id]: youtube,
  [facebook.id]: facebook,
};

export function getProvider(platformId: string): PlatformProvider | undefined {
  return providers[platformId];
}

export function listProviders() {
  return Object.values(providers);
}

/** True while any platform is simulated: nothing it "publishes" reaches the real platform. */
export function isSimulationMode() {
  return listProviders().some((p) => p.isMock);
}

/** Serializable subset for Client Components (no functions). */
export function providerMeta(platformId: string) {
  const p = getProvider(platformId);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    accountNoun: p.accountNoun,
    captionLabel: p.captionLabel,
    visibilityOptions: p.visibilityOptions,
    defaultVisibility: p.defaultVisibility,
    maxTitleLength: p.maxTitleLength,
    maxCaptionLength: p.maxCaptionLength,
    supportsThumbnail: p.supportsThumbnail,
    isMock: p.isMock,
  };
}
export type ProviderMeta = NonNullable<ReturnType<typeof providerMeta>>;
