import { db } from "@/lib/db";

// Fault injection inside SQLite. A trigger that raises makes the statement
// fail exactly like a real database error would, without touching app code.

/** Every insert into `table` fails (for example Notification or ActivityLog). */
export async function failInserts(table: string) {
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "fault_insert_${table}" BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected fault: insert into ${table}'); END`,
  );
}

/** Updating a content item's derived status to `status` fails. */
export async function failContentStatus(status: string) {
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "fault_content_status" BEFORE UPDATE OF publishingStatus ON "Content" WHEN NEW.publishingStatus = '${status}' BEGIN SELECT RAISE(ABORT, 'injected fault: status sync'); END`,
  );
}

export async function clearFaults() {
  const triggers = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'fault_%'`);
  for (const t of triggers) await db.$executeRawUnsafe(`DROP TRIGGER "${t.name}"`);
}

/** Polls until `check` passes; resolves false after `timeoutMs`. */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}
