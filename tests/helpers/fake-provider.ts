import type { PlatformProvider, PublishRequest, PublishResult } from "@/lib/platforms/types";

type Behavior = (req: PublishRequest) => Promise<PublishResult>;

/**
 * A scriptable stand-in for the YouTube / Facebook providers. Tests replace
 * the registry with `fakeRegistry` (vi.mock) and then inspect `fake.calls`:
 * every entry is one upload that would have reached the platform.
 */
class FakePlatform {
  calls: PublishRequest[] = [];
  private behavior: Behavior = async () => this.success();

  success(): PublishResult {
    const n = this.calls.length;
    return { externalId: `fake_${n}`, url: `https://platform.test/watch/${n}` };
  }

  /** Next publishes run this instead of succeeding immediately. */
  setBehavior(fn: Behavior) {
    this.behavior = fn;
  }

  /** Makes publishes hang until `release()` is called (simulates a long upload). */
  block() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.setBehavior(async () => {
      await gate;
      return this.success();
    });
    return () => release();
  }

  reset() {
    this.calls = [];
    this.behavior = async () => this.success();
  }

  provider(id: string): PlatformProvider {
    return {
      id,
      name: id === "youtube" ? "YouTube" : "Facebook",
      accountNoun: id === "youtube" ? "Channel" : "Page",
      captionLabel: id === "youtube" ? "Description" : "Caption",
      visibilityOptions: [{ value: "PUBLIC", label: "Public" }],
      defaultVisibility: "PUBLIC",
      maxTitleLength: 100,
      maxCaptionLength: 5000,
      supportsThumbnail: true,
      isMock: true,
      publish: (req) => {
        this.calls.push(req);
        return this.behavior(req);
      },
    };
  }
}

export const fake = new FakePlatform();

const ids = ["youtube", "facebook"];

/** Drop-in replacement for "@/lib/platforms/registry". */
export const fakeRegistry = {
  getProvider: (id: string) => (ids.includes(id) ? fake.provider(id) : undefined),
  listProviders: () => ids.map((id) => fake.provider(id)),
  providerMeta: (id: string) => {
    if (!ids.includes(id)) return null;
    const p = fake.provider(id);
    return { id: p.id, name: p.name, visibilityOptions: p.visibilityOptions, defaultVisibility: p.defaultVisibility, isMock: p.isMock };
  },
};
