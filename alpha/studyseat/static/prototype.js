import { createAdmin } from './prototype-admin.js';

const byId = id => document.getElementById(id);
const view = byId('view');
const dialog = byId('sheet');
const feedback = byId('feedback');
const beijing = 'Asia/Shanghai';
const labels = {
  PENDING_CHECKIN: '待签到', IN_USE: '使用中', ON_LEAVE: '暂离中',
  COMPLETED: '已结束', EXPIRED: '已超时', CANCELLED: '已取消',
};
const studentNav = [['home', '首页', '⌂'], ['room', '找座', '▤'], ['bookings', '预约', '▣'], ['profile', '我的', '♙']];
const adminNav = [['rules', '规则配置', '▤'], ['resources', '资源管理', '▦'], ['records', '记录日志', '◷']];
const titles = {
  home: '学生首页', room: '选择座位', confirm: '确认预约', bookings: '我的预约',
  profile: '个人中心', rules: '规则配置', resources: '资源管理', records: '记录日志',
};
const actions = {
  PENDING_CHECKIN: [['cancel', '取消预约'], ['check-in', '签到']],
  IN_USE: [['leave', '暂离'], ['finish', '结束使用']],
  ON_LEAVE: [['return', '返回座位'], ['finish', '结束使用']],
};

let identityVersion = 0;
let routeVersion = 0;
let seatVersion = 0;
let listVersion = 0;
let csrf = '';
let user;
let rooms;
let rules;
let clock = { server: Date.now(), client: Date.now() };
let admin;
let page = '';
let roomId = '';
let lastRoom = '';
let homeFilter = { search: '', onlyAvailable: false, allDay: false };
let homeQuery = null;
let homeCounts = null;
let homeParams = null;
let bookingDrafts = new Map();
let records = null;
let filter = '';
let pending = new Map();
let loginRole = 'student';
let sheetCancel;
let authBusy = false;
let authRecovery = null;

class Stale extends Error {}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const date = value => new Date(value).toLocaleDateString('sv-SE', { timeZone: beijing });
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: beijing, hour: '2-digit', minute: '2-digit' });
const stamp = value => value ? `${date(value)} ${time(value)}` : '—';
const minutes = value => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};
const minuteLabel = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const iso = (day, hm) => new Date(Date.parse(day + 'T00:00:00+08:00') + minutes(hm) * 60000).toISOString();
const clockNow = () => clock.server + (Date.now() - clock.client);
const localDay = (offset = 0) => date(clockNow() + offset * 86400000);
const weekday = day => (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
const hours = (room, day = localDay()) => room.weekly_hours?.[weekday(day)] ?? [room.opens_minute, room.closes_minute];
const hoursText = ([opens, closes]) => opens === null ? '不开放' : opens === 0 && closes === 1440 ? '全天开放' : `${minuteLabel(opens)}–${minuteLabel(closes)}`;
const badge = label => `<span class="badge">${html(label)}</span>`;
const on = (id, event, handler) => byId(id)?.addEventListener(event, handler);
const disabled = flag => flag ? ' disabled' : '';
const pressed = flag => ` aria-pressed="${Boolean(flag)}"`;
const urlId = id => encodeURIComponent(id);

function message(value = '', error = false) {
  feedback.hidden = !value;
  feedback.textContent = value;
  feedback.classList.toggle('error', error);
}

function acceptAuth(session) {
  if (dialog.open) dialog.close();
  ++identityVersion;
  ++routeVersion;
  ++seatVersion;
  ++listVersion;
  user = session.user;
  csrf = session.csrf_token;
  rooms = rules = records = null;
  lastRoom = filter = '';
  bookingDrafts = new Map();
  pending = new Map();
  homeFilter = { search: '', onlyAvailable: false, allDay: false };
  homeQuery = null;
  homeCounts = null;
  homeParams = null;
  admin = null;
}

async function api(path, body, isCurrent = () => true) {
  const epoch = identityVersion;
  let response, envelope;
  try {
    response = await fetch('/api/v1' + path, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {
        headers: user && path !== '/auth/session' && path !== '/health' ? { 'X-StudySeat-Session': csrf } : {},
      } : {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      }),
    });
    envelope = await response.json();
  } catch {
    if (epoch !== identityVersion || !isCurrent()) throw new Stale();
    throw new Error('暂时无法连接服务，请重试。');
  }
  if (epoch !== identityVersion || !isCurrent()) throw new Stale();
  if (!response.ok) {
    if (envelope.error?.code === 'AUTH_REQUIRED' || (user && envelope.error?.code === 'CSRF_INVALID')) {
      acceptAuth({ user: null, csrf_token: '' });
      void openSession('会话已更新，请确认当前账号。');
      throw new Stale();
    }
    throw Object.assign(new Error(envelope.error?.message || '请求失败，请重试。'), {
      code: envelope.error?.code, status: response.status,
    });
  }
  return envelope.data;
}

async function write(path, body) {
  const key = JSON.stringify([path, body]);
  if (!pending.has(key)) pending.set(key, crypto.randomUUID());
  try {
    const result = await api(path, { ...body, idempotency_key: pending.get(key) });
    pending.delete(key);
    return result;
  } catch (error) {
    if (error.status && error.status < 500) pending.delete(key);
    throw error;
  }
}

function errorText(error) {
  return error instanceof Stale ? '' : error.message;
}

async function perform(button, task) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    const value = errorText(error);
    if (value) message(value, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function closeSheet() { dialog.close(); }
function showSheet({ title, content, cancel = '关闭', confirm, submit, onCancel }) {
  const actions = byId('sheet-actions');
  byId('sheet-title').textContent = title;
  byId('sheet-content').innerHTML = content;
  byId('sheet-error').hidden = true;
  actions.innerHTML = `<button id="sheet-cancel" class="secondary" type="button">${html(cancel)}</button>
    ${confirm ? `<button id="sheet-confirm" class="primary" type="button">${html(confirm)}</button>` : ''}`;
  sheetCancel = onCancel || closeSheet;
  on('sheet-cancel', 'click', sheetCancel);
  if (submit) on('sheet-confirm', 'click', async event => {
    const original = event.currentTarget;
    const cancelButton = byId('sheet-cancel');
    original.disabled = cancelButton.disabled = true;
    const errorBox = byId('sheet-error');
    errorBox.hidden = true;
    try {
      await submit();
    } catch (error) {
      const value = errorText(error);
      if (value && original.isConnected) {
        errorBox.textContent = value;
        errorBox.hidden = false;
      }
      if (original.isConnected) original.disabled = cancelButton.disabled = false;
    }
  });
  if (!dialog.open) dialog.showModal();
  byId('sheet-cancel').focus();
}
dialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (!byId('sheet-cancel').disabled) sheetCancel();
});

function navigation() {
  const items = user.role === 'admin' ? adminNav : studentNav;
  const fallback = user.role === 'admin' ? 'rules' : 'home';
  const top = byId('top');
  top.hidden = byId('navigation').hidden = false;
  const back = page === 'confirm' ? 'room' : fallback;
  top.innerHTML = `${page === fallback ? '' : '<button id="global-back" class="ghost" type="button">‹ 返回</button>'}
    <strong>${titles[page]}</strong><button id="global-exit" class="danger" type="button">退出登录</button>`;
  on('global-back', 'click', () => move(back, roomId));
  on('global-exit', 'click', confirmLogout);
  byId('navigation').innerHTML = items.map(([to, name, icon]) => `<button type="button" data-nav="${to}"
    ${(page === to || (to === 'room' && page === 'confirm')) ? ' aria-current="page"' : ''}>
    <span class="nav-icon" aria-hidden="true">${icon}</span>${name}</button>`).join('');
  byId('navigation').querySelectorAll('[data-nav]').forEach(button => {
    button.onclick = () => move(button.dataset.nav, lastRoom);
  });
}

function routeTo(next, id = '', replace = false) {
  if (!user) return;
  const menu = user.role === 'admin' ? adminNav : studentNav;
  if (!menu.some(item => item[0] === next) && !(user.role === 'student' && next === 'confirm')) {
    next = menu[0][0];
  }
  if (next === 'room' || next === 'confirm') {
    const room = rooms?.find(item => item.enabled && item.id === (id || lastRoom))
      || rooms?.find(item => item.enabled);
    if (!room) next = 'home';
    id = room?.id || '';
  } else id = '';
  if (next === 'confirm' && !bookingDrafts.get(id)?.selected) next = 'room';
  const hash = `#${next}${id ? '/' + urlId(id) : ''}`;
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  const changed = page !== next || roomId !== id;
  if (dialog.open) dialog.close();
  const previousDraft = bookingDrafts.get(roomId);
  if (previousDraft) previousDraft.loading = false;
  page = next;
  roomId = id;
  if (id) lastRoom = id;
  ++routeVersion;
  ++seatVersion;
  message();
  navigation();
  if (user.role === 'admin') admin.render(page);
  else renderStudent();
  if (changed) {
    view.scrollTop = 0;
    view.focus({ preventScroll: true });
  }
}

function move(next, id = '', replace = false) {
  const run = () => routeTo(next, id, replace);
  if (admin?.dirty() && next !== page) {
    if (replace) history.replaceState(null, '', '#' + page);
    admin.guard(run);
  } else run();
}

function readRoute() {
  const [next, encoded = ''] = location.hash.slice(1).split('/');
  try { move(next, decodeURIComponent(encoded), true); }
  catch (error) {
    if (!(error instanceof URIError)) throw error;
    move('home', '', true);
  }
}
window.addEventListener('popstate', readRoute);

function renderLogin(note = '', error = false) {
  if (dialog.open) dialog.close();
  page = 'login';
  byId('top').hidden = byId('navigation').hidden = true;
  view.className = 'login';
  const adminLogin = loginRole === 'admin';
  view.innerHTML = `<section class="hero"><div class="brand-icon" aria-hidden="true">♧</div>
    <h1>Study Seat</h1><p>智慧校园自习室预约与座位管理系统</p></section>
    <section class="login-card" aria-label="登录 Study Seat">
      <div class="tabs" aria-label="登录入口">
        <button id="student-login" type="button"${pressed(!adminLogin)}>学生登录</button>
        <button id="admin-login" type="button"${pressed(adminLogin)}>管理员登录</button>
      </div>
      <form id="login-form">
        <label class="field">${adminLogin ? '管理员账号' : '学生账号'}<input id="account" name="username" autocomplete="username" required maxlength="100"></label>
        <label class="field" for="password">密码</label><div class="password">
          <input id="password" name="password" autocomplete="current-password" type="password" required maxlength="256">
          <button id="show-password" class="secondary" type="button" aria-label="显示密码" aria-pressed="false">显示</button>
        </div>
        <p id="login-error" class="error" role="alert" hidden></p>
        ${authRecovery ? '<button class="secondary full" id="retry-session" type="button">重新连接</button>' : ''}
        <p class="muted">账号权限由服务器确定。</p>
        <button id="sign-in" class="primary full" type="submit"${disabled(!csrf || authBusy)}>登录</button>
      </form>
    </section><footer class="login-footer">福州大学 · 软件工程实践课程</footer>`;
  const toggle = (role, id) => {
    if (loginRole === role) return;
    const name = byId('account').value;
    loginRole = role;
    renderLogin();
    byId('account').value = name;
    byId(id).focus();
  };
  on('student-login', 'click', () => toggle('student', 'student-login'));
  on('admin-login', 'click', () => toggle('admin', 'admin-login'));
  on('show-password', 'click', event => {
    const password = byId('password');
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? '隐藏' : '显示';
    event.currentTarget.setAttribute('aria-pressed', String(show));
    event.currentTarget.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  });
  on('retry-session', 'click', () => void openSession());
  on('login-form', 'submit', async event => {
    event.preventDefault();
    if (authBusy || !csrf) return;
    const button = byId('sign-in');
    const failure = byId('login-error');
    failure.hidden = true;
    button.disabled = authBusy = true;
    for (const id of ['student-login', 'admin-login']) byId(id).disabled = true;
    try {
      const session = await api('/auth/login', {
        username: byId('account').value.trim(), password: byId('password').value,
      });
      acceptAuth(session);
      await initialize(false);
    } catch (problem) {
      const value = errorText(problem);
      if (value && failure.isConnected) {
        failure.textContent = value;
        failure.hidden = false;
      }
      if (problem.code === 'CSRF_INVALID') void openSession('会话已更新，请重新登录。');
    } finally {
      authBusy = false;
      if (button.isConnected) {
        button.disabled = false;
        for (const id of ['student-login', 'admin-login']) byId(id).disabled = false;
      }
    }
  });
  view.scrollTop = 0;
  message(note, error);
}

async function openSession(note = '') {
  if (!user) {
    authRecovery = null;
    renderLogin(note);
  }
  try {
    const session = await api('/auth/session');
    acceptAuth(session);
    if (user) await initialize(true);
    else {
      const signIn = byId('sign-in');
      if (signIn && !byId('retry-session')) {
        signIn.disabled = authBusy || !csrf;
        message(note);
      } else renderLogin(note);
    }
  } catch (error) {
    if (error instanceof Stale) return;
    authRecovery = true;
    renderLogin(error.message, true);
  }
}

async function initialize(restore) {
  const epoch = identityVersion;
  view.className = '';
  view.innerHTML = '<p class="notice" role="status">正在加载房间和规则…</p>';
  try {
    const [identity, catalog, applicable, health] = await Promise.all([
      api('/me'), api('/rooms'), api('/rules'), api('/health'),
    ]);
    user = identity;
    rooms = catalog;
    rules = applicable;
    clock = { server: Date.parse(health.server_time), client: Date.now() };
    if (user.role === 'admin') admin = createAdmin({
      api, write, view, html, badge, disabled, pressed, on, byId, date, stamp, clockNow, iso,
      localDay, hoursText, minutes, minuteLabel, showSheet, closeSheet, message, perform, errorText,
      labels, user, active: () => epoch === identityVersion,
    });
    if (restore) readRoute();
    else routeTo(user.role === 'admin' ? 'rules' : 'home', '', true);
  } catch (error) {
    if (epoch !== identityVersion) return;
    view.innerHTML = `<p class="notice error" role="alert">${html(error.message)}</p>
      <button class="secondary" id="retry-load">重新加载工作台</button>
      <button class="danger" id="exit-load">退出登录</button>`;
    on('retry-load', 'click', () => void initialize(restore));
    on('exit-load', 'click', confirmLogout);
  }
}

function confirmLogout() {
  const prompt = () => showSheet({
    title: '退出登录', content: '<p>确认退出当前账号？</p>', cancel: '继续使用', confirm: '确认退出',
    submit: async () => {
      const session = await api('/auth/logout', {});
      const wasAdmin = user.role === 'admin';
      acceptAuth(session);
      history.replaceState(null, '', location.pathname + location.search);
      loginRole = wasAdmin ? 'admin' : 'student';
      renderLogin('已退出登录。');
    },
  });
  if (admin?.dirty()) admin.guard(prompt);
  else prompt();
}

function defaultSlot(day, room) {
  const [opens, closes] = hours(room, day);
  const min = day === localDay() ? minutes(time(clockNow())) + 1 : 0;
  const start = Math.max(opens ?? 0, Math.ceil(min / 30) * 30);
  const end = Math.min(closes ?? 0, start + Math.min(60, rules.settings.max_duration_minutes));
  return start < end ? [minuteLabel(start), minuteLabel(end)] : ['', ''];
}

function dateInputs(draft, withDays = true) {
  const max = rules.settings.max_advance_days;
  return `<label class="field">预约日期（北京时间）<input id="query-date" type="date" min="${localDay()}" max="${localDay(max)}" value="${html(draft.day)}" required></label>
    ${withDays ? `<div class="days" aria-label="日期快捷项">${Array.from({ length: Math.min(7, max + 1) }, (_, offset) => {
      const day = localDay(offset);
      return `<button data-day="${day}" type="button"${pressed(draft.day === day)}><small>${offset === 0 ? '今天' : offset === 1 ? '明天' : '周' + '一二三四五六日'[weekday(day)]}</small>${Number(day.slice(-2))}</button>`;
    }).join('')}</div>` : ''}
    <div class="columns">
      <label class="field">开始<input id="query-start" type="time" value="${html(draft.start)}" required></label>
      <label class="field">结束（可填 24:00）<input id="query-end" value="${html(draft.end)}" placeholder="10:00" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00" required></label>
    </div>`;
}

function renderStudent() {
  view.className = '';
  ({ home: renderHome, room: renderRoom, confirm: renderConfirm, bookings: renderBookings, profile: renderProfile })[page]();
}

function queryBody(draft) {
  return { start_at: iso(draft.day, draft.start), end_at: iso(draft.day, draft.end) };
}

function getDraft(room) {
  if (!bookingDrafts.has(room.id)) {
    const day = localDay(1);
    const [start, end] = defaultSlot(day, room);
    bookingDrafts.set(room.id, {
      day, start, end, selected: '', zone: '', availability: null, loading: false, agreed: false,
    });
  }
  return bookingDrafts.get(room.id);
}

function renderHome() {
  const next = rooms.find(room => room.enabled);
  const day = localDay(1);
  const [start, end] = next ? defaultSlot(day, next) : ['', ''];
  homeQuery ??= { day, start, end, expanded: false };
  const search = homeFilter.search;
  view.innerHTML = `<section class="summary">
    <small>智慧校园自习空间</small><h1>你好，${html(user.display_name)}</h1>
    <p>选择自习室，再选合适的时段与座位。</p>
    <button id="pick-now" class="secondary" type="button"${disabled(!next)}>立即选座</button>
    </section>
    <div class="heading"><label class="field full">搜索自习室<input id="room-search" type="search" value="${html(search)}" placeholder="自习室或教学楼"></label>
      <button id="clear-search" class="secondary" type="button"${disabled(!search)}>清空搜索</button></div>
    <div class="heading"><h2>按场景找座</h2><button id="reset-home" class="secondary" type="button">查看全部</button></div>
    <div class="scene-tiles" aria-label="按场景筛选">
      <button type="button" disabled>静音自习</button><button type="button" disabled>小组研讨</button>
      <button id="all-day-rooms" class="ghost" type="button"${pressed(homeFilter.allDay)}>全天开放</button>
      <button type="button" disabled>电脑工位</button>
    </div><p class="muted">静音、研讨和工位分类暂无房间目录数据。</p>
    <details class="card" id="home-conditions"${homeQuery.expanded ? ' open' : ''}>
      <summary>调整查询日期与时段</summary>
      <form id="home-query">${dateInputs(homeQuery, false)}<button id="find-counts" class="secondary" type="submit">查询各房间余量</button></form>
      <p id="home-query-status" role="status" class="muted"></p>
    </details>
    <div class="heading"><h2>推荐自习室</h2><button id="only-available" class="ghost" type="button"${disabled(!homeCounts?.size)}${pressed(homeFilter.onlyAvailable)}>仅看有座</button></div>
    <p id="room-count" class="muted"></p>
    <p id="availability-hint" class="muted"${homeCounts?.size ? ' hidden' : ''}>先查询所选时段，再筛选有座房间。</p>
    <div id="room-list"></div>`;
  function cards() {
    const keyword = homeFilter.search.trim().toLowerCase();
    const found = rooms.filter(room => `${room.name} ${room.location}`.toLowerCase().includes(keyword)
      && (!homeFilter.onlyAvailable || homeCounts?.get(room.id) > 0)
      && (!homeFilter.allDay || (room.enabled && hoursText(hours(room, homeQuery.day)) === '全天开放')));
    byId('room-count').textContent = `共 ${found.length} 间`;
    byId('room-list').innerHTML = found.length ? found.map(room => {
      const icon = room.id === 'activity-24' ? '24h' : /[1234]F/.exec(room.location)?.[0] || '⌂';
      const text = `<span aria-hidden="true" class="room-tile">${icon}</span><span><strong>${html(room.name)}</strong>
        <small>${html(room.location)}</small><small>${room.seat_count} 座 · ${hoursText(hours(room, homeQuery.day))}</small>
        ${homeCounts?.has(room.id) ? badge(`所选时段余 ${homeCounts.get(room.id)} 座`) : ''}</span>`;
      return room.enabled ? `<a class="card room-card" data-room="${html(room.id)}" href="#room/${urlId(room.id)}">${text}<span aria-hidden="true">›</span></a>`
        : `<div class="card room-card" aria-disabled="true">${text}<small>已停用</small></div>`;
    }).join('') : '<p class="empty">没有符合条件的房间。</p>';
    view.querySelectorAll('[data-room]').forEach(link => link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const room = rooms.find(item => item.id === link.dataset.room);
      const draft = getDraft(room);
      if (homeParams && !draft.availability && !draft.selected) {
        Object.assign(draft, homeParams);
      }
      move('room', room.id);
    }));
  }
  const changeSearch = value => {
    homeFilter.search = value;
    byId('room-search').value = value;
    byId('clear-search').disabled = !value;
    cards();
  };
  on('pick-now', 'click', () => move('room', next.id));
  on('room-search', 'input', event => changeSearch(event.target.value));
  on('clear-search', 'click', () => {
    changeSearch('');
    byId('room-search').focus();
  });
  on('reset-home', 'click', () => {
    homeFilter = { search: '', onlyAvailable: false, allDay: false };
    byId('only-available').setAttribute('aria-pressed', 'false');
    byId('all-day-rooms').setAttribute('aria-pressed', 'false');
    changeSearch('');
    message('已恢复全部房间。');
  });
  on('all-day-rooms', 'click', event => {
    homeFilter.allDay = !homeFilter.allDay;
    event.currentTarget.setAttribute('aria-pressed', String(homeFilter.allDay));
    cards();
  });
  on('home-conditions', 'toggle', event => { homeQuery.expanded = event.target.open; });
  for (const [id, key] of [['query-date', 'day'], ['query-start', 'start'], ['query-end', 'end']]) {
    on(id, 'input', event => {
      homeQuery[key] = event.target.value;
      ++seatVersion;
      homeCounts = homeParams = null;
      homeFilter.onlyAvailable = false;
      byId('find-counts').disabled = false;
      byId('only-available').disabled = true;
      byId('availability-hint').hidden = false;
      byId('only-available').setAttribute('aria-pressed', 'false');
      byId('home-query-status').textContent = '时段已改变，请重新查询。';
      cards();
    });
  }
  on('only-available', 'click', event => {
    homeFilter.onlyAvailable = !homeFilter.onlyAvailable;
    event.currentTarget.setAttribute('aria-pressed', String(homeFilter.onlyAvailable));
    cards();
  });
  on('home-query', 'submit', event => {
    event.preventDefault();
    const query = queryBody(homeQuery);
    const version = ++seatVersion;
    const stillCurrent = () => page === 'home' && seatVersion === version;
    const status = byId('home-query-status');
    void perform(byId('find-counts'), async () => {
      status.textContent = '正在查询各房间余量…';
      const settled = await Promise.allSettled(rooms.filter(room => room.enabled).map(async room => {
        const result = await api('/seats?' + new URLSearchParams({ ...query, room_id: room.id }), undefined, stillCurrent);
        return [room.id, result.seats.length];
      }));
      if (!stillCurrent()) return;
      homeCounts = new Map(settled.filter(result => result.status === 'fulfilled').map(result => result.value));
      homeParams = { day: homeQuery.day, start: homeQuery.start, end: homeQuery.end };
      byId('only-available').disabled = !homeCounts.size;
      byId('availability-hint').hidden = Boolean(homeCounts.size);
      status.textContent = settled.some(result => result.status === 'rejected')
        ? '有房间无法查询，请检查开放时段或重试。' : '所选时段的余量已更新。';
      cards();
    });
  });
  cards();
}

function renderRoom() {
  const room = rooms.find(item => item.id === roomId);
  const draft = getDraft(room);
  // A new route invalidates requests started by the old DOM.
  if (!draft.availability && !draft.loading) draft.selected = '';
  const available = draft.availability;
  const zoneOf = seat => /^[A-Z]+/i.exec(seat.label)?.[0] || '其他';
  const zones = [...new Set((available?.seat_catalog || []).map(zoneOf))];
  if (!zones.includes(draft.zone)) draft.zone = zones[0] || '';
  const seats = available?.seat_catalog.filter(seat => zoneOf(seat) === draft.zone) || [];
  const selected = available?.seat_catalog.find(seat => seat.id === draft.selected && seat.available);
  const [opens, closes] = hours(room, draft.day);
  const suggestions = [540, 840, 1080].filter(start =>
    opens !== null && opens <= start && start + Math.min(60, rules.settings.max_duration_minutes) <= closes
    && (draft.day !== localDay() || start > minutes(time(clockNow()))));
  view.innerHTML = `<section class="room-art" aria-label="自习室空间示意"><div aria-hidden="true" class="window"></div>
    <div aria-hidden="true" class="shelf">${'<i></i>'.repeat(7)}</div><div aria-hidden="true" class="desk"></div><small>空间示意</small></section>
    ${badge('需预约')}<div class="heading"><h1>${html(room.name)}</h1>
      <button type="button" disabled title="暂无收藏功能" aria-label="收藏暂不可用">♡</button></div>
    <p class="muted">${html(room.location)} · 暂无地图导航与评价</p>
    <div class="stats"><div><small>开放时间</small><strong>${hoursText(hours(room, draft.day))}</strong></div>
    <div><small>座位总数</small><strong>${room.seat_count} 座</strong></div>
    <div><small>所选时段空位</small><strong>${available ? available.seats.length + ' 座' : '待查询'}</strong></div></div>
    <form id="room-query"><div class="heading"><h2>选择日期</h2></div>
      <p class="muted">最多提前 ${rules.settings.max_advance_days} 天，每次最多 ${rules.settings.max_duration_minutes} 分钟。</p>
      ${dateInputs(draft)}<div class="heading"><h2>选择时段</h2></div>
      ${suggestions.length ? `<div class="tabs">${suggestions.map(start => {
        const from = minuteLabel(start), to = minuteLabel(start + Math.min(60, rules.settings.max_duration_minutes));
        return `<button data-slot="${from}/${to}" type="button"${pressed(draft.start === from && draft.end === to)}>${from}–${to}</button>`;
      }).join('')}</div>` : ''}
      <button id="find-seats" class="secondary full" type="submit"${disabled(draft.loading)}>查询可预约座位</button>
    </form>
    <div class="heading"><h2>选择座位</h2></div><p class="muted">座位排列为示意。不可选可能因关闭、停用或时段冲突。</p>
    <p id="seat-status" role="status" class="${draft.error ? 'notice error' : 'muted'}">${html(draft.loading ? '正在查询座位…' : draft.error || (available ? (available.seats.length ? '请选择一个可预约座位。' : '所选条件下没有可预约座位，请更换时段。') : '请先查询所选日期和时段。'))}</p>
    ${zones.length ? `<div class="tabs" aria-label="座位分区">${zones.map(zone => `<button type="button" data-zone="${html(zone)}"${pressed(zone === draft.zone)}>${html(zone)} 区</button>`).join('')}</div>` : ''}
    ${seats.length ? '<div class="card seat-map"><p class="muted">浅蓝可选 · 深蓝已选 · 灰色不可预约</p>' : ''}
    <div class="seat-grid">${seats.map(seat => `<button data-seat="${html(seat.id)}" type="button"
      aria-label="${html(seat.label)} 座${seat.available ? '' : ' 不可预约'}"${pressed(selected?.id === seat.id)}${disabled(!seat.available)}>${html(seat.label)}</button>`).join('')}</div>${seats.length ? '</div>' : ''}
    <div class="checkout"><div><strong>${selected ? html(selected.label) + ' 座' : '还未选择座位'}</strong><br>
      <small>${html(draft.day)} · ${html(draft.start || '—')}–${html(draft.end || '—')}</small></div>
      <button id="next-confirm" class="primary" type="button"${disabled(!selected)}>确认选座 →</button></div>`;
  const invalidate = () => {
    ++seatVersion;
    draft.loading = false;
    draft.error = '';
    draft.availability = null;
    draft.selected = '';
    draft.agreed = false;
  };
  const updateConditions = (element, key) => {
    draft[key] = element.value;
    invalidate();
    if (key === 'day' && element.validity.valid) {
      [draft.start, draft.end] = defaultSlot(draft.day, room);
      renderRoom();
      byId('query-date').focus();
    } else {
      // Preserve the editor and caret while custom times are being typed.
      byId('find-seats').disabled = false;
      byId('next-confirm').disabled = true;
      byId('seat-status').textContent = '条件已变化，请重新查询。';
      view.querySelector('.seat-map')?.remove();
      view.querySelector('[aria-label="座位分区"]')?.remove();
      view.querySelector('.stats > div:last-child strong').textContent = '待查询';
      view.querySelector('.checkout strong').textContent = '还未选择座位';
      view.querySelector('.checkout small').textContent = `${draft.day} · ${draft.start || '—'}–${draft.end || '—'}`;
      view.querySelectorAll('[data-slot]').forEach(item =>
        item.setAttribute('aria-pressed', String(item.dataset.slot === `${draft.start}/${draft.end}`)));
    }
  };
  for (const [id, key] of [['query-date', 'day'], ['query-start', 'start'], ['query-end', 'end']]) {
    on(id, 'input', event => updateConditions(event.target, key));
  }
  view.querySelectorAll('[data-day]').forEach(button => button.onclick = () => {
    draft.day = button.dataset.day;
    [draft.start, draft.end] = defaultSlot(draft.day, room);
    invalidate();
    renderRoom();
    view.querySelector(`[data-day="${draft.day}"]`).focus();
  });
  view.querySelectorAll('[data-slot]').forEach(button => button.onclick = () => {
    [draft.start, draft.end] = button.dataset.slot.split('/');
    invalidate();
    renderRoom();
    view.querySelector(`[data-slot="${button.dataset.slot}"]`).focus();
  });
  on('room-query', 'submit', async event => {
    event.preventDefault();
    const previousSeat = draft.selected;
    invalidate();
    const version = seatVersion;
    const current = () => version === seatVersion && page === 'room' && room.id === roomId;
    const payload = queryBody(draft);
    draft.loading = true;
    renderRoom();
    try {
      draft.availability = await api('/seats?' + new URLSearchParams({ ...payload, room_id: room.id }), undefined, current);
      if (draft.availability.seats.some(seat => seat.id === previousSeat)) draft.selected = previousSeat;
    } catch (error) {
      if (current()) draft.error = errorText(error);
    } finally {
      if (current()) {
        draft.loading = false;
        renderRoom();
        byId('find-seats').focus({ preventScroll: true });
      }
    }
  });
  view.querySelectorAll('[data-zone]').forEach(button => button.onclick = () => {
    draft.zone = button.dataset.zone;
    renderRoom();
    Array.from(view.querySelectorAll('[data-zone]')).find(item => item.dataset.zone === draft.zone)?.focus();
  });
  view.querySelectorAll('[data-seat]').forEach(button => button.onclick = () => {
    draft.selected = button.dataset.seat;
    draft.agreed = false;
    renderRoom();
    Array.from(view.querySelectorAll('[data-seat]')).find(item => item.dataset.seat === draft.selected)?.focus();
  });
  on('next-confirm', 'click', () => move('confirm', room.id));
}

function renderConfirm() {
  const draft = bookingDrafts.get(roomId);
  const room = rooms.find(item => item.id === roomId);
  const seat = draft.availability.seats.find(item => item.id === draft.selected);
  const expectedRoute = routeVersion;
  view.innerHTML = `<div class="heading"><h1>确认预约</h1></div>
    <article class="card"><h2>${html(room.name)}</h2><p class="muted">${html(room.location)}</p>
      <div class="stats"><div><small>日期</small><strong>${html(draft.day)}</strong></div>
      <div><small>时间</small><strong>${html(draft.start)}–${html(draft.end)}</strong></div>
      <div><small>座位</small><strong>${html(seat.label)} 座</strong></div></div></article>
    <section class="notice"><h2>预约须知</h2><p>签到窗口为开始前 ${rules.settings.check_in_early_minutes} 分钟至开始后 ${rules.settings.check_in_late_minutes} 分钟。预约到点结束。</p>
    <p>暂离上限 ${rules.settings.leave_limit_minutes} 分钟。</p>
    <label class="check"><input type="checkbox" disabled>签到提醒（消息服务未开启）</label></section>
    <label class="check card"><input type="checkbox" id="agreement"${draft.agreed ? ' checked' : ''}>我已阅读预约与签到规则</label>
    <div class="checkout"><button id="edit-booking" class="secondary" type="button">返回修改</button>
      <button id="confirm-booking" class="primary" type="button"${disabled(!draft.agreed)}>确认预约</button></div>`;
  on('agreement', 'change', event => {
    draft.agreed = event.target.checked;
    byId('confirm-booking').disabled = !draft.agreed;
  });
  on('edit-booking', 'click', () => move('room', room.id));
  on('confirm-booking', 'click', event => void perform(event.currentTarget, async () => {
    const id = room.id;
    try {
      const result = await write('/reservations', { seat_id: seat.id, ...queryBody(draft) });
      ++listVersion;
      records = null;
      if (bookingDrafts.get(id) === draft) bookingDrafts.delete(id);
      if (routeVersion !== expectedRoute) {
        if (page === 'bookings' || page === 'profile') void loadRecords();
        return;
      }
      const showBookings = () => routeTo('bookings', '', true);
      showSheet({
        title: '预约成功', cancel: '关闭预约凭证', onCancel: showBookings,
        content: `<p>${html(result.room_name)} · ${html(result.seat_label)} 座</p>
          <p>${stamp(result.start_at)} 至 ${stamp(result.end_at)}（北京时间）</p><p>预约编号 ${html(result.id)}</p>`,
      });
      byId('confirm-booking').hidden = true;
    } catch (error) {
      if (routeVersion !== expectedRoute) return;
      if (['RESOURCE_UNAVAILABLE', 'RESERVATION_CONFLICT', 'TIME_INVALID'].includes(error.code)) {
        draft.availability = null;
        draft.selected = '';
        routeTo('room', room.id, true);
      }
      throw error;
    }
  }));
}

async function loadRecords() {
  const version = ++listVersion;
  const route = routeVersion;
  const expected = page;
  const current = () => version === listVersion && route === routeVersion && page === expected;
  const state = byId('list-status');
  if (state) state.textContent = '正在加载预约…';
  try {
    const next = await api('/reservations', undefined, current);
    if (!current()) return;
    records = next;
    if (page === 'bookings') paintBookings();
    else paintProfile();
    if (state) {
      state.textContent = '预约已更新。';
      state.classList.remove('error');
    }
  } catch (error) {
    if (current() && state) {
      state.textContent = errorText(error);
      state.classList.toggle('error', Boolean(state.textContent));
    }
  }
}

function renderBookings() {
  view.innerHTML = `<div class="heading"><div><small>北京时间</small><h1>我的预约</h1></div>
    <button id="book-another" class="primary" type="button">＋ 去预约</button></div>
    <section id="booking-summary" class="summary"></section>
    <div id="booking-tabs" class="tabs" aria-label="预约状态筛选"></div>
    <div class="heading"><span id="booking-count"></span><button id="reload-bookings" class="secondary" type="button">刷新预约</button></div>
    <p id="list-status" role="status" class="muted"></p><div id="booking-list"></div>`;
  on('book-another', 'click', () => move('home'));
  on('reload-bookings', 'click', () => void loadRecords());
  paintBookings();
  void loadRecords();
}

function paintBookings() {
  const list = records || [];
  byId('booking-summary').innerHTML = list.length
    ? `<small>本人预约记录</small><p><strong>${list.length}</strong> 条 · ${list.filter(row => row.status === 'COMPLETED').length} 条已结束</p>`
    : '<p>本人预约记录</p>';
  byId('booking-tabs').innerHTML = Object.entries({ '': '全部', ...labels }).map(([key, label]) => `<button type="button" data-filter="${key}"${pressed(key === filter)}>${label}</button>`).join('');
  const visible = list.filter(row => !filter || row.status === filter);
  byId('booking-count').textContent = records ? `共 ${visible.length} 条` : '预约记录';
  byId('booking-list').innerHTML = visible.length ? visible.map(row => `<article class="card booking-card" data-record="${html(row.id)}">
    <div class="heading">${badge(labels[row.status])}<small>规则 V${row.rule_version_id}</small></div>
    <h2>${html(row.room_name)} · ${html(row.seat_label)} 座</h2>
    <p>${stamp(row.start_at)} 至 ${stamp(row.end_at)}</p>
    ${row.leave_deadline && row.status === 'ON_LEAVE' ? `<p>请于 ${stamp(row.leave_deadline)} 前返回。</p>` : ''}
    <details><summary>查看时间线</summary><p>创建 ${stamp(row.created_at)}</p>
      ${row.checked_in_at ? `<p>签到 ${stamp(row.checked_in_at)}</p>` : ''}
      ${row.ended_at ? `<p>结束 ${stamp(row.ended_at)}</p>` : ''}<small>预约编号 ${html(row.id)}</small></details>
    ${actions[row.status] ? `<div class="actions">${actions[row.status].map(([key, label]) =>
      `<button data-booking-action="${key}" class="${key === 'cancel' ? 'secondary' : 'primary'}" type="button">${label}</button>`).join('')}</div>` : ''}</article>`).join('')
    : records ? '<p class="empty">没有符合条件的预约。</p>' : '';
  view.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
    filter = button.dataset.filter;
    paintBookings();
    view.querySelector(`[data-filter="${filter}"]`)?.focus();
  });
  view.querySelectorAll('[data-booking-action]').forEach(button => button.onclick = () => {
    const id = button.closest('[data-record]').dataset.record;
    const row = list.find(record => record.id === id);
    const action = button.dataset.bookingAction;
    const title = button.textContent;
    showSheet({
      title, cancel: '返回', confirm: `确认${title}`,
      content: `<p>${html(row.room_name)} · ${html(row.seat_label)} 座</p>
        ${action === 'check-in' ? '<p>请确认本人已到场。系统将按服务器时间校验签到窗口。</p>' : ''}`,
      submit: async () => {
        try {
          if (action === 'cancel') await api(`/reservations/${urlId(id)}/cancel`, {});
          else await write(`/reservations/${urlId(id)}/${action}`,
            ['leave', 'return'].includes(action) ? { expected_version: row.state_version } : {});
          closeSheet();
          message(`${title}已完成。`);
          await loadRecords();
        } catch (error) {
          if (error.status === 409) await loadRecords();
          throw error;
        }
      },
    });
  });
}

function renderProfile() {
  view.innerHTML = `<div class="heading"><h1>个人中心</h1></div><section class="summary"><small>校园账号</small>
    <h2>${html(user.display_name)}</h2><p>${html(user.username)} · 学生</p></section>
    <article class="card"><h2>预约记录摘要</h2><div id="profile-summary"></div>
      <p id="list-status" role="status" class="muted"></p><div class="actions">
      <button id="profile-bookings" class="primary" type="button">查看我的预约</button>
      <button id="profile-reload" class="secondary" type="button">刷新摘要</button></div></article>
    <section class="card"><h2>个人设置</h2>
      <p class="muted">学习趋势、签到提醒和收藏尚无业务数据。</p></section>
    <button id="profile-exit" class="danger full" type="button">退出登录</button>`;
  on('profile-bookings', 'click', () => move('bookings'));
  on('profile-reload', 'click', () => void loadRecords());
  on('profile-exit', 'click', confirmLogout);
  paintProfile();
  void loadRecords();
}

function paintProfile() {
  byId('profile-summary').innerHTML = records
    ? `<p>共 ${records.length} 条预约，${records.filter(row => row.status === 'COMPLETED').length} 条已结束。</p>` : '';
}

void openSession();
