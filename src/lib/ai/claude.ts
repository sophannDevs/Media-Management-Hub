import Anthropic from "@anthropic-ai/sdk";

// Script generation with Claude. When no credentials are configured the app
// falls back to a deterministic mock so the workflow still works end to end.

export interface ScriptBrief {
  title: string;
  idea: string;
  description: string;
  audience: string;
  language: string;
  contentType: string;
  /** Optional prompt template from the AI Prompt Library */
  template?: string | null;
}

export interface GeneratedScript {
  body: string;
  source: "CLAUDE" | "MOCK";
  model?: string;
}

export class AiGenerationError extends Error {}

export function isClaudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

const SYSTEM = `You are a scriptwriter for a YouTube and Facebook video channel that produces AI-assisted videos.
Write narration-ready scripts: short sentences, a strong hook in the first 15 seconds, clear sections,
and B-roll / visual notes in [square brackets] so the image generation step knows what to create.
Mark each section with a heading line like "[HOOK — 0:00]". Finish with a recap and a call to action.
Return only the script text, with no preamble.`;

function briefToPrompt(b: ScriptBrief) {
  const length = b.contentType === "LONG_FORM" ? "an 8–10 minute video" : "a 45–60 second vertical short";
  const filled = b.template
    ?.replaceAll("{title}", b.title)
    .replaceAll("{topic}", b.title)
    .replaceAll("{audience}", b.audience || "a general audience")
    .replaceAll("{tone}", "clear and engaging")
    .replaceAll("{duration}", b.contentType === "LONG_FORM" ? "8–10" : "1");

  return [
    filled ? `Instructions:\n${filled}\n` : "",
    `Write the script for ${length}.`,
    `Title: ${b.title}`,
    b.idea && `Idea / format: ${b.idea}`,
    b.description && `Summary: ${b.description}`,
    b.audience && `Target audience: ${b.audience}`,
    `Language: ${b.language}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateScript(brief: ScriptBrief): Promise<GeneratedScript> {
  if (!isClaudeConfigured()) return { body: mockScript(brief), source: "MOCK" };

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

  try {
    // Streaming avoids HTTP timeouts on long outputs; finalMessage() collects the result.
    const message = await client.beta.messages
      .stream({
        model,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        // Server-side fallback re-runs the request on another model if this one declines.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: briefToPrompt(brief) }],
      })
      .finalMessage();

    if (message.stop_reason === "refusal") {
      throw new AiGenerationError("Claude declined to write this script. Try rephrasing the idea or description.");
    }
    const body = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!body) throw new AiGenerationError("Claude returned an empty script.");
    return { body, source: "CLAUDE", model: message.model };
  } catch (error) {
    if (error instanceof AiGenerationError) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new AiGenerationError("Claude API key is invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new AiGenerationError("Claude is rate limited — try again in a minute.");
    if (error instanceof Anthropic.APIError) throw new AiGenerationError(`Claude API error (${error.status}): ${error.message}`);
    throw new AiGenerationError("Could not reach the Claude API.");
  }
}

function mockScript(b: ScriptBrief) {
  const short = b.contentType !== "LONG_FORM";
  const sections = short
    ? [
        ["HOOK — 0:00", `Stop scrolling — here's the fastest way to understand "${b.title}".`],
        ["MAIN POINT — 0:05", b.idea || b.description || "Explain the single most useful idea in one breath."],
        ["CTA — 0:40", "Follow for more quick tips like this."],
      ]
    : [
        ["HOOK — 0:00", `What if everything you knew about "${b.title}" was only half the story?`],
        ["INTRO — 0:15", `${b.description || "In this video we break it down step by step."} [B-ROLL: title card over cinematic establishing shot]`],
        ["PART 1 — 0:45", `${b.idea || "Start with the core idea."} [B-ROLL: close-up visuals that illustrate the first point]`],
        ["PART 2 — 3:00", "Now the part most people miss. [B-ROLL: side-by-side comparison]"],
        ["PART 3 — 5:30", "Here's how to apply it today. [B-ROLL: step-by-step on-screen checklist]"],
        ["RECAP — 8:00", "Three ideas, one takeaway: start small and stay consistent."],
        ["CTA — 8:40", "Tell me in the comments which part surprised you most — and subscribe for the next one."],
      ];
  return [
    `# ${b.title}`,
    `(Mock draft — set ANTHROPIC_API_KEY to generate real scripts with Claude.)`,
    "",
    ...sections.flatMap(([h, t]) => [`[${h}]`, t, ""]),
  ].join("\n");
}
