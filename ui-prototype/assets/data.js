// Mock data for the static prototype.
// Shapes mirror the planned database entities (Content, Script, ScriptVersion,
// MediaAsset, ImagePrompt, SocialAccount, PublishingSchedule/Job, ActivityLog...).
// "Today" for the prototype is fixed so the dashboard is deterministic.
window.TODAY = new Date('2026-10-13T10:30:00');

window.DB = {
  user: { name: 'Sophann Vun', email: 'creator@example.com', initials: 'SV', timezone: 'Asia/Phnom_Penh' },

  platforms: [
    { id: 'youtube', name: 'YouTube', enabled: true },
    { id: 'facebook', name: 'Facebook', enabled: true },
    { id: 'youtube_shorts', name: 'YouTube Shorts', enabled: false },
    { id: 'facebook_reels', name: 'Facebook Reels', enabled: false },
    { id: 'tiktok', name: 'TikTok', enabled: false },
    { id: 'instagram', name: 'Instagram', enabled: false },
  ],

  categories: ['AI & Tech', 'Tutorial', 'Education', 'Travel', 'Lifestyle', 'Motivation', 'Behind the Scenes'],
  series: ['AI News', 'Explained', 'Hidden Cambodia', 'Creator Tips'],
  campaigns: ['October Growth Campaign', 'Q4 Evergreen', 'Holiday Push'],

  contents: [
    { id: 'c-101', title: '10 AI Tools That Will Replace Your Workflow in 2027', description: 'A fast-paced countdown of the AI tools changing how creators, marketers and developers work.', idea: 'Countdown format, each tool gets 40s demo.', category: 'AI & Tech', tags: ['ai tools', 'productivity', 'countdown'], type: 'Long-form', createdAt: '2026-10-01', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Scheduled', priority: 'High', series: 'AI News', campaign: 'October Growth Campaign', targetDate: '2026-10-14', thumb: 0, duration: '9:42', language: 'English', audience: 'Creators & knowledge workers' },
    { id: 'c-102', title: 'How Claude Writes a Full Video Script in 5 Minutes', description: 'Screen-recorded walkthrough of my exact script prompt and revision loop.', idea: 'Show prompt, output, and 2 revision rounds.', category: 'Tutorial', tags: ['claude', 'scriptwriting', 'workflow'], type: 'Long-form', createdAt: '2026-10-04', platforms: ['youtube'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Ready to Post', priority: 'High', series: 'Creator Tips', campaign: 'October Growth Campaign', targetDate: '2026-10-18', thumb: 1, duration: '7:15', language: 'English', audience: 'YouTube creators' },
    { id: 'c-103', title: 'The History of the Angkor Empire — Animated', description: 'An illustrated journey through the rise and fall of the Khmer Empire.', idea: 'Map-based storytelling, 12 scenes.', category: 'Education', tags: ['history', 'cambodia', 'animation'], type: 'Long-form', createdAt: '2026-10-05', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Generated', video: 'Not Started', review: 'Not Started', publishing: 'Not Ready', priority: 'Medium', series: 'Explained', campaign: 'Q4 Evergreen', targetDate: '2026-10-25', thumb: 2, duration: '', language: 'English', audience: 'History lovers' },
    { id: 'c-104', title: 'Morning Routine of Highly Productive People', description: 'Research-backed habits explained with calm visuals.', idea: '5 habits, each with a study reference.', category: 'Lifestyle', tags: ['habits', 'productivity'], type: 'Long-form', createdAt: '2026-10-08', platforms: ['youtube'], script: 'Generated', image: 'Not Started', video: 'Not Started', review: 'Not Started', publishing: 'Not Ready', priority: 'Low', series: '', campaign: 'Q4 Evergreen', targetDate: '2026-10-30', thumb: 3, duration: '', language: 'English', audience: 'Young professionals' },
    { id: 'c-105', title: 'Why Everyone Is Talking About AI Agents', description: 'What AI agents are, why they matter, and what changes next.', idea: 'Explainer with 3 real examples.', category: 'AI & Tech', tags: ['ai agents', 'explainer'], type: 'Long-form', createdAt: '2026-09-28', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Published', priority: 'High', series: 'AI News', campaign: 'October Growth Campaign', targetDate: '2026-10-10', thumb: 4, duration: '11:03', language: 'English', audience: 'Tech-curious viewers' },
    { id: 'c-106', title: 'Top 5 Hidden Places in Cambodia', description: 'Off-the-beaten-path destinations most tourists never see.', idea: 'Drone-style AI visuals + map overlays.', category: 'Travel', tags: ['travel', 'cambodia', 'hidden gems'], type: 'Long-form', createdAt: '2026-09-25', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Published', priority: 'Medium', series: 'Hidden Cambodia', campaign: '', targetDate: '2026-10-08', thumb: 5, duration: '8:27', language: 'Khmer', audience: 'Travelers' },
    { id: 'c-107', title: 'Budget Smart Home Setup Under $200', description: 'The cheapest way to automate lights, plugs and cameras.', idea: 'Shopping list + setup steps.', category: 'AI & Tech', tags: ['smart home', 'budget'], type: 'Long-form', createdAt: '2026-09-30', platforms: ['facebook', 'youtube'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Failed', priority: 'Medium', series: '', campaign: 'October Growth Campaign', targetDate: '2026-10-12', thumb: 6, duration: '6:58', language: 'English', audience: 'Home owners' },
    { id: 'c-108', title: 'Explained: How Image Diffusion Models Work', description: 'From noise to picture — diffusion explained with simple visuals.', idea: 'Analogy-driven, no math.', category: 'Education', tags: ['diffusion', 'ai art', 'explainer'], type: 'Long-form', createdAt: '2026-10-06', platforms: ['youtube'], script: 'Needs Revision', image: 'Not Started', video: 'Not Started', review: 'Not Started', publishing: 'Not Ready', priority: 'Medium', series: 'Explained', campaign: 'Q4 Evergreen', targetDate: '2026-10-28', thumb: 7, duration: '', language: 'English', audience: 'Students' },
    { id: 'c-109', title: 'Quick Tip: Consistent Characters in Google Flow', description: 'A 45-second tip for keeping characters consistent across scenes.', idea: 'Vertical short, before/after.', category: 'Tutorial', tags: ['google flow', 'shorts', 'tips'], type: 'Short', createdAt: '2026-10-09', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Editing', review: 'Not Started', publishing: 'Not Ready', priority: 'High', series: 'Creator Tips', campaign: 'October Growth Campaign', targetDate: '2026-10-16', thumb: 8, duration: '', language: 'English', audience: 'AI artists' },
    { id: 'c-110', title: 'Weekly AI News Recap — Week 42', description: 'Top AI headlines of the week in under 8 minutes.', idea: 'Collect 6 stories from Mon–Thu.', category: 'AI & Tech', tags: ['ai news', 'weekly'], type: 'Long-form', createdAt: '2026-10-12', platforms: ['youtube', 'facebook'], script: 'Not Started', image: 'Not Started', video: 'Not Started', review: 'Not Started', publishing: 'Draft', priority: 'High', series: 'AI News', campaign: 'October Growth Campaign', targetDate: '2026-10-19', thumb: 9, duration: '', language: 'English', audience: 'AI enthusiasts' },
    { id: 'c-111', title: 'Stoic Lessons for Modern Life', description: 'Five Stoic ideas that still work today.', idea: 'Marble statue visuals, calm narration.', category: 'Motivation', tags: ['stoicism', 'mindset'], type: 'Long-form', createdAt: '2026-10-11', platforms: ['youtube'], script: 'Generating', image: 'Not Started', video: 'Not Started', review: 'Not Started', publishing: 'Not Ready', priority: 'Low', series: '', campaign: 'Q4 Evergreen', targetDate: '2026-11-02', thumb: 10, duration: '', language: 'English', audience: 'Self-improvement' },
    { id: 'c-112', title: 'Behind the Scenes: My AI Video Pipeline', description: 'The full tool stack and process I use to ship 3 videos a week.', idea: 'Screen recording + talking points.', category: 'Behind the Scenes', tags: ['workflow', 'behind the scenes'], type: 'Long-form', createdAt: '2026-10-02', platforms: ['facebook', 'youtube'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Scheduled', priority: 'Medium', series: 'Creator Tips', campaign: 'October Growth Campaign', targetDate: '2026-10-13', thumb: 11, duration: '12:20', language: 'English', audience: 'Creators' },
    { id: 'c-113', title: 'Coffee Science: The Perfect Pour-Over', description: 'Water temperature, grind size and timing — explained.', idea: 'Macro-style AI imagery.', category: 'Lifestyle', tags: ['coffee', 'science'], type: 'Long-form', createdAt: '2026-10-03', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Generated', review: 'In Review', publishing: 'Not Ready', priority: 'Low', series: '', campaign: '', targetDate: '2026-10-21', thumb: 12, duration: '5:40', language: 'English', audience: 'Coffee lovers' },
    { id: 'c-114', title: 'AI Music Generators Compared', description: 'Five AI music tools tested on the same brief.', idea: 'Blind listening test.', category: 'AI & Tech', tags: ['ai music', 'comparison'], type: 'Long-form', createdAt: '2026-09-20', platforms: ['youtube'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Published', priority: 'Medium', series: '', campaign: '', targetDate: '2026-10-03', thumb: 13, duration: '10:12', language: 'English', audience: 'Musicians' },
    { id: 'c-115', title: 'Kampot Pepper: From Farm to Table', description: 'The story of the world-famous pepper from southern Cambodia.', idea: 'Documentary tone, farm visuals.', category: 'Travel', tags: ['cambodia', 'food', 'documentary'], type: 'Long-form', createdAt: '2026-10-04', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Scheduled', priority: 'Medium', series: 'Hidden Cambodia', campaign: 'Q4 Evergreen', targetDate: '2026-10-20', thumb: 14, duration: '9:05', language: 'Khmer', audience: 'Foodies & travelers' },
    { id: 'c-116', title: 'AI Tools Every Teacher Should Try', description: 'Practical classroom uses for AI that save hours each week.', idea: '7 tools, each with a lesson example.', category: 'Education', tags: ['education', 'ai tools', 'teachers'], type: 'Long-form', createdAt: '2026-10-07', platforms: ['youtube', 'facebook'], script: 'Approved', image: 'Approved', video: 'Final', review: 'Approved', publishing: 'Scheduled', priority: 'Low', series: '', campaign: 'Q4 Evergreen', targetDate: '2026-10-22', thumb: 15, duration: '8:48', language: 'English', audience: 'Teachers' },
  ],

  accounts: [
    { id: 'acc-yt-1', platform: 'youtube', name: 'AI Creator Lab', handle: '@aicreatorlab', followers: '48.2K subscribers', status: 'Connected', lastSync: '2026-10-13 09:12', initials: 'AL' },
    { id: 'acc-yt-2', platform: 'youtube', name: 'Khmer Stories Studio', handle: '@khmerstories', followers: '12.9K subscribers', status: 'Connected', lastSync: '2026-10-13 09:12', initials: 'KS' },
    { id: 'acc-fb-1', platform: 'facebook', name: 'AI Creator Lab', handle: 'Page · Education website', followers: '31.4K followers', status: 'Connected', lastSync: '2026-10-13 08:55', initials: 'AL' },
    { id: 'acc-fb-2', platform: 'facebook', name: 'Smart Living Daily', handle: 'Page · Media/News company', followers: '8.7K followers', status: 'Token Expired', lastSync: '2026-10-11 22:40', initials: 'SL' },
  ],

  jobs: [
    { id: 'j-1', contentId: 'c-112', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-13T20:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-2', contentId: 'c-101', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-14T19:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-3', contentId: 'c-101', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-15T11:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-4', contentId: 'c-112', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-17T18:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-5', contentId: 'c-115', platform: 'youtube', accountId: 'acc-yt-2', scheduledAt: '2026-10-20T19:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-6', contentId: 'c-115', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-21T11:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-7', contentId: 'c-116', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-22T17:30', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Unlisted' },
    { id: 'j-8', contentId: 'c-116', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-24T09:00', timezone: 'Asia/Phnom_Penh', status: 'Waiting', visibility: 'Public' },
    { id: 'j-9', contentId: 'c-107', platform: 'facebook', accountId: 'acc-fb-2', scheduledAt: '2026-10-12T10:00', timezone: 'Asia/Phnom_Penh', status: 'Failed', visibility: 'Public', error: 'OAuthException (190): Error validating access token — the session has expired.' },
    { id: 'j-10', contentId: 'c-107', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-13T16:00', timezone: 'Asia/Phnom_Penh', status: 'Retry Scheduled', visibility: 'Public', error: 'quotaExceeded: The request cannot be completed because you have exceeded your quota. Auto-retry at 16:00.' },
    { id: 'j-11', contentId: 'c-105', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-10T18:00', timezone: 'Asia/Phnom_Penh', status: 'Published', visibility: 'Public' },
    { id: 'j-12', contentId: 'c-105', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-11T12:00', timezone: 'Asia/Phnom_Penh', status: 'Published', visibility: 'Public' },
    { id: 'j-13', contentId: 'c-106', platform: 'facebook', accountId: 'acc-fb-1', scheduledAt: '2026-10-08T11:00', timezone: 'Asia/Phnom_Penh', status: 'Published', visibility: 'Public' },
    { id: 'j-14', contentId: 'c-106', platform: 'youtube', accountId: 'acc-yt-2', scheduledAt: '2026-10-09T19:00', timezone: 'Asia/Phnom_Penh', status: 'Published', visibility: 'Public' },
    { id: 'j-15', contentId: 'c-114', platform: 'youtube', accountId: 'acc-yt-1', scheduledAt: '2026-10-03T18:30', timezone: 'Asia/Phnom_Penh', status: 'Published', visibility: 'Public' },
  ],

  activity: [
    { at: '2026-10-13T09:58', type: 'failed', text: 'YouTube upload hit quota — retry scheduled 16:00', contentId: 'c-107' },
    { at: '2026-10-13T09:20', type: 'video', text: 'Video moved to Editing', contentId: 'c-109' },
    { at: '2026-10-13T08:41', type: 'script', text: 'Script generation started with Claude', contentId: 'c-111' },
    { at: '2026-10-12T17:05', type: 'idea', text: 'New idea created', contentId: 'c-110' },
    { at: '2026-10-12T15:30', type: 'schedule', text: 'Schedule changed: YouTube Oct 16 → Oct 17, 18:00', contentId: 'c-112' },
    { at: '2026-10-12T10:02', type: 'failed', text: 'Facebook publishing failed — token expired', contentId: 'c-107' },
    { at: '2026-10-11T16:44', type: 'image', text: '6 image variations uploaded', contentId: 'c-103' },
    { at: '2026-10-11T14:10', type: 'review', text: 'Script marked Needs Revision', contentId: 'c-108' },
    { at: '2026-10-11T12:00', type: 'published', text: 'Published to Facebook', contentId: 'c-105' },
    { at: '2026-10-10T18:00', type: 'published', text: 'Published to YouTube', contentId: 'c-105' },
    { at: '2026-10-10T11:15', type: 'video', text: 'Final video uploaded (1080p, 412 MB)', contentId: 'c-102' },
    { at: '2026-10-09T13:30', type: 'schedule', text: 'Scheduled for YouTube & Facebook', contentId: 'c-101' },
  ],

  notifications: [
    { id: 'n1', type: 'failed', title: 'Publishing failed', text: '“Budget Smart Home Setup” could not be posted to Smart Living Daily.', at: '2026-10-12T10:02', unread: true, href: 'schedule.html' },
    { id: 'n2', type: 'token', title: 'Token expired', text: 'Reconnect Facebook Page “Smart Living Daily” to keep publishing.', at: '2026-10-12T10:01', unread: true, href: 'accounts.html' },
    { id: 'n3', type: 'ready', title: 'Ready for scheduling', text: '“How Claude Writes a Full Video Script” passed all checks.', at: '2026-10-10T11:20', unread: true, href: 'content-detail.html?id=c-102' },
    { id: 'n4', type: 'scheduled', title: 'Scheduled for tomorrow', text: '“10 AI Tools…” goes live on YouTube tomorrow at 19:00.', at: '2026-10-13T07:00', unread: false, href: 'calendar.html' },
    { id: 'n5', type: 'incomplete', title: 'Incomplete assets', text: '“Coffee Science” is missing an approved thumbnail.', at: '2026-10-12T09:00', unread: false, href: 'content-detail.html?id=c-113' },
    { id: 'n6', type: 'published', title: 'Successfully published', text: '“Why Everyone Is Talking About AI Agents” is live on Facebook.', at: '2026-10-11T12:00', unread: false, href: 'analytics.html' },
  ],

  prompts: [
    { id: 'p-1', name: 'Viral video idea generator', category: 'Video idea', provider: 'Claude', createdAt: '2026-08-02', updatedAt: '2026-10-01', content: 'You are a YouTube strategist. Generate 10 video ideas about {topic} for {audience}. For each idea give: a working title, a one-line hook, and why it would perform well in {month}.' },
    { id: 'p-2', name: 'Long-form script (8–10 min)', category: 'Script', provider: 'Claude', createdAt: '2026-08-02', updatedAt: '2026-10-08', content: 'Write a {duration}-minute YouTube script about "{title}". Structure: cold-open hook (15s), intro, {sections} sections with B-roll notes in [brackets], recap, CTA. Tone: {tone}. Keep sentences short for narration.' },
    { id: 'p-3', name: 'Cinematic scene image', category: 'Image', provider: 'Google AI Studio', createdAt: '2026-08-10', updatedAt: '2026-09-30', content: 'Cinematic still, {subject}, {setting}, soft golden-hour light, 35mm lens, shallow depth of field, muted earthy palette, ultra-detailed, {aspect_ratio}.' },
    { id: 'p-4', name: 'Consistent character sheet', category: 'Image', provider: 'Google Flow', createdAt: '2026-09-01', updatedAt: '2026-10-09', content: 'Character reference sheet of {character}: front, 3/4 and side views, neutral background, consistent outfit {outfit}, flat lighting.' },
    { id: 'p-5', name: 'High-CTR thumbnail', category: 'Thumbnail', provider: 'Google AI Studio', createdAt: '2026-08-12', updatedAt: '2026-09-21', content: 'YouTube thumbnail, bold focal subject {subject}, high contrast, clean background, space on the left for 3-word text, 16:9.' },
    { id: 'p-6', name: 'YouTube title variants', category: 'Title', provider: 'Claude', createdAt: '2026-08-15', updatedAt: '2026-10-02', content: 'Give 8 YouTube title options under 60 characters for a video about {topic}. Mix curiosity, numbers and benefit-driven styles. No clickbait that the video does not deliver.' },
    { id: 'p-7', name: 'SEO description', category: 'Description', provider: 'Claude', createdAt: '2026-08-15', updatedAt: '2026-09-18', content: 'Write a YouTube description for "{title}": 2-sentence summary, chapter timestamps from the script, 3 relevant links placeholders, and a short CTA.' },
    { id: 'p-8', name: 'Hashtag pack', category: 'Hashtags', provider: 'Claude', createdAt: '2026-08-20', updatedAt: '2026-09-11', content: 'Suggest 12 hashtags for {platform} about {topic}: 4 broad, 4 mid, 4 niche. Return as a single line.' },
  ],

  scriptVersions: [
    { version: 3, status: 'Approved', at: '2026-10-03T14:20', words: 1412, note: 'Tightened intro, added CTA' },
    { version: 2, status: 'Needs Revision', at: '2026-10-02T18:05', words: 1530, note: 'Hook too slow' },
    { version: 1, status: 'Generated', at: '2026-10-02T10:44', words: 1488, note: 'First Claude draft' },
  ],
};

// Mock analytics (last 30 days daily views, all platforms combined)
window.DB.analytics = {
  daily: [3120, 2980, 3340, 4120, 3890, 3610, 3500, 5240, 6810, 6120, 5730, 5010, 4880, 4620, 4410, 7920, 11240, 9880, 8410, 7530, 6990, 6550, 8820, 12460, 15310, 13980, 12020, 10850, 9970, 9410],
  byContent: {
    'c-105': { views: 48210, likes: 3120, comments: 412, shares: 860, watchHours: 3820, publishedAt: '2026-10-10', youtube: 39100, facebook: 9110 },
    'c-106': { views: 31540, likes: 2480, comments: 296, shares: 1210, watchHours: 2210, publishedAt: '2026-10-08', youtube: 18900, facebook: 12640 },
    'c-114': { views: 22870, likes: 1390, comments: 188, shares: 240, watchHours: 1960, publishedAt: '2026-10-03', youtube: 22870, facebook: 0 },
  },
  platform: [
    { platform: 'youtube', views: 80870, engagement: 6.9, followersGained: 1240 },
    { platform: 'facebook', views: 21750, engagement: 9.4, followersGained: 610 },
  ],
  // avg views per post, by weekday x time slot
  bestTimes: {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    slots: ['09:00', '12:00', '15:00', '18:00', '21:00'],
    values: [
      [2.1, 3.0, 2.4, 4.6, 3.8],
      [2.3, 3.2, 2.6, 5.1, 4.0],
      [2.0, 2.9, 2.7, 4.9, 3.6],
      [2.6, 3.5, 2.9, 5.6, 4.4],
      [2.2, 3.1, 3.0, 6.2, 5.0],
      [3.4, 4.2, 4.0, 6.8, 5.9],
      [3.6, 4.5, 4.1, 6.1, 5.2],
    ],
  },
};
