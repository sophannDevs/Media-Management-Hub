import { db } from "@/lib/db";
import { fmtShort } from "@/lib/dates";
import { PromptCategory } from "@/lib/workflow/statuses";
import { getPageContext } from "./shared";

/** Every saved prompt, most recently updated first, with dates formatted in the workspace timezone. */
export async function getPromptLibrary() {
  const { tz } = await getPageContext();
  const prompts = await db.aiPrompt.findMany({ orderBy: [{ updatedAt: "desc" }, { name: "asc" }] });
  return {
    prompts: prompts.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      provider: p.provider,
      content: p.content,
      createdLabel: fmtShort(p.createdAt, tz),
      updatedLabel: fmtShort(p.updatedAt, tz),
    })),
  };
}

export type PromptItem = Awaited<ReturnType<typeof getPromptLibrary>>["prompts"][number];

/** Category from `?category=`, or null for "All". */
export function parsePromptCategory(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  return PromptCategory.is(v) ? v : null;
}
