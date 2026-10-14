"use client";

import { Ellipsis, KeyRound, RefreshCw, Star, Trash2, Unplug } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useServerAction } from "@/hooks/use-server-action";
import { deleteAccountAction, disconnectAccountAction, reconnectAccountAction, setDefaultAccountAction, syncAccountAction } from "@/server/actions/workspace";

interface AccountRef {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  isDefault: boolean;
  scheduled: number;
  accountNoun: string;
}

const posts = (n: number) => `${n} scheduled post${n === 1 ? "" : "s"}`;

export function AccountMenu({ account: a }: { account: AccountRef }) {
  const [confirm, setConfirm] = useState<"disconnect" | "remove" | null>(null);
  const { run, pending } = useServerAction();
  const dialog = (kind: "disconnect" | "remove") => ({ open: confirm === kind, onOpenChange: (o: boolean) => setConfirm(o ? kind : null) });

  return (
    <>
      {/* Non-modal: its items open confirmation dialogs */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${a.name}`} disabled={pending} className="-mt-1 -mr-1 shrink-0">
            {pending ? <RefreshCw className="animate-spin" /> : <Ellipsis />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {a.connected ? (
            <DropdownMenuItem onSelect={() => run(() => syncAccountAction(a.id), { success: `${a.name} synced` })}>
              <RefreshCw />
              Sync now
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => run(() => reconnectAccountAction(a.id), { success: `${a.name} reconnected` })}>
              <KeyRound />
              Reconnect
            </DropdownMenuItem>
          )}
          {!a.isDefault && (
            <DropdownMenuItem onSelect={() => run(() => setDefaultAccountAction(a.id), { success: `${a.name} is now the default ${a.accountNoun}` })}>
              <Star />
              Set as default
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {a.status !== "DISCONNECTED" && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("disconnect")}>
              <Unplug />
              Disconnect
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" disabled={a.scheduled > 0} onSelect={() => setConfirm("remove")} className="items-start">
            <Trash2 className="mt-0.5" />
            <span>
              Remove
              {a.scheduled > 0 && <span className="block text-xs text-muted-foreground">Move or cancel its {posts(a.scheduled)} first</span>}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        {...dialog("disconnect")}
        title={`Disconnect ${a.name}?`}
        confirmLabel="Disconnect"
        description={
          a.scheduled > 0
            ? `${posts(a.scheduled)} on this ${a.accountNoun} will fail until you reconnect it.`
            : `Nothing is scheduled on this ${a.accountNoun}. You can reconnect it at any time.`
        }
        onConfirm={() => run(() => disconnectAccountAction(a.id), { success: `${a.name} disconnected` })}
      />
      <ConfirmDialog
        {...dialog("remove")}
        title={`Remove ${a.name}?`}
        confirmLabel="Remove"
        description={`The ${a.accountNoun} is removed from MediaFlow. If it has publishing history, it's disconnected instead so past posts keep their record.`}
        onConfirm={() => run(() => deleteAccountAction(a.id))}
      />
    </>
  );
}

export function ReconnectButton({ accountId, name }: { accountId: string; name: string }) {
  const { run, pending } = useServerAction();
  return (
    <Button size="sm" className="shrink-0" disabled={pending} onClick={() => run(() => reconnectAccountAction(accountId), { success: `${name} reconnected` })}>
      <KeyRound />
      {pending ? "Reconnecting…" : "Reconnect"}
    </Button>
  );
}
