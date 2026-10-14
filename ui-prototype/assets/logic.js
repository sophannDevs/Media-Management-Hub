// Business logic — kept separate from rendering so it can move to
// `lib/workflow.ts` in the Next.js app unchanged in spirit.

window.STATUS = {
  script: ['Not Started', 'Generating', 'Generated', 'Needs Revision', 'Approved'],
  image: ['Not Started', 'Generating', 'Generated', 'Needs Revision', 'Approved'],
  imageAsset: ['Prompt Not Created', 'Prompt Ready', 'Generating', 'Generated', 'Selected', 'Approved'],
  video: ['Not Started', 'Editing', 'Generated', 'Needs Revision', 'Final'],
  review: ['Not Started', 'In Review', 'Changes Requested', 'Approved'],
  publishing: ['Draft', 'Not Ready', 'Ready to Post', 'Scheduled', 'Publishing', 'Published', 'Failed'],
  job: ['Waiting', 'Processing', 'Published', 'Failed', 'Retry Scheduled'],
  account: ['Connected', 'Disconnected', 'Token Expired', 'Error'],
};

// Ordered pipeline stages (dashboard + progress)
window.STAGES = ['Idea', 'Script', 'Images', 'Video', 'Review', 'Ready', 'Scheduled', 'Published'];

const Logic = {
  content(id) { return DB.contents.find((c) => c.id === id); },
  account(id) { return DB.accounts.find((a) => a.id === id); },
  jobsFor(contentId) { return DB.jobs.filter((j) => j.contentId === contentId).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)); },

  /** Which production stage the content is currently in. */
  stage(c) {
    if (c.publishing === 'Published') return 'Published';
    if (c.publishing === 'Failed') return 'Failed';
    if (c.publishing === 'Scheduled' || c.publishing === 'Publishing') return 'Scheduled';
    if (c.script === 'Not Started') return 'Idea';
    if (c.script !== 'Approved') return 'Script';
    if (c.image !== 'Approved') return 'Images';
    if (c.video !== 'Final') return 'Video';
    if (c.review !== 'Approved') return 'Review';
    return 'Ready';
  },

  /** Rule: Ready to Post only when script approved, images approved, video final and reviewed. */
  readiness(c) {
    const missing = [];
    if (c.script !== 'Approved') missing.push({ key: 'script', text: 'Script is not approved', tab: 'script' });
    if (c.image !== 'Approved') missing.push({ key: 'image', text: 'Images are not approved', tab: 'images' });
    if (c.video !== 'Final') missing.push({ key: 'video', text: 'Final video is missing', tab: 'video' });
    if (c.review !== 'Approved') missing.push({ key: 'review', text: 'Content has not been reviewed', tab: 'overview' });
    return { ready: missing.length === 0, missing };
  },

  /** Rule: a post can be scheduled only with a ready video, a platform, a connected account and a future date. */
  validateSchedule({ content, platform, accountId, date, time }) {
    const errors = [];
    if (!content || !Logic.readiness(content).ready) errors.push('Video must be “Ready to Post” before scheduling.');
    if (!platform) errors.push('Select a social platform.');
    const acc = accountId && Logic.account(accountId);
    if (!acc) errors.push('Select a social account.');
    else if (acc.status !== 'Connected') errors.push(`Account “${acc.name}” is ${acc.status.toLowerCase()} — reconnect it first.`);
    if (!date || !time) errors.push('Pick a date and time.');
    else if (new Date(`${date}T${time}`) <= TODAY) errors.push('Scheduled time must be in the future.');
    return errors;
  },

  checklist(c) {
    const s = Logic.stage(c);
    const after = (stage) => STAGES.indexOf(s) >= STAGES.indexOf(stage) || s === 'Failed';
    const items = [
      ['Idea created', true],
      ['Script generated', ['Generated', 'Needs Revision', 'Approved'].includes(c.script)],
      ['Script approved', c.script === 'Approved'],
      ['Image prompt created', c.script === 'Approved' || c.image !== 'Not Started'],
      ['Images generated', ['Generated', 'Needs Revision', 'Approved'].includes(c.image)],
      ['Final images selected', c.image === 'Approved'],
      ['Video generated', ['Generated', 'Needs Revision', 'Final'].includes(c.video)],
      ['Thumbnail selected', c.video === 'Final'],
      ['Title finalized', after('Video')],
      ['Description finalized', after('Review')],
      ['Hashtags added', after('Review')],
      ['Content reviewed', c.review === 'Approved'],
      ['Publishing schedule configured', ['Scheduled', 'Published', 'Failed'].includes(s)],
    ];
    return items.map(([label, done]) => ({ label, done: !!done }));
  },

  completion(c) {
    const list = Logic.checklist(c);
    return Math.round((list.filter((i) => i.done).length / list.length) * 100);
  },

  /** Derived "content status" shown in lists (one badge that summarises everything). */
  contentStatus(c) {
    const s = Logic.stage(c);
    return {
      Idea: 'Idea', Script: 'Script Pending', Images: 'Image Pending', Video: 'Video Pending',
      Review: 'In Review', Ready: 'Ready to Post', Scheduled: 'Scheduled', Published: 'Published', Failed: 'Failed',
    }[s];
  },

  counts() {
    const by = (fn) => DB.contents.filter(fn).length;
    return {
      total: DB.contents.length,
      ideas: by((c) => Logic.stage(c) === 'Idea'),
      scriptPending: by((c) => Logic.stage(c) === 'Script'),
      imagePending: by((c) => Logic.stage(c) === 'Images'),
      videoPending: by((c) => Logic.stage(c) === 'Video'),
      review: by((c) => Logic.stage(c) === 'Review'),
      ready: by((c) => Logic.stage(c) === 'Ready'),
      scheduled: by((c) => Logic.stage(c) === 'Scheduled'),
      published: by((c) => Logic.stage(c) === 'Published'),
      failed: DB.jobs.filter((j) => j.status === 'Failed' || j.status === 'Retry Scheduled').length,
      inProduction: by((c) => ['Idea', 'Script', 'Images', 'Video', 'Review'].includes(Logic.stage(c))),
    };
  },

  nextJob(contentId) {
    return Logic.jobsFor(contentId).find((j) => ['Waiting', 'Retry Scheduled', 'Processing'].includes(j.status));
  },

  upcomingJobs(limit = 99) {
    return DB.jobs
      .filter((j) => ['Waiting', 'Processing', 'Retry Scheduled'].includes(j.status) && new Date(j.scheduledAt) >= new Date(TODAY.toDateString()))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, limit);
  },
};
window.Logic = Logic;

// ---------- Formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const Fmt = {
  date(iso) { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; },
  short(iso) { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; },
  time(iso) { const d = new Date(iso); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); },
  dayLabel(iso) {
    const d = new Date(iso); const t = new Date(TODAY.toDateString());
    const diff = Math.round((new Date(d.toDateString()) - t) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },
  ago(iso) {
    const mins = Math.round((TODAY - new Date(iso)) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  },
  /** Local YYYY-MM-DD (avoids the UTC shift of toISOString). */
  key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  num(n) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n); },
};
window.Fmt = Fmt;
