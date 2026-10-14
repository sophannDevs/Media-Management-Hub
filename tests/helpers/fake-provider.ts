import type { PlatformProvider, PublishContext, PublishRequest, PublishResult, ReconcileResult } from "@/lib/platforms/types";

type Behavior = (req: PublishRequest, ctx: PublishContext) => Promise<PublishResult>;
type Reconciler = (req: PublishRequest, uploadState: Record<string, unknown> | null) => Promise<ReconcileResult>;

/**
 * A scriptable stand-in for the YouTube / Facebook providers. Tests replace
 * the registry with `fakeRegistry` (vi.mock) and then inspect `fake.calls`:
 * every entry is one upload that would have reached the platform.
 */
class FakePlatform {
  calls: PublishRequest[] = [];
  reconcileCalls: PublishRequest[] = [];
  private behavior: Behavior = async () => this.success();
  /** null: the provider can't reconcile (no `reconcile` method). */
  private reconciler: Reconciler | null = async () => ({ status: "not_found" });

  success(): PublishResult {
    const n = this.calls.length;
    return { externalId: `fake_${n}`, url: `https://platform.test/watch/${n}` };
  }

  /** Next publishes run this instead of succeeding immediately. */
  setBehavior(fn: Behavior) {
    this.behavior = fn;
  }

  setReconcile(fn: Reconciler | null) {
    this.reconciler = fn;
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
    this.reconcileCalls = [];
    this.behavior = async () => this.success();
    this.reconciler = async () => ({ status: "not_found" });
  }

  provider(id: string): PlatformProvider {
    const reconciler = this.reconciler;
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
      publish: (req, ctx) => {
        this.calls.push(req);
        return this.behavior(req, ctx);
      },
      ...(reconciler
        ? {
            reconcile: (req: PublishRequest, state: Record<string, unknown> | null) => {
              this.reconcileCalls.push(req);
              return reconciler(req, state);
            },
          }
        : {}),
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
