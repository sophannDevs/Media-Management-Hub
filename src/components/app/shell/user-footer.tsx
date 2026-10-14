import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/actions/auth";

/**
 * Bottom of the sidebar: who is signed in, and sign out. Without a name (the
 * loading placeholder) it still offers sign-out, which needs no user data.
 */
export function UserFooter({ name, email }: { name?: string; email?: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-sm font-medium">{name ?? "Signed in"}</p>
        {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
      </div>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="icon-lg" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
