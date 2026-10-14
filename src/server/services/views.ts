import { db } from "@/lib/db";
import { viewQuery } from "@/lib/content-list";
import { ServiceError } from "../errors";

/** Saved views per user; more than this is a sign they should be cleaned up. */
export const MAX_VIEWS = 30;

export function listViews(userId: string) {
  return db.savedView.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, query: true } });
}

/** Saves the current list as a named view; saving under an existing name replaces it. */
export async function saveView(userId: string, name: string, query: string) {
  const clean = name.trim();
  if (!clean) throw new ServiceError("Give the view a name.");
  const existing = await db.savedView.findUnique({ where: { userId_name: { userId, name: clean } }, select: { id: true } });
  if (!existing && (await db.savedView.count({ where: { userId } })) >= MAX_VIEWS) {
    throw new ServiceError(`You can keep up to ${MAX_VIEWS} views. Delete one first.`);
  }
  return db.savedView.upsert({
    where: { userId_name: { userId, name: clean } },
    update: { query: viewQuery(query) },
    create: { userId, name: clean, query: viewQuery(query) },
    select: { id: true, name: true, query: true },
  });
}

export async function deleteView(userId: string, id: string) {
  const { count } = await db.savedView.deleteMany({ where: { id, userId } });
  if (!count) throw new ServiceError("That view no longer exists.");
}
