import { Bell, Plus } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { CreateContentDialog } from "@/components/app/create-content-dialog";
import { ScheduleDialogProvider } from "@/components/app/schedule-dialog";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/dates";
import { getContentFormOptions, getNavCounts, getNotifications, getNow } from "@/server/queries/shared";
import { NotificationsMenu } from "./notifications-menu";
import { SearchBox } from "./search-box";
import { MobileNav, Sidebar } from "./sidebar-nav";
import { SimulationBanner } from "./simulation-banner";

async function SidebarWithCounts() {
  return <Sidebar counts={await getNavCounts()} />;
}

async function MobileNavWithCounts() {
  return <MobileNav counts={await getNavCounts()} />;
}

async function Notifications() {
  const [items, counts, now] = await Promise.all([getNotifications(25), getNavCounts(), getNow()]);
  return (
    <NotificationsMenu
      unread={counts.unread}
      items={items.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, href: n.href, read: !!n.readAt, ago: timeAgo(n.createdAt, now) }))}
    />
  );
}

/** Server-rendered "Create Content" button (loads the form options). */
export async function CreateContentButton({ trigger }: { trigger?: ReactNode }) {
  return <CreateContentDialog options={await getContentFormOptions()} trigger={trigger} />;
}

export function CreateContentButtonFallback() {
  return (
    <Button disabled>
      <Plus />
      <span className="hidden sm:inline">Create Content</span>
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ScheduleDialogProvider>
      <Suspense fallback={<Sidebar />}>
        <SidebarWithCounts />
      </Suspense>
      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-30 h-16 border-b border-sidebar-border bg-background/85 backdrop-blur">
          <div className="flex h-full items-center gap-3 px-4 md:px-8">
            <Suspense fallback={<MobileNav />}>
              <MobileNavWithCounts />
            </Suspense>
            <SearchBox />
            <div className="ml-auto flex items-center gap-2">
              <Suspense fallback={<CreateContentButtonFallback />}>
                <CreateContentButton />
              </Suspense>
              <Suspense
                fallback={
                  <Button variant="outline" size="icon-lg" className="bg-white" disabled aria-label="Notifications">
                    <Bell />
                  </Button>
                }
              >
                <Notifications />
              </Suspense>
            </div>
          </div>
        </header>
        <SimulationBanner />
        <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-6 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </ScheduleDialogProvider>
  );
}
