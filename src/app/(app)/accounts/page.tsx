import { KeyRound, Plug, Plus, ShieldCheck, Star, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { PageHeader } from "@/components/app/content-bits";
import { PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AccountStatus } from "@/lib/workflow/statuses";
import { type AccountCardData, getAccountsData, getConnectPlatforms } from "@/server/queries/accounts";
import { AccountMenu, ReconnectButton } from "./_components/account-actions";
import { ConnectAccountDialog } from "./_components/connect-account-dialog";

export const metadata: Metadata = { title: "Social Accounts" };

export default function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-6">
      <Suspense>
        <ConnectOutcome searchParams={searchParams} />
      </Suspense>
      <PageHeader
        title="Social Accounts"
        description="Channels and Pages you can publish to. A post can only be scheduled on a connected account."
        actions={
          <Suspense fallback={<ConnectButtonFallback />}>
            <ConnectButton />
          </Suspense>
        }
      />
      <div className="space-y-8">
        <Suspense fallback={<AccountsSkeleton />}>
          <Accounts />
        </Suspense>
      </div>
      <HowConnectionsWork />
    </div>
  );
}

/** What the platform sign-in came back with (PUB-07): /accounts?connected=N or ?error=… */
async function ConnectOutcome({ searchParams }: { searchParams: PageProps<"/accounts">["searchParams"] }) {
  const sp = await searchParams;
  const connected = Number(sp.connected);
  const error = typeof sp.error === "string" ? sp.error : null;
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>Could not connect: {error}</span>
      </p>
    );
  }
  if (connected > 0) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl border border-olive-200 bg-olive-50 p-3 text-sm text-olive-900">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          Connected {connected} {connected === 1 ? "account" : "accounts"}. Their sign-in is stored encrypted; posts scheduled on them go to the real platform.
        </span>
      </p>
    );
  }
  return null;
}

async function ConnectButton() {
  return <ConnectAccountDialog platforms={await getConnectPlatforms()} />;
}

function ConnectButtonFallback() {
  return (
    <Button size="lg" disabled>
      <Plug />
      Connect account
    </Button>
  );
}

async function Accounts() {
  const d = await getAccountsData();
  return (
    <>
      {d.sections.map((s) => (
        <section key={s.id} aria-labelledby={`platform-${s.id}`}>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PlatformIcon platform={s.id} size={22} />
            <h2 id={`platform-${s.id}`} className="font-semibold">
              {s.name}
            </h2>
            {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {s.accounts.map((a) => (
              <AccountCard key={a.id} a={a} />
            ))}
            {s.enabled && <ConnectAccountDialog platforms={d.platforms} platformId={s.id} trigger={<AddAccountCard noun={s.accountNoun} platform={s.name} />} />}
          </div>
        </section>
      ))}

      {d.comingSoon.length > 0 && (
        <section aria-labelledby="platforms-coming-soon">
          <h2 id="platforms-coming-soon" className="mb-3 font-semibold">
            Coming soon
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.comingSoon.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-dashed bg-card p-4 shadow-card">
                <PlatformIcon platform={p.id} size={26} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <StatusBadge label="Coming soon" tone="neutral" size="sm" className="mt-1" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const AVATAR_TONES: Record<string, string> = {
  youtube: "bg-rose-50 text-rose-800",
  facebook: "bg-sky-50 text-sky-800",
};

function AccountCard({ a }: { a: AccountCardData }) {
  return (
    <article className={cn("min-w-0 rounded-2xl border bg-card p-5 shadow-card", !a.connected && "border-orange-200")}>
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <span className={cn("flex size-12 items-center justify-center rounded-full text-sm font-semibold", AVATAR_TONES[a.platformId] ?? "bg-olive-100 text-olive-800")}>
            {a.initials}
          </span>
          <span className="absolute -right-1 -bottom-1 rounded-full bg-white p-0.5">
            <PlatformIcon platform={a.platformId} size={16} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{a.name}</h3>
            <StatusBadge def={AccountStatus} value={a.status} />
            {a.isDefault && (
              <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-olive-200 bg-olive-50 px-2 text-xs font-medium text-olive-700">
                <Star className="size-3 fill-current" />
                Default
              </span>
            )}
          </div>
          {a.handle && <p className="truncate text-sm text-muted-foreground">{a.handle}</p>}
        </div>
        <AccountMenu account={a} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 text-sm sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Audience">{a.audience}</Stat>
        <Stat label="Scheduled posts">{a.scheduled ? `${a.scheduled} post${a.scheduled === 1 ? "" : "s"}` : "None"}</Stat>
        <Stat label="Last sync" title={a.lastSyncAt ?? undefined}>
          {a.lastSync}
        </Stat>
        <Stat label="Token expires">
          {a.tokenExpires}
          {a.tokenNote && (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-orange-700">
              <TriangleAlert className="size-3 shrink-0" />
              {a.tokenNote}
            </span>
          )}
        </Stat>
      </dl>

      {!a.connected && <ReconnectCallout a={a} />}
    </article>
  );
}

function Stat({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium" title={title}>
        {children}
      </dd>
    </div>
  );
}

function ReconnectCallout({ a }: { a: AccountCardData }) {
  const headline =
    a.status === "TOKEN_EXPIRED"
      ? `Access expired — publishing to this ${a.accountNoun} is paused.`
      : a.status === "ERROR"
        ? `Connection error — publishing to this ${a.accountNoun} is paused.`
        : `Disconnected — nothing can be published to this ${a.accountNoun} until you reconnect.`;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 sm:flex-row sm:items-center">
      <KeyRound className="hidden size-4 shrink-0 sm:block" />
      <div className="min-w-0 flex-1">
        <p>{headline}</p>
        {a.lastError && <p className="mt-0.5 text-xs text-orange-800">Last error: {a.lastError}</p>}
        {a.scheduled > 0 && (
          <p className="mt-0.5 text-xs text-orange-800">
            {a.scheduled} scheduled post{a.scheduled === 1 ? "" : "s"} will fail until you reconnect.
          </p>
        )}
      </div>
      <ReconnectButton accountId={a.id} name={a.name} href={a.oauth ? `/api/oauth/${a.platformId}/start` : undefined} />
    </div>
  );
}

function AddAccountCard({ noun, platform }: { noun: string; platform: string }) {
  return (
    <button
      type="button"
      className="flex min-h-[180px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-stone-300 p-5 text-muted-foreground transition-colors outline-none hover:border-olive-300 hover:bg-white/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Plus className="size-5" />
      <span className="text-sm font-medium">Add {noun}</span>
      <span className="text-xs">
        Connect a {platform} {noun} to publish to
      </span>
    </button>
  );
}

function HowConnectionsWork() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-card md:flex-row">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-olive-50 text-primary">
        <ShieldCheck className="size-5" />
      </span>
      <div className="text-sm">
        <h2 className="font-medium">How connections work</h2>
        <p className="mt-1 text-stone-600">
          Each platform is a separate provider module (sign-in, token refresh, upload, analytics). Access tokens are stored server-side and refreshed
          automatically, and you&apos;re notified before a token expires. New platforms plug in without changing your content.
        </p>
      </div>
    </section>
  );
}

function AccountsSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-6 w-full max-w-md" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[196px] rounded-2xl" />
            <Skeleton className="h-[196px] rounded-2xl" />
          </div>
        </div>
      ))}
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-2xl" />
          ))}
        </div>
      </div>
    </>
  );
}
