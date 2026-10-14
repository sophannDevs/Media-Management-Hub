import { AppShell } from "@/components/app/shell/app-shell";
import NotFound from "./(app)/not-found";

// Unmatched URLs render outside the (app) group, so wrap them in the shell here.
export default function GlobalNotFound() {
  return (
    <AppShell>
      <NotFound />
    </AppShell>
  );
}
