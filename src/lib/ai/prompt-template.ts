// Prompt templates and their {variables} (AI-02). A template is plain text
// with {name} placeholders. Some names the app can fill from the content item
// (the title, the audience, the platform…); the rest a person fills in before
// the template is used. Nothing unfilled is ever sent to a model.

export const VARIABLE_PATTERN = /\{([a-z][a-z0-9_]*)\}/gi;

export interface VariableDef {
  label: string;
  /** Where the app takes it from; "ask" means a person types it */
  source: "content" | "image prompt" | "ask";
  hint: string;
}

/** The variables the app knows. Any other {name} is asked for. */
export const KNOWN_VARIABLES: Record<string, VariableDef> = {
  title: { label: "Title", source: "content", hint: "The content item's title" },
  topic: { label: "Topic", source: "content", hint: "The title, unless given" },
  audience: { label: "Audience", source: "content", hint: "The target audience" },
  language: { label: "Language", source: "content", hint: "The content item's language" },
  duration: { label: "Duration", source: "content", hint: "Minutes, from the content type (8–10 for long-form, 1 for a short)" },
  platform: { label: "Platform", source: "content", hint: "The first target platform" },
  tone: { label: "Tone", source: "ask", hint: "Defaults to “clear and engaging” for scripts" },
  subject: { label: "Subject", source: "ask", hint: "What the picture shows" },
  setting: { label: "Setting", source: "ask", hint: "Where the picture is set" },
  character: { label: "Character", source: "ask", hint: "Who the reference sheet is of" },
  outfit: { label: "Outfit", source: "ask", hint: "What the character wears" },
  style: { label: "Style", source: "image prompt", hint: "The image prompt's style" },
  aspect_ratio: { label: "Aspect ratio", source: "image prompt", hint: "The image prompt's aspect ratio" },
};

/** The distinct {variables} of a template, in order of first appearance. */
export function extractVariables(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(VARIABLE_PATTERN)) {
    const name = m[1].toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Fills the template; `missing` lists the variables with no value, which block generation. */
export function renderTemplate(template: string, values: Record<string, string | null | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(VARIABLE_PATTERN, (whole, raw: string) => {
    const name = raw.toLowerCase();
    const v = values[name]?.trim();
    if (!v) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return v;
  });
  return { text, missing };
}

export interface ContentForPrompt {
  title: string;
  targetAudience?: string | null;
  language?: string | null;
  contentType?: string | null;
  platforms?: string[];
}

const PLATFORM_NAMES: Record<string, string> = { youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", instagram: "Instagram" };

/** The values the app can supply on its own for a content item (and its image prompt, when given). */
export function autoValues(c: ContentForPrompt, image?: { style?: string | null; aspectRatio?: string | null } | null): Record<string, string> {
  const v: Record<string, string> = { title: c.title, topic: c.title };
  if (c.targetAudience?.trim()) v.audience = c.targetAudience.trim();
  if (c.language?.trim()) v.language = c.language.trim();
  if (c.contentType) v.duration = c.contentType === "LONG_FORM" ? "8–10" : "1";
  if (c.platforms?.length) v.platform = PLATFORM_NAMES[c.platforms[0]] ?? c.platforms[0];
  if (image?.style?.trim()) v.style = image.style.trim();
  if (image?.aspectRatio?.trim()) v.aspect_ratio = image.aspectRatio.trim();
  return v;
}

/** The variables of a template a person still has to type, given what the app fills in. */
export function variablesToAsk(template: string, auto: Record<string, string>): string[] {
  return extractVariables(template).filter((name) => !auto[name]?.trim());
}

/** "{subject}, {setting}" for a message. */
export const listVariables = (names: string[]) => names.map((n) => `{${n}}`).join(", ");
