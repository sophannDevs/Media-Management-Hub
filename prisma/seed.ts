/* Demo data for local development: `npm run db:seed` (wipes existing data). */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "../src/lib/db";
import { zonedToUtc } from "../src/lib/dates";
import { scheduleActiveKey, wordCount } from "../src/lib/workflow/rules";
import { hashPassword } from "../src/server/auth/password";
import { syncMockAnalytics } from "../src/server/services/analytics-sync";
import { syncAllPublishingStatuses } from "../src/server/services/content";

const TZ = "Asia/Phnom_Penh";
const NOW = new Date();
const STORAGE = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "./storage");

/** Wall-clock time `offset` days from today in the workspace timezone. */
function at(offset: number, time = "10:00") {
  const day = formatInTimeZone(new Date(NOW.getTime() + offset * 86_400_000), TZ, "yyyy-MM-dd");
  return zonedToUtc(day, time, TZ);
}

const PALETTE = [
  ["#556B2F", "#A9BC85"], ["#3d4a5c", "#8ea3b8"], ["#7a5a2f", "#d4b483"], ["#6b4f4f", "#c9a9a6"],
  ["#2f4f4f", "#7fa8a3"], ["#4a5d23", "#c2c78a"], ["#5c4a3d", "#b8a088"], ["#3b3f58", "#9a9cc4"],
  ["#6b5b2f", "#e0c97a"], ["#2f3b2f", "#8faf8f"], ["#584a3e", "#a8957f"], ["#40513b", "#9dc08b"],
];

function svg(seed: number, w = 1280, h = 720) {
  const [a, b] = PALETTE[seed % PALETTE.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${w * (0.62 + (seed % 5) * 0.06)}" cy="${h * 0.32}" r="${h * 0.2}" fill="#fff" opacity="0.10"/>
<circle cx="${w * 0.18}" cy="${h * 0.9}" r="${h * 0.38}" fill="#000" opacity="0.07"/>
<path d="M0 ${h * 0.78} Q ${w * 0.35} ${h * 0.62} ${w * 0.6} ${h * 0.74} T ${w} ${h * 0.7} V ${h} H 0 Z" fill="#000" opacity="0.08"/>
</svg>`;
}

async function writeSvg(key: string, content: string) {
  const full = path.join(STORAGE, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return Buffer.byteLength(content);
}

const scriptFor = (title: string, idea: string) => `[HOOK — 0:00]
What if I told you everything you know about "${title}" is only half the story?

[INTRO — 0:15]
${idea} Let's break it down step by step.
[B-ROLL: cinematic establishing shot, title card]

[PART 1 — 0:45]
Start with the core idea — and why it matters right now.
[B-ROLL: close-up visuals that illustrate the first point]

[PART 2 — 3:00]
Now the part most people miss.
[B-ROLL: side-by-side comparison]

[PART 3 — 5:30]
Here's how to apply it today, in three simple steps.
[B-ROLL: on-screen checklist]

[RECAP — 8:00]
Three ideas, one takeaway: start small and stay consistent.

[CTA — 8:40]
Tell me in the comments which part surprised you — and subscribe for the next one.`;

type Seed = {
  key: string; title: string; description: string; idea: string; category: string; tags: string[]; type?: string;
  created: number; platforms: string[]; script: string; image: string; video: string; review: string;
  priority: string; series?: string; campaign?: string; target: number; duration?: number; language?: string; audience: string;
};

const CONTENT: Seed[] = [
  { key: "c101", title: "10 AI Tools That Will Replace Your Workflow in 2027", description: "A fast-paced countdown of the AI tools changing how creators, marketers and developers work.", idea: "Countdown format, each tool gets a 40s demo.", category: "AI & Tech", tags: ["ai tools", "productivity", "countdown"], created: -12, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "AI News", campaign: "October Growth Campaign", target: 1, duration: 582, audience: "Creators & knowledge workers" },
  { key: "c102", title: "How Claude Writes a Full Video Script in 5 Minutes", description: "Screen-recorded walkthrough of my exact script prompt and revision loop.", idea: "Show the prompt, the output, and two revision rounds.", category: "Tutorial", tags: ["claude", "scriptwriting", "workflow"], created: -9, platforms: ["youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "Creator Tips", campaign: "October Growth Campaign", target: 5, duration: 435, audience: "YouTube creators" },
  { key: "c103", title: "The History of the Angkor Empire — Animated", description: "An illustrated journey through the rise and fall of the Khmer Empire.", idea: "Map-based storytelling in 12 scenes.", category: "Education", tags: ["history", "cambodia", "animation"], created: -8, platforms: ["youtube", "facebook"], script: "APPROVED", image: "GENERATED", video: "NOT_STARTED", review: "NOT_STARTED", priority: "MEDIUM", series: "Explained", campaign: "Q4 Evergreen", target: 12, audience: "History lovers" },
  { key: "c104", title: "Morning Routine of Highly Productive People", description: "Research-backed habits explained with calm visuals.", idea: "Five habits, each with a study reference.", category: "Lifestyle", tags: ["habits", "productivity"], created: -5, platforms: ["youtube"], script: "GENERATED", image: "NOT_STARTED", video: "NOT_STARTED", review: "NOT_STARTED", priority: "LOW", campaign: "Q4 Evergreen", target: 17, audience: "Young professionals" },
  { key: "c105", title: "Why Everyone Is Talking About AI Agents", description: "What AI agents are, why they matter, and what changes next.", idea: "Explainer with three real examples.", category: "AI & Tech", tags: ["ai agents", "explainer"], created: -15, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "AI News", campaign: "October Growth Campaign", target: -3, duration: 663, audience: "Tech-curious viewers" },
  { key: "c106", title: "Top 5 Hidden Places in Cambodia", description: "Off-the-beaten-path destinations most tourists never see.", idea: "Drone-style AI visuals with map overlays.", category: "Travel", tags: ["travel", "cambodia", "hidden gems"], created: -18, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", series: "Hidden Cambodia", target: -5, duration: 507, language: "Khmer", audience: "Travelers" },
  { key: "c107", title: "Budget Smart Home Setup Under $200", description: "The cheapest way to automate lights, plugs and cameras.", idea: "Shopping list plus setup steps.", category: "AI & Tech", tags: ["smart home", "budget"], created: -13, platforms: ["facebook", "youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", campaign: "October Growth Campaign", target: -1, duration: 418, audience: "Home owners" },
  { key: "c108", title: "Explained: How Image Diffusion Models Work", description: "From noise to picture — diffusion explained with simple visuals.", idea: "Analogy-driven, no math.", category: "Education", tags: ["diffusion", "ai art", "explainer"], created: -7, platforms: ["youtube"], script: "NEEDS_REVISION", image: "NOT_STARTED", video: "NOT_STARTED", review: "NOT_STARTED", priority: "MEDIUM", series: "Explained", campaign: "Q4 Evergreen", target: 15, audience: "Students" },
  { key: "c109", title: "Quick Tip: Consistent Characters in Google Flow", description: "A 45-second tip for keeping characters consistent across scenes.", idea: "Vertical short, before/after.", category: "Tutorial", tags: ["google flow", "shorts", "tips"], type: "SHORT", created: -4, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "EDITING", review: "NOT_STARTED", priority: "HIGH", series: "Creator Tips", campaign: "October Growth Campaign", target: 2, audience: "AI artists" },
  { key: "c110", title: "Weekly AI News Recap — This Week", description: "Top AI headlines of the week in under 8 minutes.", idea: "Collect six stories from Monday to Thursday.", category: "AI & Tech", tags: ["ai news", "weekly"], created: -1, platforms: ["youtube", "facebook"], script: "NOT_STARTED", image: "NOT_STARTED", video: "NOT_STARTED", review: "NOT_STARTED", priority: "HIGH", series: "AI News", campaign: "October Growth Campaign", target: 6, audience: "AI enthusiasts" },
  { key: "c111", title: "Stoic Lessons for Modern Life", description: "Five Stoic ideas that still work today.", idea: "Marble statue visuals, calm narration.", category: "Motivation", tags: ["stoicism", "mindset"], created: -2, platforms: ["youtube"], script: "GENERATED", image: "NOT_STARTED", video: "NOT_STARTED", review: "NOT_STARTED", priority: "LOW", campaign: "Q4 Evergreen", target: 20, audience: "Self-improvement" },
  { key: "c112", title: "Behind the Scenes: My AI Video Pipeline", description: "The full tool stack and process I use to ship three videos a week.", idea: "Screen recording plus talking points.", category: "Behind the Scenes", tags: ["workflow", "behind the scenes"], created: -11, platforms: ["facebook", "youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", series: "Creator Tips", campaign: "October Growth Campaign", target: 0, duration: 740, audience: "Creators" },
  { key: "c113", title: "Coffee Science: The Perfect Pour-Over", description: "Water temperature, grind size and timing — explained.", idea: "Macro-style AI imagery.", category: "Lifestyle", tags: ["coffee", "science"], created: -10, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "GENERATED", review: "IN_REVIEW", priority: "LOW", target: 8, duration: 340, audience: "Coffee lovers" },
  { key: "c114", title: "AI Music Generators Compared", description: "Five AI music tools tested on the same brief.", idea: "Blind listening test.", category: "AI & Tech", tags: ["ai music", "comparison"], created: -23, platforms: ["youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", target: -10, duration: 612, audience: "Musicians" },
  { key: "c115", title: "Kampot Pepper: From Farm to Table", description: "The story of the world-famous pepper from southern Cambodia.", idea: "Documentary tone, farm visuals.", category: "Travel", tags: ["cambodia", "food", "documentary"], created: -9, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", series: "Hidden Cambodia", campaign: "Q4 Evergreen", target: 7, duration: 545, language: "Khmer", audience: "Foodies & travelers" },
  { key: "c116", title: "AI Tools Every Teacher Should Try", description: "Practical classroom uses for AI that save hours each week.", idea: "Seven tools, each with a lesson example.", category: "Education", tags: ["education", "ai tools", "teachers"], created: -6, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "LOW", campaign: "Q4 Evergreen", target: 9, duration: 528, audience: "Teachers" },
  // Older published history (feeds analytics and best-time insights)
  { key: "c117", title: "ChatGPT vs Claude vs Gemini: Honest Test", description: "Same ten tasks, three assistants, one winner per task.", idea: "Scorecard format.", category: "AI & Tech", tags: ["ai", "comparison"], created: -40, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "AI News", target: -30, duration: 701, audience: "AI enthusiasts" },
  { key: "c118", title: "Siem Reap in 48 Hours", description: "A perfect two-day itinerary beyond Angkor Wat.", idea: "Hour-by-hour plan.", category: "Travel", tags: ["travel", "cambodia"], created: -38, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", series: "Hidden Cambodia", target: -26, duration: 489, audience: "Travelers" },
  { key: "c119", title: "5 Prompting Mistakes Everyone Makes", description: "Small prompt changes that make AI output dramatically better.", idea: "Before/after examples.", category: "Tutorial", tags: ["prompting", "tips"], created: -34, platforms: ["youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "Creator Tips", target: -21, duration: 395, audience: "AI users" },
  { key: "c121", title: "How to Start a Faceless YouTube Channel", description: "Tools, workflow and first-month plan for a channel without showing your face.", idea: "Step-by-step setup.", category: "Tutorial", tags: ["youtube", "faceless"], created: -62, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "MEDIUM", series: "Creator Tips", target: -50, duration: 655, audience: "New creators" },
  { key: "c122", title: "Phnom Penh Street Food at Night", description: "Ten dishes to try after sunset in Cambodia's capital.", idea: "Night-market tour.", category: "Travel", tags: ["cambodia", "food"], created: -55, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "LOW", series: "Hidden Cambodia", target: -44, duration: 512, language: "Khmer", audience: "Foodies & travelers" },
  { key: "c123", title: "AI Video Tools Ranked (Summer Edition)", description: "Every major AI video generator, tested and ranked.", idea: "Tier list.", category: "AI & Tech", tags: ["ai video", "ranking"], created: -48, platforms: ["youtube"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "HIGH", series: "AI News", target: -38, duration: 744, audience: "AI enthusiasts" },
  { key: "c120", title: "The Science of Sleep, Animated", description: "What actually happens in your brain each night.", idea: "Calm animated explainer.", category: "Education", tags: ["sleep", "science"], created: -30, platforms: ["youtube", "facebook"], script: "APPROVED", image: "APPROVED", video: "FINAL", review: "APPROVED", priority: "LOW", series: "Explained", target: -17, duration: 566, audience: "Students" },
];

/** [content, platform, account, dayOffset, time, status, extra] */
const SCHEDULES: [string, string, string, number, string, string, { error?: string; visibility?: string }?][] = [
  ["c112", "facebook", "fb1", 0, "20:00", "WAITING"],
  ["c101", "youtube", "yt1", 1, "19:00", "WAITING"],
  ["c101", "facebook", "fb1", 2, "11:00", "WAITING"],
  ["c112", "youtube", "yt1", 4, "18:00", "WAITING"],
  ["c115", "youtube", "yt2", 7, "19:00", "WAITING"],
  ["c115", "facebook", "fb1", 8, "11:00", "WAITING"],
  ["c116", "youtube", "yt1", 9, "17:30", "WAITING", { visibility: "UNLISTED" }],
  ["c116", "facebook", "fb1", 11, "09:00", "WAITING"],
  ["c107", "facebook", "fb2", -1, "10:00", "FAILED", { error: "OAuthException (190): Error validating access token — the session has expired." }],
  ["c107", "youtube", "yt1", 3, "16:00", "RETRY_SCHEDULED", { error: "quotaExceeded: The request cannot be completed because you have exceeded your quota." }],
  ["c105", "youtube", "yt1", -3, "18:00", "PUBLISHED"],
  ["c105", "facebook", "fb1", -2, "12:00", "PUBLISHED"],
  ["c106", "facebook", "fb1", -5, "11:00", "PUBLISHED"],
  ["c106", "youtube", "yt2", -4, "19:00", "PUBLISHED"],
  ["c114", "youtube", "yt1", -10, "18:30", "PUBLISHED"],
  ["c117", "youtube", "yt1", -30, "18:00", "PUBLISHED"],
  ["c117", "facebook", "fb1", -29, "12:00", "PUBLISHED"],
  ["c118", "youtube", "yt2", -26, "21:00", "PUBLISHED"],
  ["c118", "facebook", "fb1", -25, "09:00", "PUBLISHED"],
  ["c119", "youtube", "yt1", -21, "15:00", "PUBLISHED"],
  ["c121", "youtube", "yt1", -50, "18:00", "PUBLISHED"],
  ["c121", "facebook", "fb1", -49, "12:00", "PUBLISHED"],
  ["c122", "youtube", "yt2", -44, "19:00", "PUBLISHED"],
  ["c122", "facebook", "fb1", -43, "11:00", "PUBLISHED"],
  ["c123", "youtube", "yt1", -38, "18:00", "PUBLISHED"],
  ["c120", "youtube", "yt1", -17, "18:00", "PUBLISHED"],
  ["c120", "facebook", "fb1", -16, "12:00", "PUBLISHED"],
];

/** Production states the generated items cycle through: [script, images, video, review, post] */
const BULK_STATES = [
  ["NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", null],
  ["GENERATED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", null],
  ["APPROVED", "GENERATED", "NOT_STARTED", "NOT_STARTED", null],
  ["APPROVED", "APPROVED", "EDITING", "NOT_STARTED", null],
  ["APPROVED", "APPROVED", "FINAL", "IN_REVIEW", null],
  ["APPROVED", "APPROVED", "FINAL", "APPROVED", null],
  ["APPROVED", "APPROVED", "FINAL", "APPROVED", "WAITING"],
  ["APPROVED", "APPROVED", "FINAL", "APPROVED", "PUBLISHED"],
] as const;

/**
 * SEED_BULK_ITEMS=5000 adds that many generated items (scripts, two images
 * each, a final video from the video stage on, posts for the last two states)
 * so list pages can be measured at size: scripts/perf-library.mjs.
 */
async function seedBulk(count: number, catIds: Record<string, string>, accountId: string) {
  const cats = Object.values(catIds);
  const topics = CONTENT.map((c) => c.title);
  for (let start = 0; start < count; start += 500) {
    const batch = Array.from({ length: Math.min(500, count - start) }, (_, j) => start + j);
    const state = (i: number) => BULK_STATES[i % BULK_STATES.length];
    const id = (i: number) => `bulk_${String(i).padStart(6, "0")}`;
    await db.content.createMany({
      data: batch.map((i) => {
        const [script, image, video, review] = state(i);
        return {
          id: id(i),
          title: `${topics[i % topics.length]} (part ${Math.floor(i / topics.length) + 1})`,
          description: CONTENT[i % CONTENT.length].description,
          idea: CONTENT[i % CONTENT.length].idea,
          priority: ["HIGH", "MEDIUM", "LOW"][i % 3],
          categoryId: cats[i % cats.length],
          scriptStatus: script,
          imageStatus: image,
          videoStatus: video,
          reviewStatus: review,
          hashtags: review === "APPROVED" ? "#generated #bulk" : "",
          targetPublishDate: at((i % 60) - 20, "12:00"),
          createdAt: at(-(i % 200), "09:00"),
        };
      }),
    });
    await db.contentPlatform.createMany({ data: batch.flatMap((i) => [{ contentId: id(i), platformId: "youtube" }, ...(i % 2 ? [] : [{ contentId: id(i), platformId: "facebook" }])]) });
    await db.script.createMany({ data: batch.map((i) => ({ contentId: id(i), body: state(i)[0] === "NOT_STARTED" ? "" : scriptFor(CONTENT[i % CONTENT.length].title, CONTENT[i % CONTENT.length].idea) })) });
    await db.mediaAsset.createMany({
      data: batch.flatMap((i) => {
        const [, image, video] = state(i);
        const images = image === "NOT_STARTED" ? [] : [0, 1].map((k) => ({ contentId: id(i), type: "IMAGE", fileName: `scene-${k + 1}.svg`, storageKey: `bulk/${i}/scene-${k + 1}.svg`, mimeType: "image/svg+xml", isSelected: image === "APPROVED" && k === 0 }));
        const final = video === "NOT_STARTED" ? [] : [{ contentId: id(i), type: "VIDEO", fileName: `bulk-${i}.mp4`, mimeType: "video/mp4", size: 250_000_000, durationSec: 300 + (i % 400) }];
        return [...images, ...final];
      }),
    });
    const posts = batch.filter((i) => state(i)[4]);
    await db.publishingSchedule.createMany({
      data: posts.map((i) => {
        const status = state(i)[4]!;
        const scheduledAt = status === "PUBLISHED" ? at(-(i % 90) - 1, "18:00") : at((i % 30) + 1, "18:00");
        return {
          contentId: id(i), platformId: "youtube", accountId, scheduledAt, timezone: TZ, title: topics[i % topics.length], status,
          activeKey: scheduleActiveKey(status, id(i), accountId), publishedAt: status === "PUBLISHED" ? scheduledAt : null, simulated: status === "PUBLISHED",
        };
      }),
    });
  }
  await db.$executeRaw`UPDATE "Content" c SET "videoAssetId" = m."id" FROM "MediaAsset" m WHERE m."contentId" = c."id" AND m."type" = 'VIDEO' AND c."id" LIKE 'bulk\_%'`;
}

async function wipe() {
  await db.analyticsSnapshot.deleteMany();
  await db.publishingJob.deleteMany();
  await db.publishingSchedule.deleteMany();
  await db.activityLog.deleteMany();
  await db.notification.deleteMany();
  await db.content.updateMany({ data: { videoAssetId: null, thumbnailAssetId: null } });
  await db.mediaAsset.deleteMany();
  await db.scriptVersion.deleteMany();
  await db.script.deleteMany();
  await db.imagePrompt.deleteMany();
  await db.contentPlatform.deleteMany();
  await db.content.deleteMany();
  await db.tag.deleteMany();
  await db.category.deleteMany();
  await db.series.deleteMany();
  await db.campaign.deleteMany();
  await db.socialAccount.deleteMany();
  await db.platform.deleteMany();
  await db.aiPrompt.deleteMany();
  await db.workspaceSettings.deleteMany();
  await db.user.deleteMany();
  await rm(path.join(STORAGE, "seed"), { recursive: true, force: true });
}

async function main() {
  console.log("Seeding demo data…");
  await wipe();

  // No password: the first visit opens /setup. Tests set SEED_OWNER_PASSWORD to sign in directly.
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  await db.user.create({
    data: { name: "Workspace Owner", email: "owner@mediaflow.local", ...(ownerPassword ? { passwordHash: await hashPassword(ownerPassword) } : {}) },
  });
  await db.workspaceSettings.create({ data: { id: 1, timezone: TZ } });

  const platforms = [
    ["youtube", "YouTube", true], ["facebook", "Facebook", true], ["youtube_shorts", "YouTube Shorts", false],
    ["facebook_reels", "Facebook Reels", false], ["tiktok", "TikTok", false], ["instagram", "Instagram", false],
  ] as const;
  for (const [i, [id, name, enabled]] of platforms.entries()) await db.platform.create({ data: { id, name, enabled, sortOrder: i } });

  const cats = ["AI & Tech", "Tutorial", "Education", "Travel", "Lifestyle", "Motivation", "Behind the Scenes"];
  const catIds = Object.fromEntries(await Promise.all(cats.map(async (name, i) => [name, (await db.category.create({ data: { name, sortOrder: i } })).id])));
  const seriesIds = Object.fromEntries(await Promise.all(["AI News", "Explained", "Hidden Cambodia", "Creator Tips"].map(async (name) => [name, (await db.series.create({ data: { name } })).id])));
  const campIds = Object.fromEntries(await Promise.all(["October Growth Campaign", "Q4 Evergreen", "Holiday Push"].map(async (name) => [name, (await db.campaign.create({ data: { name } })).id])));

  const day = 86_400_000;
  const accounts = {
    yt1: await db.socialAccount.create({ data: { platformId: "youtube", name: "AI Creator Lab", handle: "@aicreatorlab", followers: 48200, status: "CONNECTED", isDefault: true, accessToken: "mock", tokenExpiresAt: new Date(NOW.getTime() + 45 * day), lastSyncAt: at(0, "09:12") } }),
    yt2: await db.socialAccount.create({ data: { platformId: "youtube", name: "Khmer Stories Studio", handle: "@khmerstories", followers: 12900, status: "CONNECTED", accessToken: "mock", tokenExpiresAt: new Date(NOW.getTime() + 30 * day), lastSyncAt: at(0, "09:12") } }),
    fb1: await db.socialAccount.create({ data: { platformId: "facebook", name: "AI Creator Lab", handle: "Page · Education website", followers: 31400, status: "CONNECTED", isDefault: true, accessToken: "mock", tokenExpiresAt: new Date(NOW.getTime() + 50 * day), lastSyncAt: at(0, "08:55") } }),
    fb2: await db.socialAccount.create({ data: { platformId: "facebook", name: "Smart Living Daily", handle: "Page · Media/News company", followers: 8700, status: "TOKEN_EXPIRED", accessToken: "mock", tokenExpiresAt: new Date(NOW.getTime() - 2 * day), lastSyncAt: at(-2, "22:40"), lastError: "Session has expired." } }),
  };

  const ids: Record<string, string> = {};
  for (const [i, s] of CONTENT.entries()) {
    const hasScript = !["NOT_STARTED", "GENERATING"].includes(s.script);
    const c = await db.content.create({
      data: {
        title: s.title,
        description: s.description,
        idea: s.idea,
        contentType: s.type ?? "LONG_FORM",
        targetAudience: s.audience,
        language: s.language ?? "English",
        priority: s.priority,
        targetPublishDate: at(s.target, "12:00"),
        hashtags: s.review === "APPROVED" ? s.tags.map((t) => `#${t.replace(/\s/g, "")}`).join(" ") : "",
        scriptStatus: s.script,
        imageStatus: s.image,
        videoStatus: s.video,
        reviewStatus: s.review,
        titleFinalized: s.review === "APPROVED",
        descriptionFinalized: s.review === "APPROVED",
        categoryId: catIds[s.category],
        seriesId: s.series ? seriesIds[s.series] : null,
        campaignId: s.campaign ? campIds[s.campaign] : null,
        createdAt: at(s.created, "09:00"),
        tags: { connectOrCreate: s.tags.map((name) => ({ where: { name }, create: { name } })) },
        platforms: { create: s.platforms.map((platformId) => ({ platformId })) },
        script: { create: { body: hasScript ? scriptFor(s.title, s.idea) : "", currentVersion: hasScript ? 2 : 0 } },
        imagePrompt:
          s.script === "APPROVED"
            ? { create: { prompt: `Cinematic still for "${s.title}": ${s.idea} Soft golden-hour light, 35mm lens, shallow depth of field, muted earthy palette, ultra-detailed.`, style: "Cinematic", aspectRatio: s.type === "SHORT" ? "9:16" : "16:9" } }
            : undefined,
      },
      include: { script: true },
    });
    ids[s.key] = c.id;

    if (hasScript && c.script) {
      const body = c.script.body;
      await db.scriptVersion.createMany({
        data: [
          { scriptId: c.script.id, version: 1, body, note: "First Claude draft", wordCount: wordCount(body), status: "GENERATED", source: "CLAUDE", createdAt: at(s.created, "10:30") },
          { scriptId: c.script.id, version: 2, body, note: s.script === "NEEDS_REVISION" ? "Hook too slow" : "Tightened intro, added CTA", wordCount: wordCount(body), status: s.script, source: "MANUAL", createdAt: at(s.created + 1, "14:20") },
        ],
      });
    }

    // Images
    if (["GENERATED", "APPROVED", "NEEDS_REVISION"].includes(s.image)) {
      const n = s.image === "APPROVED" ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const key = `seed/${s.key}/scene-${k + 1}.svg`;
        const size = await writeSvg(key, svg(i + k * 3));
        await db.mediaAsset.create({ data: { contentId: c.id, type: "IMAGE", fileName: `scene-${String(k + 1).padStart(2, "0")}.svg`, storageKey: key, mimeType: "image/svg+xml", size, width: 1280, height: 720, isSelected: s.image === "APPROVED" && k < 3, createdAt: at(s.created + 2, "16:44") } });
      }
    }
    // Video (metadata only — demo videos have no file)
    if (s.duration) {
      const video = await db.mediaAsset.create({ data: { contentId: c.id, type: "VIDEO", fileName: `${s.key}-final.mp4`, mimeType: "video/mp4", size: 280_000_000 + i * 9_000_000, width: s.type === "SHORT" ? 1080 : 1920, height: s.type === "SHORT" ? 1920 : 1080, durationSec: s.duration, createdAt: at(s.created + 4, "11:15") } });
      await db.mediaAsset.create({ data: { contentId: c.id, type: "AUDIO", fileName: `${s.key}-voiceover.wav`, mimeType: "audio/wav", size: 18_000_000 + i * 400_000, durationSec: s.duration, createdAt: at(s.created + 3, "12:00") } });
      if (i % 3 === 0) await db.mediaAsset.create({ data: { contentId: c.id, type: "MUSIC", fileName: `ambient-bed-${i}.mp3`, mimeType: "audio/mpeg", size: 6_200_000, durationSec: 210, createdAt: at(s.created + 3, "12:10") } });
      let thumbnailAssetId: string | null = null;
      if (s.video === "FINAL" || s.video === "GENERATED") {
        const key = `seed/${s.key}/thumbnail.svg`;
        const size = await writeSvg(key, svg(i + 5));
        thumbnailAssetId = (await db.mediaAsset.create({ data: { contentId: c.id, type: "THUMBNAIL", fileName: "thumbnail-v1.svg", storageKey: key, mimeType: "image/svg+xml", size, width: 1280, height: 720, createdAt: at(s.created + 4, "11:30") } })).id;
      }
      await db.content.update({ where: { id: c.id }, data: { videoAssetId: video.id, thumbnailAssetId: s.video === "FINAL" ? thumbnailAssetId : null } });
    }

    await db.activityLog.create({ data: { contentId: c.id, type: "content.created", message: "Content created", createdAt: at(s.created, "09:00") } });
    if (hasScript) await db.activityLog.create({ data: { contentId: c.id, type: "script.generated", message: "Script v1 generated with Claude", createdAt: at(s.created, "10:30") } });
    if (s.script === "APPROVED") await db.activityLog.create({ data: { contentId: c.id, type: "status.changed", message: "Script marked Approved", createdAt: at(s.created + 1, "14:25") } });
    if (["GENERATED", "APPROVED"].includes(s.image)) await db.activityLog.create({ data: { contentId: c.id, type: "media.uploaded", message: `${s.image === "APPROVED" ? 4 : 6} images uploaded`, createdAt: at(s.created + 2, "16:44") } });
    if (s.duration) await db.activityLog.create({ data: { contentId: c.id, type: "video.uploaded", message: "Final video uploaded (1080p)", createdAt: at(s.created + 4, "11:15") } });
    if (s.review === "APPROVED") await db.activityLog.create({ data: { contentId: c.id, type: "status.changed", message: "Review marked Approved", createdAt: at(s.created + 5, "15:02") } });
  }

  for (const [key, platformId, acc, offset, time, status, extra] of SCHEDULES) {
    const c = CONTENT.find((x) => x.key === key)!;
    const scheduledAt = at(offset, time);
    const s = await db.publishingSchedule.create({
      data: {
        contentId: ids[key],
        platformId,
        accountId: accounts[acc as keyof typeof accounts].id,
        scheduledAt,
        timezone: TZ,
        title: c.title,
        caption: `${c.description}\n\n${c.idea}`,
        hashtags: c.tags.map((t) => `#${t.replace(/\s/g, "")}`).join(" "),
        visibility: extra?.visibility ?? (platformId === "youtube" ? "PUBLIC" : "PUBLISH"),
        status,
        activeKey: scheduleActiveKey(status, ids[key], accounts[acc as keyof typeof accounts].id),
        attempts: status === "FAILED" || status === "RETRY_SCHEDULED" ? 1 : status === "PUBLISHED" ? 1 : 0,
        lastError: extra?.error ?? null,
        nextAttemptAt: status === "RETRY_SCHEDULED" ? scheduledAt : null,
        publishedAt: status === "PUBLISHED" ? scheduledAt : null,
        // Demo posts never reached a platform
        simulated: status === "PUBLISHED",
        externalUrl: status === "PUBLISHED" ? (platformId === "youtube" ? "https://youtu.be/demo" : "https://facebook.com/watch/?v=demo") : null,
        createdAt: at(Math.min(offset, 0) - 3, "13:30"),
      },
    });
    if (status === "PUBLISHED" || status === "FAILED" || status === "RETRY_SCHEDULED") {
      await db.publishingJob.create({ data: { scheduleId: s.id, attempt: 1, status: status === "PUBLISHED" ? "SUCCEEDED" : "FAILED", error: extra?.error ?? null, startedAt: scheduledAt, finishedAt: scheduledAt } });
    }
    await db.activityLog.create({ data: { contentId: ids[key], type: "schedule.created", message: `Scheduled for ${platformId === "youtube" ? "YouTube" : "Facebook"}`, createdAt: at(Math.min(offset, 0) - 3, "13:30") } });
    if (status === "PUBLISHED") await db.activityLog.create({ data: { contentId: ids[key], type: "publish.succeeded", message: `Published to ${platformId === "youtube" ? "YouTube" : "Facebook"}`, createdAt: scheduledAt } });
    if (status === "FAILED") await db.activityLog.create({ data: { contentId: ids[key], type: "publish.failed", message: "Facebook publishing failed — token expired", createdAt: scheduledAt } });
  }

  await db.notification.createMany({
    data: [
      { type: "failed", title: "Publishing failed", message: `"Budget Smart Home Setup Under $200" could not be posted to Smart Living Daily.`, href: "/schedule?status=failed", createdAt: at(-1, "10:02"), dedupeKey: "seed:failed" },
      { type: "token_expired", title: "Token expired", message: `Reconnect Facebook Page "Smart Living Daily" to keep publishing.`, href: "/accounts", createdAt: at(-1, "10:01"), dedupeKey: "seed:token" },
      { type: "incomplete", title: "Incomplete assets", message: `"Coffee Science" still needs review and a final video.`, href: `/content/${ids.c113}`, createdAt: at(-1, "09:00"), readAt: at(-1, "12:00"), dedupeKey: "seed:incomplete" },
      { type: "published", title: "Successfully published", message: `"Why Everyone Is Talking About AI Agents" is live on Facebook.`, href: "/analytics", createdAt: at(-2, "12:00"), readAt: at(-2, "13:00"), dedupeKey: "seed:published" },
    ],
  });

  const prompts = [
    ["Viral video idea generator", "VIDEO_IDEA", "CLAUDE", "You are a YouTube strategist. Generate 10 video ideas about {topic} for {audience}. For each idea give a working title, a one-line hook, and why it would perform well this month."],
    ["Long-form script (8–10 min)", "SCRIPT", "CLAUDE", 'Write a {duration}-minute YouTube script about "{title}". Structure: cold-open hook (15s), intro, 3–5 sections with B-roll notes in [brackets], recap, CTA. Tone: {tone}. Keep sentences short for narration. Audience: {audience}.'],
    ["Cinematic scene image", "IMAGE", "GOOGLE_AI_STUDIO", "Cinematic still, {subject}, {setting}, soft golden-hour light, 35mm lens, shallow depth of field, muted earthy palette, ultra-detailed, {aspect_ratio}."],
    ["Consistent character sheet", "IMAGE", "GOOGLE_FLOW", "Character reference sheet of {character}: front, 3/4 and side views, neutral background, consistent outfit {outfit}, flat lighting."],
    ["High-CTR thumbnail", "THUMBNAIL", "GOOGLE_AI_STUDIO", "YouTube thumbnail, bold focal subject {subject}, high contrast, clean background, space on the left for 3-word text, 16:9."],
    ["YouTube title variants", "TITLE", "CLAUDE", "Give 8 YouTube title options under 60 characters for a video about {topic}. Mix curiosity, numbers and benefit-driven styles. No clickbait the video does not deliver."],
    ["SEO description", "DESCRIPTION", "CLAUDE", 'Write a YouTube description for "{title}": 2-sentence summary, chapter timestamps from the script, 3 link placeholders, and a short CTA.'],
    ["Hashtag pack", "HASHTAGS", "CLAUDE", "Suggest 12 hashtags for {platform} about {topic}: 4 broad, 4 mid, 4 niche. Return as a single line."],
  ] as const;
  for (const [i, [name, category, provider, content]] of prompts.entries()) {
    await db.aiPrompt.create({ data: { name, category, provider, content, createdAt: at(-70 + i, "10:00"), updatedAt: at(-12 + i, "10:00") } });
  }

  const bulk = Number(process.env.SEED_BULK_ITEMS) || 0;
  if (bulk > 0) await seedBulk(bulk, catIds, accounts.yt1.id);

  await syncAllPublishingStatuses();
  await syncMockAnalytics(NOW);
  const counts = await Promise.all([db.content.count(), db.publishingSchedule.count(), db.mediaAsset.count(), db.analyticsSnapshot.count()]);
  console.log(`Done: ${counts[0]} content, ${counts[1]} schedules, ${counts[2]} media assets, ${counts[3]} analytics rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
