import { connection } from "next/server";
import { csvCell } from "@/lib/csv";
import { db } from "@/lib/db";
import { fmt } from "@/lib/dates";
import { ContentType, ImageStatus, Priority, PublishingStatus, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";
import { unauthorizedResponse } from "@/server/auth/dal";
import { getSettings } from "@/server/services/settings";

/** CSV export of all (non-archived) content with statuses and the next scheduled post. */
export async function GET() {
  await connection(); // always run at request time
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { timezone: tz } = await getSettings();
  const rows = await db.content.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      series: true,
      campaign: true,
      tags: true,
      platforms: true,
      schedules: { where: { status: { in: ["WAITING", "RETRY_SCHEDULED", "PROCESSING"] } }, orderBy: { scheduledAt: "asc" }, take: 1 },
    },
  });

  const header = ["Title", "Type", "Category", "Series", "Campaign", "Tags", "Platforms", "Priority", "Script", "Images", "Video", "Review", "Publishing", "Target date", "Next post", "Created"];
  const lines = rows.map((c) =>
    [
      c.title,
      ContentType.label(c.contentType),
      c.category?.name,
      c.series?.name,
      c.campaign?.name,
      c.tags.map((t) => t.name).join("; "),
      c.platforms.map((p) => p.platformId).join("; "),
      Priority.label(c.priority),
      ScriptStatus.label(c.scriptStatus),
      ImageStatus.label(c.imageStatus),
      VideoStatus.label(c.videoStatus),
      ReviewStatus.label(c.reviewStatus),
      PublishingStatus.label(c.publishingStatus),
      c.targetPublishDate ? fmt(c.targetPublishDate, tz, "yyyy-MM-dd") : "",
      c.schedules[0] ? `${c.schedules[0].platformId} ${fmt(c.schedules[0].scheduledAt, tz, "yyyy-MM-dd HH:mm")}` : "",
      fmt(c.createdAt, tz, "yyyy-MM-dd"),
    ]
      .map(csvCell)
      .join(","),
  );

  const body = "﻿" + [header.join(","), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mediaflow-content.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
