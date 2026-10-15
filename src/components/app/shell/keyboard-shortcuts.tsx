"use client";

import { Keyboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { browserStore } from "@/lib/drafts";
import { CHORD_TIMEOUT_MS, CREATE_CONTENT_EVENT, GO_TO, interpretKey, isTypingTarget, OVERLAY_SELECTOR, SHORTCUTS_OFF_KEY } from "@/lib/shortcuts";

const CHANGED = "mediaflow:shortcuts-changed";
const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener("storage", cb);
  };
};
const isOff = () => browserStore()?.getItem(SHORTCUTS_OFF_KEY) === "1";

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-xs text-stone-700 shadow-[0_1px_0_rgb(0_0_0/0.08)]">{children}</kbd>;
}

function Row({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-sm">{label}</dt>
      <dd className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{keys}</dd>
    </div>
  );
}

/**
 * Keyboard shortcuts (UX-06): `/` search, `c` create, `g` then a letter to go
 * to a page, `?` for the list. Ctrl/⌘+K lives with the search box and always
 * works. The single-key ones can be turned off from the list (WCAG 2.1.4), and
 * the button that opens the list is always there.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [chord, setChord] = useState(false);
  // Server and first client render agree (on); the stored choice applies right after hydration
  const off = useSyncExternalStore(subscribe, isOff, () => false);
  const chordTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (off) return;
    let pending = false;
    const endChord = () => {
      pending = false;
      clearTimeout(chordTimer.current);
      setChord(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target as Element | null) || document.querySelector(OVERLAY_SELECTOR)) return;
      const action = interpretKey(e.key, pending);
      if (!action) {
        if (pending) endChord();
        return;
      }
      e.preventDefault();
      if (action.type === "chord") {
        pending = true;
        setChord(true);
        chordTimer.current = setTimeout(endChord, CHORD_TIMEOUT_MS);
        return;
      }
      endChord();
      if (action.type === "go") router.push(action.href);
      else if (action.type === "search") document.querySelector<HTMLInputElement>('form[role="search"] input')?.focus();
      else if (action.type === "create") window.dispatchEvent(new Event(CREATE_CONTENT_EVENT));
      else setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(chordTimer.current);
    };
  }, [off, router]);

  function setEnabled(enabled: boolean) {
    const store = browserStore();
    try {
      if (enabled) store?.removeItem(SHORTCUTS_OFF_KEY);
      else store?.setItem(SHORTCUTS_OFF_KEY, "1");
    } catch {
      // storage blocked: the choice lasts until the page is reloaded
    }
    window.dispatchEvent(new Event(CHANGED));
  }

  return (
    <>
      <Button variant="outline" size="icon-lg" className="hidden bg-white md:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>
        <Keyboard />
      </Button>

      {/* While `g` waits for its second key */}
      <p role="status" className="sr-only">
        {chord ? "Go to: press d, c, l, s, m, a, n, p or comma." : ""}
      </p>
      {chord && (
        <div aria-hidden className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs shadow-lg">
          <Kbd>g</Kbd> then
          {GO_TO.map((g) => (
            <span key={g.key} className="flex items-center gap-1">
              <Kbd>{g.key}</Kbd>
              <span className="text-muted-foreground">{g.label.replace("Content ", "")}</span>
            </span>
          ))}
        </div>
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>They work anywhere except while you are typing in a field or a dialog is open.</DialogDescription>
          </DialogHeader>

          <section aria-labelledby="sc-general">
            <h3 id="sc-general" className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">General</h3>
            <dl className="divide-y">
              <Row label="Search content" keys={<><Kbd>/</Kbd> or <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd></>} />
              <Row label="Create content" keys={<Kbd>c</Kbd>} />
              <Row label="Show this list" keys={<Kbd>?</Kbd>} />
            </dl>
          </section>

          <section aria-labelledby="sc-go">
            <h3 id="sc-go" className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Go to — press <span className="font-mono normal-case">g</span>, then</h3>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              {GO_TO.map((g) => (
                <Row key={g.key} label={g.label} keys={<Kbd>{g.key}</Kbd>} />
              ))}
            </dl>
          </section>

          <section aria-labelledby="sc-calendar">
            <h3 id="sc-calendar" className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">On the calendar</h3>
            <dl className="divide-y">
              <Row label="Pick up a post (focus it first)" keys={<Kbd>Space</Kbd>} />
              <Row label="Choose a new day or time" keys={<><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd></>} />
              <Row label="Drop it / cancel" keys={<><Kbd>Enter</Kbd> / <Kbd>Esc</Kbd></>} />
            </dl>
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-[#f1eedf] bg-[#fcfbf3] p-3">
            <Switch id="sc-enabled" checked={!off} onCheckedChange={setEnabled} className="mt-0.5" />
            <div className="min-w-0">
              <Label htmlFor="sc-enabled" className="leading-snug">
                Single-key shortcuts
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">Turn them off if voice control or a screen reader triggers them by accident. Ctrl+K and this window keep working.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
