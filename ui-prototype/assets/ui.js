// Reusable UI "components" for the static prototype. Each returns an HTML string,
// mirroring the React components planned in `components/` (StatusBadge, PlatformIcon, ...).

const BADGE_VARIANT = {
  // neutral
  'Not Started': 'neutral', Draft: 'neutral', 'Not Ready': 'neutral', Idea: 'neutral', Disconnected: 'neutral', 'Prompt Not Created': 'neutral', Waiting: 'neutral',
  // in progress
  Generating: 'progress', Editing: 'progress', Publishing: 'progress', Processing: 'progress', 'In Review': 'progress',
  'Script Pending': 'progress', 'Image Pending': 'progress', 'Video Pending': 'progress', 'Prompt Ready': 'progress',
  // produced, awaiting approval
  Generated: 'info', Selected: 'info',
  // attention
  'Needs Revision': 'warn', 'Changes Requested': 'warn', 'Retry Scheduled': 'warn', 'Token Expired': 'warn',
  // failure
  Failed: 'danger', Error: 'danger',
  // done
  Approved: 'success', Final: 'success', Published: 'success', Connected: 'success',
  // scheduling
  Scheduled: 'scheduled',
  'Ready to Post': 'solid', Ready: 'solid',
};

const PLATFORM = {
  youtube: { name: 'YouTube', color: '#e34948' },
  facebook: { name: 'Facebook', color: '#2a78d6' },
  youtube_shorts: { name: 'YouTube Shorts', color: '#e34948' },
  facebook_reels: { name: 'Facebook Reels', color: '#2a78d6' },
  tiktok: { name: 'TikTok', color: '#1c1b17' },
  instagram: { name: 'Instagram', color: '#c13584' },
};

const THUMBS = [
  ['#556B2F', '#A9BC85'], ['#3d4a5c', '#8ea3b8'], ['#7a5a2f', '#d4b483'], ['#6b4f4f', '#c9a9a6'],
  ['#2f4f4f', '#7fa8a3'], ['#4a5d23', '#c2c78a'], ['#5c4a3d', '#b8a088'], ['#3b3f58', '#9a9cc4'],
  ['#6b5b2f', '#e0c97a'], ['#2f3b2f', '#8faf8f'], ['#584a3e', '#a8957f'], ['#40513b', '#9dc08b'],
  ['#5a3e2b', '#c69f73'], ['#2e4053', '#85a3c0'], ['#4b3b2b', '#b5835a'], ['#3e4f3a', '#b6c79b'],
];

const UI = {
  icon(name, cls = 'w-4 h-4') { return `<i data-lucide="${name}" class="${cls}"></i>`; },

  refreshIcons() { if (window.lucide) lucide.createIcons(); },

  badge(value, extra = '') {
    if (!value) return '';
    const v = BADGE_VARIANT[value] || 'neutral';
    const dot = v === 'solid' ? '' : '<span class="dot"></span>';
    return `<span class="badge badge-${v} ${extra}">${dot}${value}</span>`;
  },

  platformLogo(p, size = 16) {
    const s = size;
    if (p === 'youtube' || p === 'youtube_shorts') {
      return `<svg style="flex-shrink:0" width="${s}" height="${s}" viewBox="0 0 24 24" aria-label="YouTube" role="img"><rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#e34948"/><path d="M10 9v6l5.2-3z" fill="#fff"/></svg>`;
    }
    if (p === 'facebook' || p === 'facebook_reels') {
      return `<svg style="flex-shrink:0" width="${s}" height="${s}" viewBox="0 0 24 24" aria-label="Facebook" role="img"><circle cx="12" cy="12" r="11" fill="#2a78d6"/><path d="M13.2 19v-6h2l.3-2.4h-2.3V9.2c0-.7.2-1.2 1.2-1.2h1.2V5.9c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.7H8.8V13h2v6z" fill="#fff"/></svg>`;
    }
    if (p === 'tiktok') {
      return `<svg style="flex-shrink:0" width="${s}" height="${s}" viewBox="0 0 24 24" aria-label="TikTok" role="img"><rect width="24" height="24" rx="6" fill="#1c1b17"/><path d="M14.5 5.5c.4 1.6 1.5 2.7 3 2.9v2.3c-1.1 0-2.1-.3-3-.9v4.4a3.9 3.9 0 1 1-3.9-3.9v2.3a1.6 1.6 0 1 0 1.6 1.6V5.5z" fill="#fff"/></svg>`;
    }
    if (p === 'instagram') {
      return `<svg style="flex-shrink:0" width="${s}" height="${s}" viewBox="0 0 24 24" aria-label="Instagram" role="img"><rect width="24" height="24" rx="6" fill="#c13584"/><rect x="6" y="6" width="12" height="12" rx="3.5" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="15.6" cy="8.4" r=".9" fill="#fff"/></svg>`;
    }
    return '';
  },

  platformChip(p) {
    return `<span class="inline-flex items-center gap-1.5 text-xs text-stone-600">${UI.platformLogo(p, 14)}${PLATFORM[p]?.name || p}</span>`;
  },

  platformStack(list = []) {
    return `<span class="inline-flex items-center -space-x-1">${list.map((p) => `<span class="rounded-full ring-2 ring-white bg-white">${UI.platformLogo(p, 18)}</span>`).join('')}</span>`;
  },

  thumb(c, cls = 'w-16 h-10', opts = {}) {
    const [a, b] = THUMBS[(c.thumb ?? 0) % THUMBS.length];
    const ico = opts.icon || (c.type === 'Short' ? 'smartphone' : (Logic.stage(c) === 'Idea' ? 'lightbulb' : 'clapperboard'));
    const dur = opts.duration && c.duration ? `<span class="dur">${c.duration}</span>` : '';
    return `<div class="thumb ${cls}" style="background: linear-gradient(135deg, ${a}, ${b})">${UI.icon(ico)}${dur}</div>`;
  },

  progress(pct, cls = '') {
    return `<div class="progress ${cls}"><span style="width:${pct}%"></span></div>`;
  },

  priority(p) {
    const map = { High: ['chevrons-up', 'text-rose-700'], Medium: ['chevron-up', 'text-amber-700'], Low: ['chevron-down', 'text-stone-500'] };
    const [ico, color] = map[p] || map.Low;
    return `<span class="prio ${color}">${UI.icon(ico)}${p}</span>`;
  },

  /** Compact 4-step production indicator: Script / Images / Video / Review */
  miniSteps(c) {
    const steps = [
      ['S', 'Script', c.script, c.script === 'Approved'],
      ['I', 'Images', c.image, c.image === 'Approved'],
      ['V', 'Video', c.video, c.video === 'Final'],
      ['R', 'Review', c.review, c.review === 'Approved'],
    ];
    return `<div class="flex items-center gap-1">${steps.map(([k, label, status, done]) => {
      const busy = ['Generating', 'Editing', 'In Review', 'Generated'].includes(status);
      const warn = ['Needs Revision', 'Changes Requested'].includes(status);
      const cls = done ? 'bg-olive-600 text-white' : warn ? 'bg-orange-100 text-orange-800 ring-1 ring-orange-200' : busy ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-stone-100 text-stone-400';
      return `<span title="${label}: ${status}" class="w-6 h-6 rounded-md text-[10px] font-semibold flex items-center justify-center ${cls}">${k}</span>`;
    }).join('')}</div>`;
  },

  avatar(initials, cls = 'w-8 h-8', bg = 'bg-olive-100 text-olive-800') {
    return `<span class="${cls} ${bg} rounded-full inline-flex items-center justify-center text-xs font-semibold shrink-0">${initials}</span>`;
  },

  empty(icon, title, text, action = '') {
    return `<div class="empty"><div class="ico">${UI.icon(icon, 'w-5 h-5')}</div><p class="font-medium text-stone-800">${title}</p><p class="text-sm mt-1 max-w-sm">${text}</p>${action ? `<div class="mt-4">${action}</div>` : ''}</div>`;
  },

  activityIcon(type) {
    const map = {
      script: ['file-text', 'bg-olive-50 text-olive-700'], image: ['image', 'bg-olive-50 text-olive-700'], video: ['film', 'bg-olive-50 text-olive-700'],
      schedule: ['calendar-clock', 'bg-violet-50 text-violet-700'], published: ['circle-check', 'bg-olive-100 text-olive-800'],
      failed: ['triangle-alert', 'bg-rose-50 text-rose-700'], idea: ['lightbulb', 'bg-amber-50 text-amber-700'], review: ['message-square-warning', 'bg-orange-50 text-orange-700'],
      token: ['key-round', 'bg-orange-50 text-orange-700'], ready: ['rocket', 'bg-olive-100 text-olive-800'], scheduled: ['calendar-clock', 'bg-violet-50 text-violet-700'], incomplete: ['circle-dashed', 'bg-amber-50 text-amber-700'],
    };
    const [ico, cls] = map[type] || ['dot', 'bg-stone-100 text-stone-600'];
    return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cls}">${UI.icon(ico, 'w-4 h-4')}</span>`;
  },

  // ---------- Overlays ----------
  openModal(id) { document.getElementById(id)?.classList.add('open'); document.body.style.overflow = 'hidden'; UI.refreshIcons(); },
  closeModal(id) { document.getElementById(id)?.classList.remove('open'); if (!document.querySelector('.overlay.open')) document.body.style.overflow = ''; },

  toast(msg, icon = 'circle-check') {
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${UI.icon(icon)}<span>${msg}</span>`;
    root.appendChild(el);
    UI.refreshIcons();
    setTimeout(() => el.remove(), 2800);
  },

  /** Generic confirmation dialog for destructive actions. */
  confirm({ title, text, confirmLabel = 'Delete', danger = true, onConfirm }) {
    let el = document.getElementById('confirm-dialog');
    if (!el) { el = document.createElement('div'); el.id = 'confirm-dialog'; el.className = 'overlay'; document.body.appendChild(el); }
    el.innerHTML = `
      <div class="dialog dialog-sm mt-[18vh]" role="alertdialog" aria-modal="true">
        <div class="p-6">
          <div class="flex gap-4">
            <span class="w-10 h-10 rounded-full ${danger ? 'bg-rose-50 text-rose-700' : 'bg-olive-50 text-olive-700'} flex items-center justify-center shrink-0">${UI.icon(danger ? 'trash-2' : 'circle-help', 'w-5 h-5')}</span>
            <div><h3 class="font-semibold text-stone-900">${title}</h3><p class="text-sm text-stone-600 mt-1">${text}</p></div>
          </div>
          <div class="flex justify-end gap-2 mt-6">
            <button class="btn btn-outline" data-close>Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmLabel}</button>
          </div>
        </div>
      </div>`;
    el.querySelector('[data-close]').onclick = () => UI.closeModal('confirm-dialog');
    el.querySelector('[data-ok]').onclick = () => { UI.closeModal('confirm-dialog'); onConfirm && onConfirm(); };
    UI.openModal('confirm-dialog');
  },

  copy(text, label = 'Copied to clipboard') {
    navigator.clipboard?.writeText(text).catch(() => {});
    UI.toast(label, 'copy');
  },

  /** Wire segmented tabs: buttons with [data-tab] inside container, panels with [data-panel]. */
  tabs(container, onChange) {
    const root = typeof container === 'string' ? document.querySelector(container) : container;
    if (!root) return;
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        const key = btn.dataset.tab;
        document.querySelectorAll(`[data-panel-group="${root.id}"] > [data-panel]`).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== key));
        onChange && onChange(key);
      });
    });
  },
};
window.UI = UI;
window.PLATFORM = PLATFORM;

// Global listeners: close overlays on backdrop/Escape, toggle dropdowns
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-dropdown-toggle]');
  document.querySelectorAll('.dropdown.open').forEach((d) => { if (!toggle || d.id !== toggle.dataset.dropdownToggle) if (!d.contains(e.target)) d.classList.remove('open'); });
  if (toggle) { document.getElementById(toggle.dataset.dropdownToggle)?.classList.toggle('open'); }
  if (e.target.classList.contains('overlay')) UI.closeModal(e.target.id);
  const closer = e.target.closest('[data-close-modal]');
  if (closer) UI.closeModal(closer.dataset.closeModal);
  const opener = e.target.closest('[data-open-modal]');
  if (opener) UI.openModal(opener.dataset.openModal);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach((o) => UI.closeModal(o.id));
});
