// App shell: sidebar, top bar, notifications, and the shared dialogs
// (Create Content, Schedule Post). Mirrors `app/(app)/layout.tsx` in the future app.

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: 'index.html' },
  { key: 'content', label: 'Content', icon: 'clapperboard', href: 'content.html', count: () => DB.contents.length },
  { key: 'calendar', label: 'Content Calendar', icon: 'calendar-days', href: 'calendar.html' },
  { key: 'schedule', label: 'Schedule', icon: 'send', href: 'schedule.html', alert: () => DB.jobs.filter((j) => j.status === 'Failed').length },
  { key: 'media', label: 'Media Library', icon: 'images', href: 'media.html' },
  { key: 'accounts', label: 'Social Accounts', icon: 'share-2', href: 'accounts.html', alert: () => DB.accounts.filter((a) => a.status !== 'Connected').length },
  { key: 'analytics', label: 'Analytics', icon: 'chart-column', href: 'analytics.html' },
  { key: 'prompts', label: 'AI Prompts', icon: 'sparkles', href: 'prompts.html' },
  { key: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' },
];

function renderSidebar() {
  const page = document.body.dataset.page;
  const links = NAV.map((n) => {
    const active = n.key === page || (page === 'content-detail' && n.key === 'content');
    const count = n.count ? `<span class="ml-auto text-xs ${active ? 'text-olive-100' : 'text-stone-400'}">${n.count()}</span>` : '';
    const alertN = n.alert ? n.alert() : 0;
    const alert = alertN ? `<span class="ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center ${active ? 'bg-white text-rose-700' : 'bg-rose-100 text-rose-700'}">${alertN}</span>` : '';
    return `<a href="${n.href}" class="nav-link ${active ? 'active' : ''}">${UI.icon(n.icon)}<span>${n.label}</span>${alert || count}</a>`;
  }).join('');

  const html = `
    <div class="h-16 flex items-center gap-2.5 px-5 border-b border-[#efe9b4]">
      <span class="w-9 h-9 rounded-xl bg-olive-600 text-white flex items-center justify-center">${UI.icon('clapperboard', 'w-5 h-5')}</span>
      <div class="leading-tight">
        <p class="font-semibold text-stone-900">MediaFlow</p>
        <p class="text-[11px] text-stone-500">AI content studio</p>
      </div>
    </div>
    <nav class="flex-1 overflow-y-auto thin-scroll p-3 space-y-0.5">
      <p class="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Workspace</p>
      ${links}
    </nav>
    <div class="p-3 border-t border-[#efe9b4]">
      <div class="rounded-xl bg-white/70 border border-[#efe9b4] p-3">
        <div class="flex items-center justify-between text-xs"><span class="font-medium text-stone-700">Storage</span><span class="text-stone-500">18.4 / 50 GB</span></div>
        ${UI.progress(37, 'mt-2')}
      </div>
      <div class="flex items-center gap-3 px-2 pt-3">
        ${UI.avatar(DB.user.initials, 'w-8 h-8', 'bg-olive-600 text-white')}
        <div class="min-w-0 leading-tight"><p class="text-sm font-medium truncate">${DB.user.name}</p><p class="text-xs text-stone-500 truncate">Owner</p></div>
      </div>
    </div>`;

  const aside = document.getElementById('sidebar');
  aside.className = 'hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-[#FFFEE8] border-r border-[#efe9b4] z-40';
  aside.innerHTML = html;

  // Mobile drawer
  const drawer = document.createElement('div');
  drawer.id = 'mobile-nav';
  drawer.className = 'overlay !p-0 !items-stretch !justify-start';
  drawer.innerHTML = `<aside class="w-72 max-w-[85vw] bg-[#FFFEE8] h-full flex flex-col">${html}</aside>`;
  document.body.appendChild(drawer);
}

function renderTopbar() {
  const unread = DB.notifications.filter((n) => n.unread).length;
  const notifItems = DB.notifications.map((n) => `
    <a href="${n.href}" class="flex gap-3 p-3 rounded-lg hover:bg-[#f7f5e6] ${n.unread ? '' : 'opacity-75'}">
      ${UI.activityIcon(n.type)}
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2"><p class="text-sm font-medium text-stone-900">${n.title}</p>${n.unread ? '<span class="w-1.5 h-1.5 rounded-full bg-olive-600"></span>' : ''}</div>
        <p class="text-xs text-stone-600 mt-0.5">${n.text}</p>
        <p class="text-[11px] text-stone-400 mt-1">${Fmt.ago(n.at)}</p>
      </div>
    </a>`).join('');

  const header = document.getElementById('topbar');
  header.className = 'sticky top-0 z-30 h-16 bg-[#FFFDD0]/85 backdrop-blur border-b border-[#efe9b4]';
  header.innerHTML = `
    <div class="h-full flex items-center gap-3 px-4 md:px-8">
      <button class="btn btn-ghost btn-icon lg:hidden" data-open-modal="mobile-nav" aria-label="Open menu">${UI.icon('menu', 'w-5 h-5')}</button>
      <form action="content.html" class="relative flex-1 min-w-0 max-w-md">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">${UI.icon('search')}</span>
        <input name="q" class="input !pl-9 !pr-14 !bg-white/80" placeholder="Search title, tag, description…" />
        <kbd class="hidden sm:inline absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-stone-400 border border-stone-200 rounded px-1.5 py-0.5 bg-white">Ctrl K</kbd>
      </form>
      <div class="ml-auto flex items-center gap-2">
        <button class="btn btn-primary" data-open-modal="create-content">${UI.icon('plus')}<span class="hidden sm:inline">Create Content</span></button>
        <div class="relative">
          <button class="btn btn-outline btn-icon relative" data-dropdown-toggle="notif-menu" aria-label="Notifications">
            ${UI.icon('bell')}
            ${unread ? `<span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-olive-600 text-white text-[10px] font-semibold flex items-center justify-center">${unread}</span>` : ''}
          </button>
          <div id="notif-menu" class="dropdown w-[22rem] max-w-[calc(100vw-2rem)]">
            <div class="flex items-center justify-between px-4 py-3 border-b border-[#f1eedf]">
              <p class="font-semibold text-sm">Notifications</p>
              <button class="text-xs text-olive-700 font-medium hover:underline" onclick="UI.toast('All notifications marked as read')">Mark all read</button>
            </div>
            <div class="max-h-[60vh] overflow-y-auto thin-scroll p-1.5">${notifItems}</div>
          </div>
        </div>
        <div class="relative">
          <button class="rounded-full" data-dropdown-toggle="profile-menu" aria-label="Profile">${UI.avatar(DB.user.initials, 'w-9 h-9', 'bg-olive-600 text-white')}</button>
          <div id="profile-menu" class="dropdown w-56 p-1.5">
            <div class="px-3 py-2 border-b border-[#f1eedf] mb-1"><p class="text-sm font-medium">${DB.user.name}</p><p class="text-xs text-stone-500">${DB.user.email}</p></div>
            <a href="settings.html" class="menu-item">${UI.icon('user')}Profile</a>
            <a href="settings.html" class="menu-item">${UI.icon('settings')}Settings</a>
            <a href="accounts.html" class="menu-item">${UI.icon('share-2')}Social accounts</a>
            <button class="menu-item" onclick="UI.toast('Signed out (mock)','log-out')">${UI.icon('log-out')}Sign out</button>
          </div>
        </div>
      </div>
    </div>`;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); header.querySelector('input[name=q]').focus(); }
  });
}

// ---------- Create Content dialog ----------
function renderCreateContent() {
  const platformCards = DB.platforms.map((p) => `
    <label class="relative flex items-center gap-3 rounded-xl border border-[#e4e1cf] p-3 ${p.enabled ? 'cursor-pointer hover:border-olive-300 has-[:checked]:border-olive-600 has-[:checked]:bg-olive-50' : 'opacity-55 cursor-not-allowed'}">
      <input type="checkbox" name="platform" value="${p.id}" class="checkbox" ${p.enabled ? '' : 'disabled'} ${p.id === 'youtube' ? 'checked' : ''}>
      ${UI.platformLogo(p.id, 20)}
      <span class="text-sm font-medium">${p.name}</span>
      ${p.enabled ? '' : '<span class="ml-auto text-[10px] uppercase tracking-wide font-semibold text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">Soon</span>'}
    </label>`).join('');

  const opts = (list, sel) => list.map((v) => `<option ${v === sel ? 'selected' : ''}>${v}</option>`).join('');

  const el = document.createElement('div');
  el.id = 'create-content';
  el.className = 'overlay';
  el.innerHTML = `
    <form class="dialog dialog-lg" onsubmit="event.preventDefault(); UI.closeModal('create-content'); UI.toast('Content created — opening workspace'); setTimeout(()=>location.href='content-detail.html?id=c-110', 700)">
      <div class="flex items-start justify-between p-6 pb-4 border-b border-[#f1eedf]">
        <div><h2 class="text-lg font-semibold">Create content</h2><p class="text-sm text-stone-500 mt-0.5">Start with an idea — you can add the script, images and video later.</p></div>
        <button type="button" class="btn btn-ghost btn-icon" data-close-modal="create-content" aria-label="Close">${UI.icon('x')}</button>
      </div>
      <div class="p-6 space-y-7 max-h-[65vh] overflow-y-auto thin-scroll">
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Basic information</h3>
          <div class="grid sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2"><label class="label">Title <span class="text-rose-600">*</span></label><input required class="input" placeholder="e.g. 10 AI Tools That Will Replace Your Workflow"></div>
            <div class="sm:col-span-2"><label class="label">Content idea</label><textarea class="textarea" rows="2" placeholder="What is the hook? What format?"></textarea></div>
            <div class="sm:col-span-2"><label class="label">Description</label><textarea class="textarea" rows="2" placeholder="Short summary for the team and later for the post"></textarea></div>
            <div><label class="label">Category</label><select class="select">${opts(DB.categories)}</select></div>
            <div><label class="label">Content type</label><select class="select">${opts(['Long-form', 'Short', 'Reel'])}</select></div>
            <div><label class="label">Tags</label><input class="input" placeholder="ai tools, productivity"><p class="hint">Separate with commas</p></div>
            <div><label class="label">Target audience</label><input class="input" placeholder="e.g. YouTube creators"></div>
            <div><label class="label">Language</label><select class="select">${opts(['English', 'Khmer', 'Korean', 'Thai'])}</select></div>
          </div>
        </section>
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Target platforms</h3>
          <div class="grid sm:grid-cols-3 gap-2.5">${platformCards}</div>
        </section>
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Planning</h3>
          <div class="grid sm:grid-cols-2 gap-4">
            <div><label class="label">Priority</label>
              <div class="tabs w-full">${['High', 'Medium', 'Low'].map((p) => `<label class="tab flex-1 justify-center has-[:checked]:bg-white has-[:checked]:shadow-sm has-[:checked]:text-stone-900"><input type="radio" name="prio" class="sr-only" ${p === 'Medium' ? 'checked' : ''}>${p}</label>`).join('')}</div>
            </div>
            <div><label class="label">Target publish date</label><input type="date" class="input" value="2026-10-25"></div>
            <div><label class="label">Series</label><select class="select"><option value="">None</option>${opts(DB.series)}</select></div>
            <div><label class="label">Campaign</label><select class="select"><option value="">None</option>${opts(DB.campaigns)}</select></div>
          </div>
        </section>
      </div>
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 px-6 border-t border-[#f1eedf] bg-[#fcfbf3] rounded-b-2xl">
        <button type="button" class="btn btn-outline" data-close-modal="create-content">Cancel</button>
        <button type="button" class="btn btn-outline" onclick="UI.closeModal('create-content'); UI.toast('Saved as idea')">${UI.icon('lightbulb')}Save as idea</button>
        <button type="submit" class="btn btn-primary">${UI.icon('arrow-right')}Create & open workspace</button>
      </div>
    </form>`;
  document.body.appendChild(el);
}

// ---------- Schedule Post dialog ----------
function renderScheduleDialog() {
  const el = document.createElement('div');
  el.id = 'schedule-dialog';
  el.className = 'overlay';
  document.body.appendChild(el);
}

UI.openSchedule = function (contentId, platform = 'youtube') {
  const ready = DB.contents.filter((c) => Logic.readiness(c).ready);
  const c = Logic.content(contentId) || ready[0];
  const r = Logic.readiness(c);
  const tz = ['Asia/Phnom_Penh (GMT+7)', 'Asia/Seoul (GMT+9)', 'UTC', 'America/New_York (GMT-4)'];

  const el = document.getElementById('schedule-dialog');
  el.innerHTML = `
    <form class="dialog dialog-lg" id="schedule-form">
      <div class="flex items-start justify-between p-6 pb-4 border-b border-[#f1eedf]">
        <div><h2 class="text-lg font-semibold">Schedule post</h2><p class="text-sm text-stone-500 mt-0.5">One content item can have a separate schedule per platform.</p></div>
        <button type="button" class="btn btn-ghost btn-icon" data-close-modal="schedule-dialog" aria-label="Close">${UI.icon('x')}</button>
      </div>
      <div class="p-6 space-y-6 max-h-[68vh] overflow-y-auto thin-scroll">
        <div class="flex gap-4 items-center p-3 rounded-xl bg-[#fcfbf3] border border-[#f1eedf]">
          ${UI.thumb(c, 'w-24 h-14', { duration: true })}
          <div class="min-w-0 flex-1">
            <label class="label !mb-1">Content</label>
            <select class="select" id="sch-content">${DB.contents.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${x.title}${Logic.readiness(x).ready ? '' : ' — not ready'}</option>`).join('')}</select>
          </div>
        </div>

        ${r.ready ? '' : `
        <div class="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <p class="font-medium flex items-center gap-2">${UI.icon('triangle-alert')}This content isn't ready to post yet</p>
          <ul class="mt-2 ml-6 list-disc space-y-0.5">${r.missing.map((m) => `<li>${m.text}</li>`).join('')}</ul>
        </div>`}

        <div>
          <label class="label">Platform</label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2" id="sch-platforms">
            ${DB.platforms.slice(0, 4).map((p) => `
            <label class="flex items-center gap-2 rounded-xl border border-[#e4e1cf] px-3 h-11 text-sm font-medium ${p.enabled ? 'cursor-pointer has-[:checked]:border-olive-600 has-[:checked]:bg-olive-50' : 'opacity-50 cursor-not-allowed'}">
              <input type="radio" name="sch-platform" value="${p.id}" class="sr-only" ${p.id === platform ? 'checked' : ''} ${p.enabled ? '' : 'disabled'}>${UI.platformLogo(p.id, 18)}${p.name}
            </label>`).join('')}
          </div>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2"><label class="label" id="sch-account-label">Channel</label><select class="select" id="sch-account"></select></div>
          <div><label class="label">Date</label><input type="date" class="input" id="sch-date" value="2026-10-18"></div>
          <div><label class="label">Time</label><input type="time" class="input" id="sch-time" value="19:00"><p class="hint">${UI.icon('sparkles', 'w-3 h-3 inline -mt-0.5')} Best time for your audience: Sat 18:00</p></div>
          <div class="sm:col-span-2"><label class="label">Timezone</label><select class="select">${tz.map((t) => `<option>${t}</option>`).join('')}</select></div>
          <div class="sm:col-span-2"><label class="label">Title</label><input class="input" value="${c.title.replace(/"/g, '&quot;')}"><p class="hint">${c.title.length}/100 characters</p></div>
          <div class="sm:col-span-2"><label class="label" id="sch-caption-label">Description</label><textarea class="textarea" rows="4">${c.description}\n\n⏱ Chapters\n00:00 Intro\n00:42 Tool #1</textarea></div>
          <div class="sm:col-span-2"><label class="label">Hashtags</label><input class="input" value="${c.tags.map((t) => '#' + t.replace(/\s/g, '')).join(' ')}"></div>
        </div>

        <div>
          <label class="label">Thumbnail</label>
          <div class="flex gap-2.5">
            ${[0, 1, 2].map((i) => `<label class="cursor-pointer rounded-lg ring-offset-2 has-[:checked]:ring-2 has-[:checked]:ring-olive-600"><input type="radio" name="sch-thumb" class="sr-only" ${i === 0 ? 'checked' : ''}>${UI.thumb({ ...c, thumb: (c.thumb + i * 5) }, 'w-24 h-14')}</label>`).join('')}
            <button type="button" class="w-24 h-14 rounded-lg border border-dashed border-stone-300 text-stone-500 flex items-center justify-center hover:bg-stone-50">${UI.icon('upload')}</button>
          </div>
        </div>

        <div id="sch-visibility"></div>
        <div id="sch-errors"></div>
      </div>
      <div class="flex flex-col-reverse sm:flex-row sm:items-center gap-2 p-4 px-6 border-t border-[#f1eedf] bg-[#fcfbf3] rounded-b-2xl">
        <button type="button" class="btn btn-ghost sm:mr-auto" onclick="UI.toast('Saved — add the next platform schedule')">${UI.icon('plus')}Save & add another platform</button>
        <button type="button" class="btn btn-outline" data-close-modal="schedule-dialog">Cancel</button>
        <button type="submit" class="btn btn-primary">${UI.icon('calendar-check')}Schedule post</button>
      </div>
    </form>`;

  const form = el.querySelector('#schedule-form');
  const syncPlatform = () => {
    const p = form.querySelector('input[name=sch-platform]:checked')?.value;
    const accs = DB.accounts.filter((a) => a.platform === p);
    form.querySelector('#sch-account-label').textContent = p === 'facebook' ? 'Facebook Page' : 'YouTube channel';
    form.querySelector('#sch-caption-label').textContent = p === 'facebook' ? 'Caption' : 'Description';
    form.querySelector('#sch-account').innerHTML = accs.map((a) => `<option value="${a.id}">${a.name} — ${a.status}</option>`).join('');
    form.querySelector('#sch-visibility').innerHTML = p === 'youtube'
      ? `<label class="label">Visibility</label><div class="tabs">${['Public', 'Unlisted', 'Private'].map((v, i) => `<label class="tab has-[:checked]:bg-white has-[:checked]:text-stone-900 has-[:checked]:shadow-sm"><input type="radio" name="vis" class="sr-only" ${i === 0 ? 'checked' : ''}>${UI.icon(['globe', 'link', 'lock'][i])}${v}</label>`).join('')}</div>`
      : `<label class="label">Publish as</label><div class="tabs">${['Publish at scheduled time', 'Save as Page draft'].map((v, i) => `<label class="tab has-[:checked]:bg-white has-[:checked]:text-stone-900 has-[:checked]:shadow-sm"><input type="radio" name="vis" class="sr-only" ${i === 0 ? 'checked' : ''}>${v}</label>`).join('')}</div>`;
    UI.refreshIcons();
  };
  form.querySelectorAll('input[name=sch-platform]').forEach((i) => i.addEventListener('change', syncPlatform));
  form.querySelector('#sch-content').addEventListener('change', (e) => UI.openSchedule(e.target.value, form.querySelector('input[name=sch-platform]:checked')?.value));
  syncPlatform();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errors = Logic.validateSchedule({
      content: Logic.content(form.querySelector('#sch-content').value),
      platform: form.querySelector('input[name=sch-platform]:checked')?.value,
      accountId: form.querySelector('#sch-account').value,
      date: form.querySelector('#sch-date').value,
      time: form.querySelector('#sch-time').value,
    });
    const box = form.querySelector('#sch-errors');
    if (errors.length) {
      box.innerHTML = `<div class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p class="font-medium flex items-center gap-2">${UI.icon('circle-x')}Can't schedule yet</p><ul class="mt-2 ml-6 list-disc space-y-0.5">${errors.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
      UI.refreshIcons();
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    UI.closeModal('schedule-dialog');
    UI.toast('Post scheduled — added to publishing queue', 'calendar-check');
  });

  UI.openModal('schedule-dialog');
};

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  renderSidebar();
  renderTopbar();
  renderCreateContent();
  renderScheduleDialog();
  if (typeof window.renderPage === 'function') window.renderPage();
  UI.refreshIcons();
});
