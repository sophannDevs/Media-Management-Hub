// Shared by the pages that show the activity log (DB-05).

/** Who a log row says did it: the person's name, the worker, or the system. */
export function actorLabel(row: { source: string; actor?: { name: string } | null }) {
  if (row.actor?.name) return row.actor.name;
  if (row.source === "WORKER") return "Publishing worker";
  if (row.source === "USER") return "A former user";
  return "System";
}
