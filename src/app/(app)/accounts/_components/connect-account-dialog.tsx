"use client";

import { Check, Info, Plug } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Field } from "@/components/app/create-content-dialog";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { connectAccountAction } from "@/server/actions/workspace";
import type { ConnectPlatform } from "@/server/queries/accounts";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ConnectAccountDialog({ platforms, platformId, trigger }: { platforms: ConnectPlatform[]; platformId?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const nameId = useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="lg">
            <Plug />
            Connect account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          // Start in the name field — the platform is usually preselected
          const input = document.getElementById(nameId);
          if (input) {
            e.preventDefault();
            input.focus();
          }
        }}
      >
        <ConnectForm platforms={platforms} initialPlatformId={platformId} nameId={nameId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConnectForm({ platforms, initialPlatformId, nameId, onDone }: { platforms: ConnectPlatform[]; initialPlatformId?: string; nameId: string; onDone: () => void }) {
  const enabled = platforms.filter((p) => p.enabled);
  const [platformId, setPlatformId] = useState(enabled.find((p) => p.id === initialPlatformId)?.id ?? enabled[0]?.id ?? "");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [followers, setFollowers] = useState("");
  const { run, pending } = useServerAction();

  const platform = enabled.find((p) => p.id === platformId);
  const noun = platform?.accountNoun ?? "account";
  const count = followers.trim() === "" ? undefined : Number.parseInt(followers, 10);

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!platform || !name.trim()) return;
    run(
      () =>
        connectAccountAction({
          platformId: platform.id,
          name: name.trim(),
          handle: handle.trim() || undefined,
          followers: count !== undefined && Number.isFinite(count) ? Math.max(0, count) : undefined,
        }),
      { success: `${platform.name} ${noun} connected`, onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader className="border-b border-[#f1eedf] p-6 pr-12 pb-4">
        <DialogTitle className="text-lg font-semibold">Connect an account</DialogTitle>
        <DialogDescription>Choose a platform, then add the channel or Page you publish to.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 p-6">
        <div role="group" aria-label="Platform" className="grid gap-2.5 sm:grid-cols-2">
          {platforms.map((p) => {
            const selected = p.id === platformId;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                disabled={!p.enabled}
                onClick={() => setPlatformId(p.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  p.enabled ? "hover:border-olive-300 hover:bg-[#fcfbf3]" : "cursor-not-allowed opacity-55",
                  selected && "border-primary bg-olive-50 hover:border-primary hover:bg-olive-50",
                )}
              >
                <PlatformIcon platform={p.id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.enabled ? `Add a ${p.accountNoun}` : "Coming soon"}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>

        {platform ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${capitalize(noun)} name`} required className="sm:col-span-2">
              <Input id={nameId} required aria-label={`${capitalize(noun)} name`} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={platform.id === "youtube" ? "e.g. AI Creator Lab" : "e.g. Smart Living Daily"} />
            </Field>
            <Field label="Handle" hint={platform.id === "youtube" ? "Your @handle" : "How the Page is shown, e.g. its category"}>
              <Input aria-label="Handle" maxLength={100} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={platform.id === "youtube" ? "@aicreatorlab" : "Page · Education website"} />
            </Field>
            <Field label={capitalize(platform.audienceNoun)}>
              <Input aria-label={capitalize(platform.audienceNoun)} type="number" min={0} step={1} inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="0" />
            </Field>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No platform is available to connect yet.</p>
        )}

        <p className="flex items-start gap-2 rounded-xl bg-secondary/70 p-3 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          OAuth sign-in will replace this form in the next phase — for now accounts are registered manually and publishing is simulated.
        </p>
      </div>

      <DialogFooter className="mx-0 mb-0 border-t border-[#f1eedf] bg-[#fcfbf3] px-6 py-4">
        <Button type="button" variant="outline" className="bg-white" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !platform || !name.trim()}>
          <Plug />
          {pending ? "Connecting…" : `Connect ${noun}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
