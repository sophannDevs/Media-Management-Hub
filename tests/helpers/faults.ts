import { db } from "@/lib/db";

// Fault injection inside PostgreSQL. A trigger that raises makes the statement
// fail exactly like a real database error would, without touching app code.

/** Every insert into `table` fails (for example Notification or ActivityLog). */
export async function failInserts(table: string) {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "fault_fn_insert_${table}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected fault: insert into ${table}'; END $$`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER "fault_insert_${table}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "fault_fn_insert_${table}"()`);
}

/** Updating a content item's derived status to `status` fails. */
export async function failContentStatus(status: string) {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "fault_fn_content_status"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."publishingStatus" = '${status}' THEN RAISE EXCEPTION 'injected fault: status sync'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER "fault_content_status" BEFORE UPDATE OF "publishingStatus" ON "Content" FOR EACH ROW EXECUTE FUNCTION "fault_fn_content_status"()`);
}

export async function clearFaults() {
  const triggers = await db.$queryRawUnsafe<{ name: string; table: string }[]>(
    `SELECT t.tgname AS name, c.relname AS table FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'fault\\_%'`,
  );
  for (const t of triggers) await db.$executeRawUnsafe(`DROP TRIGGER "${t.name}" ON "${t.table}"`);
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
