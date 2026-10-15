"use client";

import { formatInTimeZone } from "date-fns-tz";
import { CalendarCheck, CircleX, Globe, Link2, Lock, Pencil, Plus, Repeat2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ContentPicker } from "@/components/app/content-picker";
import { ContentThumb } from "@/components/app/content-thumb";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { TIMEZONES } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AccountStatus } from "@/lib/workflow/statuses";
import type { ScheduleFormData } from "@/server/queries/schedule-form";
import { createScheduleAction, updateScheduleAction } from "@/server/actions/schedule";

type OpenOptions = { contentId?: string | null; scheduleId?: string | null; platformId?: string; date?: string; time?: string };

const Ctx = createContext<{ openSchedule: (o?: OpenOptions) => void } | null>(null);

export function useScheduleDialog() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScheduleDialog must be used inside <ScheduleDialogProvider>");
  return ctx;
}

/** Mount once in the app layout; open from anywhere with `useScheduleDialog().openSchedule(...)`. */
export function ScheduleDialogProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OpenOptions | null>(null);
  const [key, setKey] = useState(0);
  // Typed text in the open form (UX-03): closing it asks first instead of silently throwing it away
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const openSchedule = useCallback((o: OpenOptions = {}) => {
    setOpts(o);
    setKey((k) => k + 1);
    setDirty(false);
  }, []);
  const value = useMemo(() => ({ openSchedule }), [openSchedule]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && (dirty ? setConfirmClose(true) : setOpts(null))}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {opts && <ScheduleForm key={key} opts={opts} onDone={() => setOpts(null)} onDirtyChange={setDirty} onSwitchContent={(contentId) => openSchedule({ ...opts, contentId, scheduleId: null })} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard your changes?"
        description="You've changed this post's details. If you close the form now, those changes are lost."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setConfirmClose(false);
          setOpts(null);
        }}
      />
    </Ctx.Provider>
  );
}

/** Button that opens the dialog for a content item. */
export function ScheduleButton({
  contentId,
  scheduleId,
  platformId,
  date,
  time,
  children,
  ...rest
}: OpenOptions & { children: ReactNode } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const { openSchedule } = useScheduleDialog();
  return (
    <Button
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        openSchedule({ contentId, scheduleId, platformId, date, time });
      }}
    >
      {children}
    </Button>
  );
}

const VIS_ICONS: Record<string, typeof Globe> = { PUBLIC: Globe, UNLISTED: Link2, PRIVATE: Lock };

/** Per-submission token: a resubmitted form (retry after a timeout, double click) can't create a second post. */
const newToken = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

type Notice = { code: "ALREADY_SCHEDULED" | "ALREADY_PUBLISHED"; message: string; scheduleId?: string };

function ScheduleForm({ opts, onDone, onDirtyChange, onSwitchContent }: { opts: OpenOptions; onDone: () => void; onDirtyChange: (dirty: boolean) => void; onSwitchContent: (id: string) => void }) {
  const router = useRouter();
  const [data, setData] = useState<ScheduleFormData | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const query = new URLSearchParams();
    if (opts.contentId) query.set("contentId", opts.contentId);
    if (opts.scheduleId) query.set("scheduleId", opts.scheduleId);
    // A GET read, not a Server Action (ARCH-03)
    fetch(`/api/schedule/form?${query}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.status === 401) {
          // The session ended: sign in and come back
          router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ScheduleFormData>;
      })
      .then((d) => d && setData(d))
      .catch((e) => e?.name !== "AbortError" && setLoadError(true));
    return () => ctrl.abort();
  }, [opts.contentId, opts.scheduleId, router]);

  if (loadError) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the scheduling form. Close and try again.</div>;
  }
  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <DialogTitle className="sr-only">Schedule post</DialogTitle>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  return <ScheduleFields data={data} opts={opts} onDone={onDone} onDirtyChange={onDirtyChange} onSwitchContent={onSwitchContent} />;
}

function ScheduleFields({ data, opts, onDone, onDirtyChange, onSwitchContent }: { data: ScheduleFormData; opts: OpenOptions; onDone: () => void; onDirtyChange: (dirty: boolean) => void; onSwitchContent: (id: string) => void }) {
  const editing = data.schedule;
  const content = data.content;
  const enabled = data.platforms.filter((p) => p.enabled && p.meta);
  const initialPlatform = editing?.platformId ?? opts.platformId ?? content?.platforms.find((p) => enabled.some((e) => e.id === p)) ?? enabled[0]?.id ?? "";

  const tomorrow = formatInTimeZone(new Date(new Date(data.nowIso).getTime() + 86_400_000), data.timezone, "yyyy-MM-dd");
  const [platformId, setPlatformId] = useState(initialPlatform);
  const accountsFor = (p: string) => data.accounts.filter((a) => a.platformId === p);
  const defaultAccount = (p: string) => (accountsFor(p).find((a) => a.isDefault && a.status === "CONNECTED") ?? accountsFor(p).find((a) => a.status === "CONNECTED") ?? accountsFor(p)[0])?.id ?? "";
  const [accountId, setAccountId] = useState(editing?.accountId ?? defaultAccount(initialPlatform));
  const [date, setDate] = useState(editing?.date ?? opts.date ?? tomorrow);
  const [time, setTime] = useState(editing?.time ?? opts.time ?? "18:00");
  const [timezone, setTimezone] = useState(editing?.timezone ?? data.timezone);
  const [title, setTitle] = useState(editing?.title ?? content?.title ?? "");
  const [caption, setCaption] = useState(editing?.caption ?? content?.description ?? "");
  const [hashtags, setHashtags] = useState(editing?.hashtags ?? content?.hashtags ?? "");
  const [thumbnailAssetId, setThumbnailAssetId] = useState<string | null>(editing?.thumbnailAssetId ?? content?.defaultThumbnailId ?? content?.thumbnails[0]?.id ?? null);
  const meta = data.platforms.find((p) => p.id === platformId)?.meta ?? null;
  const [visibility, setVisibility] = useState(editing?.visibility ?? meta?.defaultVisibility ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [overrideOn, setOverrideOn] = useState(!!editing?.override);
  const [reason, setReason] = useState(editing?.override?.reason ?? "");
  // What the person typed or picked as a time, against what the form opened with. The platform, account and
  // visibility are left out: "add another platform" resets them without anyone having edited anything.
  const typed = JSON.stringify([date, time, timezone, title, caption, hashtags, reason]);
  const [opened, setOpened] = useState(typed);
  const dirty = typed !== opened;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const hardMissing = content?.missing.some((m) => m.hard) ?? false;
  const [token, setToken] = useState(newToken);
  const { run, pending } = useServerAction();
  const { openSchedule } = useScheduleDialog();

  function changePlatform(p: string) {
    setPlatformId(p);
    setAccountId(defaultAccount(p));
    setVisibility(data.platforms.find((x) => x.id === p)?.meta?.defaultVisibility ?? "");
    setErrors([]);
    setNotice(null);
  }

  function submit(addAnother: boolean, repost = false) {
    if (!content) return;
    setErrors([]);
    setNotice(null);
    const override = !content.ready && overrideOn ? { reason } : null;
    const values = { contentId: content.id, platformId, accountId, date, time, timezone, title, caption, hashtags, thumbnailAssetId, visibility, idempotencyKey: token, repost, override };
    run<unknown>(() => (editing ? updateScheduleAction(editing.id, values) : createScheduleAction(values)), {
      onSuccess: () => {
        // The next "add another platform" is a different post
        setToken(newToken());
        if (!addAnother) return onDone();
        // What was typed is saved now: closing the form next loses nothing
        setOpened(typed);
        const next = enabled.find((p) => p.id !== platformId && content.platforms.includes(p.id)) ?? enabled.find((p) => p.id !== platformId);
        if (next) changePlatform(next.id);
      },
      onError: (error, details, failure) => {
        if (failure?.code === "ALREADY_SCHEDULED" || failure?.code === "ALREADY_PUBLISHED") {
          setNotice({ code: failure.code, message: error, scheduleId: failure.info?.scheduleId });
          return true;
        }
        setErrors(details ?? []);
      },
    });
  }

  const account = data.accounts.find((a) => a.id === accountId);
  const accountNoun = meta?.accountNoun ?? "Account";

  return (
    <>
      <DialogHeader className="border-b border-[#f1eedf] p-6 pb-4">
        <DialogTitle className="text-lg">{editing ? "Edit scheduled post" : "Schedule post"}</DialogTitle>
        <DialogDescription>Each platform gets its own schedule, so one video can go out at different times.</DialogDescription>
      </DialogHeader>

      <div className="thin-scroll max-h-[64vh] space-y-6 overflow-y-auto p-6">
        <div className="flex items-center gap-4 rounded-xl border border-[#f1eedf] bg-[#fcfbf3] p-3">
          <ContentThumb src={content?.thumbnails.find((t) => t.id === thumbnailAssetId)?.url ?? content?.thumbnails[0]?.url} seed={content?.id ?? "none"} durationSec={content?.durationSec} className="h-14 w-24" />
          <div className="min-w-0 flex-1">
            <Label className="mb-1">Content</Label>
            {editing ? (
              <p className="truncate text-sm font-medium">{content?.title}</p>
            ) : (
              <ContentPicker value={content ? { id: content.id, title: content.title } : null} onChange={(o) => onSwitchContent(o.id)} />
            )}
          </div>
        </div>

        {!content ? (
          <p className="text-sm text-muted-foreground">Create content and mark it Ready to Post first.</p>
        ) : (
          <>
            {!content.ready && (
              <ReadinessNotice missing={content.missing} overrideOn={overrideOn} onOverrideChange={setOverrideOn} reason={reason} onReasonChange={setReason} />
            )}

            <div>
              <Label id="sch-platform-label" className="mb-2">Platform</Label>
              <div role="group" aria-labelledby="sch-platform-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.platforms.slice(0, 4).map((p) => {
                  const on = p.id === platformId;
                  const usable = p.enabled && !!p.meta;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!usable}
                      onClick={() => changePlatform(p.id)}
                      className={cn(
                        "flex h-11 items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition-colors",
                        on ? "border-primary bg-olive-50" : "border-input hover:border-olive-300",
                        !usable && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <PlatformIcon platform={p.id} size={18} />
                      <span className="truncate">{p.name}</span>
                      {!usable && <span className="ml-auto text-xs font-semibold uppercase text-muted-foreground">Soon</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="mb-1.5" htmlFor="sch-account">{meta?.id === "facebook" ? "Facebook Page" : `${meta?.name ?? ""} ${accountNoun}`}</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="sch-account" className="w-full">
                    <SelectValue placeholder={`Choose a ${accountNoun.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {accountsFor(platformId).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        <span className={cn("text-xs", a.status === "CONNECTED" ? "text-olive-700" : "text-orange-700")}> · {AccountStatus.label(a.status)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {accountsFor(platformId).length === 0 && <p className="mt-1 text-xs text-muted-foreground">No {accountNoun.toLowerCase()} connected — add one in Social Accounts.</p>}
                {account && account.status !== "CONNECTED" && <p className="mt-1 text-xs text-orange-700">This {accountNoun.toLowerCase()} must be reconnected before it can publish.</p>}
              </div>
              <div>
                <Label className="mb-1.5" htmlFor="sch-date">Date</Label>
                <Input id="sch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5" htmlFor="sch-time">Time</Label>
                <Input id="sch-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5" htmlFor="sch-timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="sch-timezone" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5" htmlFor="sch-title">Title</Label>
                <Input id="sch-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                <p className={cn("mt-1 text-xs", meta && title.length > meta.maxTitleLength ? "text-rose-700" : "text-muted-foreground")}>
                  {title.length}/{meta?.maxTitleLength ?? 100} characters
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5" htmlFor="sch-caption">{meta?.captionLabel ?? "Description"}</Label>
                <Textarea id="sch-caption" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5" htmlFor="sch-tags">Hashtags</Label>
                <Input id="sch-tags" value={hashtags} placeholder="#ai #tools" onChange={(e) => setHashtags(e.target.value)} />
              </div>
            </div>

            {meta?.supportsThumbnail && (
              <div>
                <Label id="sch-thumb-label" className="mb-2">Thumbnail</Label>
                {content.thumbnails.length ? (
                  <div role="group" aria-labelledby="sch-thumb-label" className="flex flex-wrap gap-2.5">
                    {content.thumbnails.map((t) => (
                      <button key={t.id} type="button" title={t.fileName} aria-label={t.fileName} aria-pressed={thumbnailAssetId === t.id} onClick={() => setThumbnailAssetId(t.id)} className={cn("rounded-lg ring-offset-2", thumbnailAssetId === t.id && "ring-2 ring-primary")}>
                        <ContentThumb src={t.url} seed={t.id} icon="image" className="h-14 w-24" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No thumbnail yet — the platform will pick a frame. Upload one in the Video tab.</p>
                )}
              </div>
            )}

            {meta && (
              <div>
                <Label id="sch-visibility-label" className="mb-2">{meta.id === "youtube" ? "Visibility" : "Publish as"}</Label>
                <div role="group" aria-labelledby="sch-visibility-label" className="inline-flex flex-wrap gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
                  {meta.visibilityOptions.map((v) => {
                    const Icon = VIS_ICONS[v.value];
                    return (
                      <button key={v.value} type="button" title={v.description} aria-pressed={visibility === v.value} onClick={() => setVisibility(v.value)} className={cn("flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium", visibility === v.value ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        {Icon && <Icon className="size-3.5" />}
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* The live region is always mounted, so changes inside it are announced */}
            <div aria-live="polite">
              {errors.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <p className="flex items-center gap-2 font-medium"><CircleX className="size-4" />Can&apos;t schedule yet</p>
                  <ul className="mt-2 ml-6 list-disc space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
            </div>

            {notice && (
              <div role="status" className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="size-4" />
                  {notice.code === "ALREADY_SCHEDULED" ? "Already scheduled" : "Already published to this account"}
                </p>
                <p className="mt-1">{notice.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {notice.code === "ALREADY_SCHEDULED" && notice.scheduleId && (
                    <Button size="sm" variant="outline" className="bg-white" onClick={() => openSchedule({ scheduleId: notice.scheduleId })}>
                      <Pencil />Open that post
                    </Button>
                  )}
                  {notice.code === "ALREADY_PUBLISHED" && (
                    <Button size="sm" disabled={pending} onClick={() => submit(false, true)}>
                      <Repeat2 />Post again
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DialogFooter className="mx-0 mb-0 flex-col-reverse gap-2 rounded-b-xl border-t border-[#f1eedf] bg-[#fcfbf3] px-6 py-4 sm:flex-row sm:items-center">
        {!editing && content && (
          <Button variant="ghost" className="sm:mr-auto" disabled={pending || hardMissing} onClick={() => submit(true)}>
            <Plus />Save & add another platform
          </Button>
        )}
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button disabled={pending || !content || hardMissing} onClick={() => submit(false)}>
          <CalendarCheck />
          {pending ? "Saving…" : editing ? "Save changes" : "Schedule post"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Why the content isn't Ready to Post. Missing soft requirements can be waived
 * for this post with a reason (logged); hard ones can't (WF-01).
 */
function ReadinessNotice({
  missing,
  overrideOn,
  onOverrideChange,
  reason,
  onReasonChange,
}: {
  missing: { label: string; hard: boolean }[];
  overrideOn: boolean;
  onOverrideChange: (on: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
}) {
  const hard = missing.filter((m) => m.hard);
  const soft = missing.filter((m) => !m.hard);
  return (
    <div className={cn("rounded-xl border p-4 text-sm", hard.length ? "border-rose-200 bg-rose-50 text-rose-900" : "border-orange-200 bg-orange-50 text-orange-950")}>
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" />
        {hard.length ? "This content can't be scheduled yet" : "This content isn't ready to post yet"}
      </p>
      <ul className="mt-2 ml-6 list-disc space-y-0.5">
        {hard.map((m) => (
          <li key={m.label}>
            {m.label} <span className="font-medium">(required, can&apos;t be overridden)</span>
          </li>
        ))}
        {soft.map((m) => (
          <li key={m.label}>{m.label}</li>
        ))}
      </ul>
      {!hard.length && (
        <div className="mt-3 space-y-2 border-t border-orange-200 pt-3">
          <div className="flex items-start gap-2.5">
            <Checkbox id="sch-override" className="mt-0.5 bg-white" checked={overrideOn} onCheckedChange={(v) => onOverrideChange(v === true)} />
            <Label htmlFor="sch-override" className="leading-snug font-normal">
              Schedule anyway: waive these checks for this post only. The reason is saved in the activity log.
            </Label>
          </div>
          {overrideOn && (
            <div>
              <Label htmlFor="sch-override-reason" className="mb-1.5">Reason</Label>
              <Textarea
                id="sch-override-reason"
                rows={2}
                maxLength={500}
                required
                className="bg-white"
                value={reason}
                placeholder="e.g. Review done by phone with the client; approval to follow"
                onChange={(e) => onReasonChange(e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
