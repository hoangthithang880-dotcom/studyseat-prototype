/* Real-service browser acceptance. Record a pass only after checking a visible or persisted outcome. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const output = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/prototype-ui-browser');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
const base = process.env.STUDYSEAT_TEST_URL;
const groups = [
  ['U01', 'student', '入口与身份', ['login-roles', 'login-password', 'login-invalid', 'login-valid', 'initialization-wait', 'exit-keep', 'exit-confirm', 'relogin', 'student-isolation']],
  ['S01', 'student', '首页', ['home-search', 'home-empty', 'home-clear-reset', 'home-scenes', 'home-conditions', 'home-query', 'available-only', 'immediate-pick', 'room-card']],
  ['S02', 'student', '房间与座位', ['room-back', 'date-picker', 'day-shortcuts', 'slot-shortcuts', 'start-end', 'search-seats', 'seat-zone', 'seat-disabled', 'seat-select', 'seat-retry', 'continue-booking']],
  ['S03', 'student', '确认与回执', ['agreement', 'confirm-back', 'confirm-submit', 'booking-receipt']],
  ['S04', 'student', '预约列表', ['booking-nav', 'booking-filter', 'booking-reload', 'booking-detail', 'new-booking', 'cancel-dismiss', 'cancel-submit', 'check-in', 'leave', 'return', 'finish']],
  ['S05', 'student', '个人页', ['profile-nav', 'profile-refresh', 'profile-return', 'profile-exit']],
  ['A01', 'admin', '规则配置', ['admin-login', 'rule-edit', 'rule-defaults', 'rule-draft-guard', 'rule-save', 'rule-late-receipt', 'admin-refresh']],
  ['A02', 'admin', '开放安排', ['open-tab', 'open-room', 'open-days', 'open-mode', 'open-start-end', 'opening-save']],
  ['A03', 'admin', '关闭预览', ['resources-nav', 'closure-new', 'closure-room-scope', 'closure-seat', 'closure-time-reason', 'closure-preview', 'closure-back', 'closure-confirm']],
  ['A04', 'admin', '关闭详情与重开', ['closure-detail', 'affected-reservations', 'return-to-closure', 'notification-preview', 'reopen']],
  ['A05', 'admin', '预约及日志', ['records-nav', 'record-filters', 'record-reset', 'record-detail', 'records-pagination', 'log-tab', 'log-detail', 'log-associated']],
  ['layout', 'shared', '屏幕和操作方式', ['desktop-width', 'mobile-375', 'mobile-390']],
];

const rows = Object.fromEntries(groups.flatMap(([page, role, state, controls]) => controls.map(control_id => [
  control_id, { control_id, page, role, state, action: '等待实际操作', expected: '观察页面变化和必要的真实业务结果',
    actual: '未执行', result: 'not_run', evidence: [], commit },
])));
let browserName = null;
let fatal = null;
const traffic = [];
const screenshotNames = [];

function report() {
  fs.mkdirSync(output, { recursive: true });
  const checks = Object.values(rows);
  fs.writeFileSync(path.join(output, 'AI-INTERACTION-AUDIT.json'),
    JSON.stringify({ commit, browser: browserName, fatal, checks, screenshots: screenshotNames }, null, 2) + '\n');
  const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const body = checks.map(row => [row.control_id, row.page, row.role, row.action, row.expected,
    row.actual, row.result, row.evidence.join(', ')].map(escape).join(' | ')).map(value => '| ' + value + ' |');
  fs.writeFileSync(path.join(output, 'AI-INTERACTION-AUDIT.md'), [
    '# AI 逐控件交互自检', '', `代码 \`${commit}\`，浏览器 ${browserName || '未启动'}。`, '',
    ...(fatal ? [`执行中断。 ${escape(fatal)}`, ''] : []),
    '| 控件 | 页面 | 身份 | 操作 | 预期 | 实际 | 结果 | 证据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |', ...body, '',
  ].join('\n'));
  fs.writeFileSync(path.join(output, 'network.json'), JSON.stringify(traffic, null, 2) + '\n');
}

async function check(ids, action, expected, work) {
  ids = Array.isArray(ids) ? ids : [ids];
  const before = traffic.length;
  for (const id of ids) Object.assign(rows[id], { action, expected });
  try {
    const outcome = await work();
    assert(outcome?.actual, 'The test must record the observed result.');
    for (const id of ids) Object.assign(rows[id], {
      actual: outcome.actual, result: 'passed',
      evidence: [...(outcome.evidence || []), ...traffic.slice(before).map(item => `network.json#${item.index}`)],
    });
    console.log(`PASS ${ids.join(', ')} ${outcome.actual}`);
  } catch (error) {
    for (const id of ids) Object.assign(rows[id], { actual: error.message, result: 'failed' });
    throw error;
  } finally {
    report();
  }
}

const text = async (locator, pattern) => {
  await locator.filter({ hasText: pattern }).first().waitFor({ state: 'visible' });
  return (await locator.first().innerText()).trim();
};
const read = async (page, endpoint) => {
  const res = await page.request.get(base + '/api/v1' + endpoint);
  assert(res.ok(), `GET ${endpoint} returned ${res.status()}`);
  return (await res.json()).data;
};
async function post(page, endpoint, body) {
  const { csrf_token: csrf } = await read(page, '/auth/session');
  return page.request.post(base + '/api/v1' + endpoint, { data: body, headers: { 'X-CSRF-Token': csrf } });
}

async function screenshot(page, name) {
  fs.mkdirSync(output, { recursive: true });
  const file = name + '.png';
  await page.screenshot({ path: path.join(output, file) });
  screenshotNames.push(file);
  return file;
}

async function fit(page) {
  assert(await page.evaluate(() => {
    const view = document.querySelector('main');
    return document.documentElement.scrollWidth <= innerWidth && view.scrollWidth <= view.clientWidth + 1;
  }), 'The main view has horizontal overflow');
}

const click = (page, selector) => page.locator(selector).click();
const selected = (page, selector) => page.locator(selector).getAttribute('aria-pressed');
const sheet = page => page.locator('dialog[open]');
const route = (page, name) => page.waitForURL(url => url.hash.slice(1).split('/')[0] === name);
const success = (actual, evidence = []) => ({ actual, evidence });
const waitApi = (page, endpoint, method) => page.waitForResponse(res =>
  new URL(res.url()).pathname === '/api/v1' + endpoint && res.request().method() === (method || 'GET'));

async function login(page, username = '832402116', password = '123456', admin = false) {
  await page.goto(base);
  if (admin) await click(page, '#admin-login');
  await page.locator('#account').fill(username);
  await page.locator('#password').fill(password);
  const reply = waitApi(page, '/auth/login', 'POST');
  await click(page, '#sign-in');
  assert.equal((await reply).status(), 200);
  await route(page, admin ? 'rules' : 'home');
}

async function logout(page, selector = '#global-exit') {
  await click(page, selector);
  await text(sheet(page), '确认退出当前账号');
  const reply = waitApi(page, '/auth/logout', 'POST');
  await click(page, '#sheet-confirm');
  assert.equal((await reply).status(), 200);
  await page.locator('#account').waitFor();
}

function observe(page, errors, role) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/')) traffic.push({
      index: traffic.length, role, method: response.request().method(), path: url.pathname, status: response.status(),
    });
  });
}

async function studentFlow(page) {
  await check(['login-roles', 'login-password', 'login-invalid'], '切换身份入口，切换密码显示，通过键盘提交错误密码',
    '账号标签、密码可见性更新，真实认证返回 401，并提示可继续登录', async () => {
      await page.goto(base);
      await click(page, '#admin-login');
      await page.getByLabel('管理员账号').waitFor();
      await click(page, '#student-login');
      await page.getByLabel('学生账号').fill('832402116');
      await page.getByLabel('密码', { exact: true }).fill('invalid-password');
      await click(page, '#show-password');
      assert.equal(await page.locator('#password').getAttribute('type'), 'text');
      await click(page, '#show-password');
      assert.equal(await page.locator('#password').getAttribute('type'), 'password');
      const response = waitApi(page, '/auth/login', 'POST');
      await page.locator('#password').press('Enter');
      assert.equal((await response).status(), 401);
      return success(await text(page.locator('#login-error'), /账号|密码/), [await screenshot(page, 'desktop-login')]);
    });
  await check(['login-valid', 'initialization-wait'], '修正密码，延迟真实房间目录回执再恢复',
    '登录中显示正在加载。目录返回后才出现真实房间和完整工作台', async () => {
    let release;
    let reached;
    const reachedServer = new Promise(resolve => { reached = resolve; });
    const unblock = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/rooms', async route => {
      const response = await route.fetch();
      reached(response.status());
      await unblock;
      await route.fulfill({ response });
    }, { times: 1 });
    try {
      await page.locator('#password').fill('123456');
      await click(page, '#sign-in');
      assert.equal(await Promise.race([reachedServer, new Promise(resolve => setTimeout(() => resolve(0), 7000))]), 200);
      await text(page.locator('main'), '正在加载房间和规则');
      assert.equal(await page.locator('[data-room]').count(), 0);
    } finally { release(); }
    await route(page, 'home');
    await text(page.locator('main'), '申子衡');
    assert(await page.locator('[data-room]').count() > 0);
    assert.equal(await page.getByText('数据持久化验证', { exact: true }).count(), 0);
    return success('加载期间不提前显示旧卡片。真实房间目录返回后进入学生首页。');
  });
  await check(['home-search', 'home-empty', 'home-clear-reset', 'home-scenes'], '输入匹配词、无匹配词、清空，按全天开放筛选再恢复全部', '卡片现场筛选，空结果有提示，可恢复', async () => {
    await page.locator('#room-search').fill('A101');
    assert.equal(await page.locator('[data-room]').count(), 1);
    await page.locator('#room-search').fill('无匹配项@');
    await text(page.locator('#room-list'), '没有符合条件');
    await click(page, '#clear-search');
    assert.equal(await page.locator('[data-room]').count(), 4);
    await click(page, '#all-day-rooms');
    assert.equal(await page.locator('[data-room]').count(), 1);
    assert.equal(await page.locator('[data-room]').first().getAttribute('data-room'), 'activity-24');
    await click(page, '#reset-home');
    assert.equal(await page.locator('[data-room]').count(), 4);
    return success('从四间到一间、空列表；全天开放筛出一间，然后恢复全部。');
  });
  await check(['home-conditions', 'home-query', 'available-only'], '展开首页查询、输入开始结束，查询后切换仅看有座',
    '请求真实余量并显示查询完成，过滤按钮的选中状态可往返', async () => {
      await click(page, '#home-conditions summary');
      await page.locator('#query-start').fill('10:00');
      await page.locator('#query-end').fill('11:00');
      await click(page, '#find-counts');
      await text(page.locator('#home-query-status'), '余量已更新');
      await text(page.locator('#room-list'), /所选时段余/);
      await click(page, '#only-available');
      assert.equal(await selected(page, '#only-available'), 'true');
      await click(page, '#only-available');
      assert.equal(await selected(page, '#only-available'), 'false');
      return success('查询结果和余量标签可见，过滤状态可切换。', [await screenshot(page, 'desktop-home')]);
    });
  await check(['immediate-pick', 'room-back', 'room-card'], '点击立即选座，再返回并用键盘 Enter 打开 A101',
    '两种入口打开座位页，返回恢复首页筛选与展开状态', async () => {
      await click(page, '#pick-now');
      await route(page, 'room');
      await click(page, '#global-back');
      await route(page, 'home');
      assert(await page.locator('#home-conditions[open]').count());
      await page.locator('[data-room="lib-a101"]').press('Enter');
      await route(page, 'room');
      await text(page.locator('h1'), 'A101');
      return success('选座入口、键盘打开 A101 和返回均到达对应页面。');
    });
  const day = await page.locator('[data-day]').nth(1).getAttribute('data-day');
  await check(['date-picker', 'day-shortcuts', 'slot-shortcuts', 'start-end', 'search-seats'], '切换快捷日期，改用日期输入、快捷时段和自定义时间，再查询',
    '日期、时间和座位结果随真实请求更新', async () => {
      const later = await page.locator('[data-day]').nth(2).getAttribute('data-day');
      await click(page, `[data-day="${later}"]`);
      assert.equal(await page.locator('#query-date').inputValue(), later);
      await page.locator('#query-date').fill(day);
      await click(page, '[data-slot="09:00/10:00"]');
      assert.equal(await page.locator('#query-start').inputValue(), '09:00');
      await page.locator('#query-start').fill('11:00');
      await page.locator('#query-end').fill('12:00');
      const response = waitApi(page, '/seats');
      await click(page, '#find-seats');
      const result = await response;
      assert(result.ok());
      const payload = (await result.json()).data;
      assert(payload.seats.length > 0 && payload.seat_catalog.length > payload.seats.length);
      await page.locator('[data-seat]').first().waitFor();
      return success('真实 API 响应含完整座位目录和有效余量，网格已显示。');
    });
  await check('seat-retry', '模拟一次查询失败，再用原控件重试真实服务',
    '失败有可见原因，按钮释放，第二次读取恢复网格', async () => {
      await page.route('**/api/v1/seats?*', route => route.abort(), { times: 1 });
      await click(page, '#find-seats');
      await text(page.locator('#seat-status'), '暂时无法连接');
      await click(page, '#find-seats');
      await page.locator('[data-seat]').first().waitFor();
      return success('连接错误已显示，重新查询恢复座位。');
    });
  await check(['seat-zone', 'seat-disabled', 'seat-select', 'continue-booking'], '切换到 D 区核对禁用座位，再按 Space 选择 A01 并确认选座',
    '只有真实可预约座位可选，继续打开正确确认页', async () => {
      await click(page, '[data-zone="D"]');
      assert.equal(await page.locator('[data-seat="lib-a101:D30"]').isEnabled(), false);
      await click(page, '[data-zone="A"]');
      await page.locator('[data-seat="lib-a101:A01"]').press('Space');
      assert.equal(await selected(page, '[data-seat="lib-a101:A01"]'), 'true');
      const image = await screenshot(page, 'desktop-room');
      await click(page, '#next-confirm');
      await route(page, 'confirm');
      await text(page.locator('main'), /A01 座/);
      return success('不可用座位禁用，A01 选择、时间与房间确认一致。', [image]);
    });
  let record;
  await check(['agreement', 'confirm-back', 'confirm-submit', 'booking-receipt'], '返回修改再确认，勾选须知，提交后关闭预约凭证',
    '选座草稿原样保留，真实 POST 创建，凭证编号与本人列表一致', async () => {
      await click(page, '#edit-booking');
      await route(page, 'room');
      assert.equal(await selected(page, '[data-seat="lib-a101:A01"]'), 'true');
      assert.equal(await page.locator('#query-end').inputValue(), '12:00');
      await click(page, '#next-confirm');
      assert.equal(await page.locator('#confirm-booking').isEnabled(), false);
      await page.locator('#agreement').check();
      const reply = waitApi(page, '/reservations', 'POST');
      await click(page, '#confirm-booking');
      const result = await reply;
      assert.equal(result.status(), 201);
      record = (await result.json()).data;
      await text(sheet(page), record.id);
      const image = await screenshot(page, 'desktop-booking-receipt');
      await click(page, '#sheet-cancel');
      await route(page, 'bookings');
      await text(page.locator('[data-record]'), '待签到');
      assert.equal((await read(page, '/reservations'))[0].id, record.id);
      return success(`成功凭证和真实本人记录一致 ${record.id}`, [image, await screenshot(page, 'desktop-bookings')]);
    });
  await check(['booking-nav', 'booking-filter', 'booking-reload', 'booking-detail', 'new-booking'],
    '查看时间线，切换分组、刷新，从去预约返回首页并再进入预约',
    '筛选有可见列表变化、详情含真实编号，刷新与导航保留已存记录', async () => {
      await click(page, '[data-record] summary');
      await text(page.locator('[data-record] details[open]'), record.id);
      await click(page, '[data-filter="CANCELLED"]');
      await text(page.locator('#booking-list'), '没有符合条件');
      await click(page, '[data-filter=""]');
      const reply = waitApi(page, '/reservations');
      await click(page, '#reload-bookings');
      assert((await reply).ok());
      await click(page, '#book-another');
      await route(page, 'home');
      await click(page, '[data-nav="bookings"]');
      await text(page.locator(`[data-record="${record.id}"]`), '待签到');
      return success('分组、详情、刷新、去预约与再进入本人列表可见。');
    });
  await check(['profile-nav', 'profile-refresh', 'profile-return', 'profile-exit', 'exit-keep', 'exit-confirm', 'relogin'],
    '从个人页刷新本人摘要、返回我的预约，退出先取消再确认，随后重登',
    '真实账号、摘要、取消退出、退出回执和重登后的预约均可见', async () => {
      await click(page, '[data-nav="profile"]');
      await text(page.locator('main'), '申子衡');
      await text(page.locator('#profile-summary'), '共 1 条');
      const reply = waitApi(page, '/reservations');
      await click(page, '#profile-reload');
      assert((await reply).ok());
      await click(page, '#profile-bookings');
      await route(page, 'bookings');
      await click(page, '[data-nav="profile"]');
      await click(page, '#profile-exit');
      await click(page, '#sheet-cancel');
      await page.locator('dialog[open]').waitFor({ state: 'hidden' });
      await text(page.locator('main'), '个人中心');
      const image = await screenshot(page, 'desktop-profile');
      await logout(page, '#profile-exit');
      assert.equal(await page.locator('#password').inputValue(), '');
      await login(page);
      await click(page, '[data-nav="bookings"]');
      await text(page.locator(`[data-record="${record.id}"]`), '待签到');
      return success('退出只在确认后发生，重登恢复同一预约，个人摘要来自真实数据。', [image]);
    });
  return { day, record };
}

async function adminFlow(page, student, { day, record }) {
  await check('admin-login', '以窗口的管理员入口登录', '真实身份只见管理员导航', async () => {
    await login(page, 'admin01', 'Admin1234', true);
    await text(page.locator('main'), '演示管理员');
    await page.locator('#current-rule-version').waitFor();
    assert.equal(await page.locator('[data-nav="profile"]').count(), 0);
    return success('管理员账号和工作台显示，学生个人页不在导航中。');
  });
  await check(['rule-edit', 'rule-defaults', 'rule-draft-guard', 'rule-save', 'rule-late-receipt', 'admin-refresh'],
    '读规则、载入默认值，修改后尝试离开，延迟首次写回执并编辑下一版，再保存',
    '离开保护有效，旧 POST 回执保留新草稿，最新值可由服务端重新读取', async () => {
      await click(page, '#rule-defaults');
      await text(page.locator('#feedback'), '已填入默认值');
      const field = page.locator('[data-rule="leave_limit_minutes"]');
      await field.fill('31');
      await click(page, '[data-nav="resources"]');
      await text(sheet(page), '有未保存内容');
      await click(page, '#sheet-cancel');
      assert.equal(await field.inputValue(), '31');
      await click(page, '#rule-save');
      let release;
      let reached;
      const reachedServer = new Promise(resolve => { reached = resolve; });
      const unblock = new Promise(resolve => { release = resolve; });
      await page.route('**/api/v1/admin/rules', async route => {
        const response = await route.fetch();
        reached(response.status());
        await unblock;
        await route.fulfill({ response });
      }, { times: 1 });
      try {
        await click(page, '#sheet-confirm');
        assert.equal(await Promise.race([reachedServer, new Promise(resolve => setTimeout(() => resolve(0), 7000))]), 200);
        await field.fill('32');
      } finally { release(); }
      await text(page.locator('#feedback'), '新编辑的草稿仍待保存');
      assert.equal(await field.inputValue(), '32');
      await click(page, '#rule-save');
      await click(page, '#sheet-confirm');
      await text(page.locator('#feedback'), '已保存规则 V3');
      assert.equal((await read(page, '/rules')).settings.leave_limit_minutes, 32);
      const refreshed = waitApi(page, '/rules');
      await click(page, '#admin-reload');
      assert((await refreshed).ok());
      return success('规则 31 的迟到回执保留草稿 32，单独保存后重新读取 V3。',
        [await screenshot(page, 'desktop-admin-rules')]);
    });
  await check(['open-tab', 'open-room', 'open-days', 'open-mode', 'open-start-end', 'opening-save'],
    '打开开放时段，切换到 24h 房间，选择星期，切换三种模式并保存自定义安排',
    '已保存安排和真实 GET /rooms 一致', async () => {
      await click(page, '[data-admin-tab="opening"]');
      await page.locator('#open-room').selectOption('east-b203');
      await page.locator('#open-mode').selectOption('closed');
      assert.equal(await page.locator('#open-start').count(), 0);
      await page.locator('#open-mode').selectOption('all_day');
      assert.equal(await page.locator('#open-end').count(), 0);
      await page.locator('#open-mode').selectOption('custom');
      await page.locator('#open-start').fill('06:00');
      await page.locator('#open-end').fill('24:00');
      const dayButton = page.locator('[data-weekday="1"]');
      if (await dayButton.getAttribute('aria-pressed') === 'false') await dayButton.click();
      await click(page, '#open-save');
      await text(sheet(page), '周二');
      const reply = waitApi(page, '/admin/rooms/east-b203/weekly-hours', 'POST');
      await click(page, '#sheet-confirm');
      assert((await reply).ok());
      await text(page.locator('#feedback'), '已保存周开放安排');
      assert.deepEqual((await read(page, '/rooms')).find(r => r.id === 'east-b203').weekly_hours[1], [360, 1440]);
      return success('用户选择的周二 06:00 至 24:00 已经持久化。',
        [await screenshot(page, 'desktop-admin-opening')]);
    });
  await check(['resources-nav', 'closure-new', 'closure-room-scope', 'closure-seat', 'closure-time-reason',
    'closure-preview', 'closure-back', 'closure-confirm'],
    '进入资源，选择房间和单座，设置时间和原因，预览、返回再预览、确认',
    '预览保持待签到不变，返回草稿完整，确认后原预约真实取消', async () => {
      await click(page, '[data-nav="resources"]');
      await click(page, '#new-closure');
      await page.locator('#close-room').selectOption('east-b203');
      await page.locator('#close-room').selectOption('lib-a101');
      await page.locator('#close-scope').selectOption('seat');
      await page.locator('#close-seat').selectOption('lib-a101:A01');
      await page.locator('#close-start').fill(day + 'T11:05');
      await page.locator('#close-end').fill(day + 'T11:55');
      await page.locator('#close-reason').fill('实际交互回归');
      await click(page, '#sheet-confirm');
      await text(sheet(page), '1 条受影响');
      assert.equal((await read(student, '/reservations/' + record.id)).status, 'PENDING_CHECKIN');
      await click(page, '#sheet-cancel');
      assert.equal(await page.locator('#close-reason').inputValue(), '实际交互回归');
      assert.equal(await page.locator('#close-end').inputValue(), day + 'T11:55');
      await click(page, '#sheet-confirm');
      await text(sheet(page), '1 条受影响');
      const image = await screenshot(page, 'desktop-admin-closure-preview');
      const response = waitApi(page, '/admin/closures', 'POST');
      await click(page, '#sheet-confirm');
      assert((await response).ok());
      await text(sheet(page), '取消预约 · 1 条');
      assert.equal((await read(student, '/reservations/' + record.id)).status, 'CANCELLED');
      return success('预览无写入。确认后同一条预约变为已取消，关闭详情显示一条。', [image]);
    });
  await check(['closure-detail', 'affected-reservations', 'return-to-closure', 'notification-preview', 'reopen'],
    '关闭并重开详情，查看影响预约、返回详情，打开通知预览，再确认重开',
    '关联预约唯一、返回正确、通知状态明确、重开持久化且取消记录保留', async () => {
      await click(page, '#sheet-cancel');
      await page.locator('[data-closure]').first().click();
      await text(sheet(page), '关闭记录详情');
      await click(page, '#see-affected');
      await route(page, 'records');
      await text(page.locator('main'), '共 1 条');
      await click(page, '#return-to-closure');
      await text(sheet(page), '关闭记录详情');
      await click(page, '#notice-preview');
      await text(sheet(page), '系统没有发送通知');
      await click(page, '#sheet-cancel');
      await click(page, '#reopen-closure');
      await click(page, '#sheet-confirm');
      await text(sheet(page), '已重新开放');
      assert.equal((await read(student, '/reservations/' + record.id)).status, 'CANCELLED');
      await click(page, '#sheet-cancel');
      return success('关联和详情来回可达，重开状态可见，取消记录没有复活。');
    });
  await check(['records-nav', 'record-filters', 'record-reset', 'record-detail', 'records-pagination', 'log-tab', 'log-detail', 'log-associated'],
    '清除关联，筛选不匹配的编号，重置后打开详情，从关闭相关日志再进入预约',
    '筛选和关联可改变记录，单页边界禁用，日志关联返回正确', async () => {
      await click(page, '[data-nav="records"]');
      await page.locator('#filter-key').waitFor();
      const association = page.locator('#clear-association');
      if (await association.count()) await association.click();
      await page.locator('#filter-key').fill('找不到的学号');
      await click(page, '#run-filters');
      await text(page.locator('main'), '未找到符合条件');
      await click(page, '#reset-filters');
      assert.equal(await page.locator('#previous-records').isEnabled(), false);
      assert.equal(await page.locator('#next-records').isEnabled(), false);
      await click(page, '[data-admin-booking]');
      await text(sheet(page), record.id);
      await click(page, '#sheet-cancel');
      await click(page, '[data-admin-tab="logs"]');
      const entry = page.locator('article').filter({ hasText: '资源关闭取消预约' }).first();
      await entry.locator('[data-log]').click();
      await text(sheet(page), '实际交互回归');
      await click(page, '[data-log-booking]');
      await text(sheet(page), '预约详情');
      await click(page, '#sheet-cancel');
      await text(sheet(page), '操作日志');
      await click(page, '#sheet-cancel');
      return success('查询、重置、分页边界、日志与预约详情关联往返均可见。',
        [await screenshot(page, 'desktop-admin-logs')]);
    });
}

async function attendanceFlow(page) {
  // Setup uses the real API to create a reservation within the live check-in window.
  const clock = await read(page, '/health');
  const now = Date.parse(clock.server_time);
  const start = new Date(now + 2 * 60000).toISOString();
  const end = new Date(now + 55 * 60000).toISOString();
  const response = await post(page, '/reservations', {
    seat_id: 'activity-24:A01', start_at: start, end_at: end, idempotency_key: 'audit-attendance-setup',
  });
  assert.equal(response.status(), 201);
  const record = (await response.json()).data;
  const card = page.locator(`[data-record="${record.id}"]`);
  await check(['cancel-dismiss', 'check-in', 'leave', 'return', 'finish'], '打开取消后返回；依次签到、暂离、返回、结束',
    '每个可见状态与服务端一致，暂离和返回传观察到的状态版本', async () => {
      await click(page, '[data-nav="bookings"]');
      await card.waitFor();
      await card.locator('[data-booking-action="cancel"]').click();
      await text(sheet(page), '取消预约');
      await click(page, '#sheet-cancel');
      assert.equal((await read(page, '/reservations/' + record.id)).status, 'PENDING_CHECKIN');
      for (const [action, status, label] of [
        ['check-in', 'IN_USE', '使用中'], ['leave', 'ON_LEAVE', '暂离中'],
        ['return', 'IN_USE', '使用中'], ['finish', 'COMPLETED', '已结束'],
      ]) {
        const observed = await read(page, '/reservations/' + record.id);
        await card.locator(`[data-booking-action="${action}"]`).click();
        const reply = waitApi(page, '/reservations/' + record.id + '/' + action, 'POST');
        await click(page, '#sheet-confirm');
        const result = await reply;
        assert(result.ok());
        if (['leave', 'return'].includes(action)) assert.equal(result.request().postDataJSON().expected_version, observed.state_version);
        await text(card.locator('.badge'), label);
        assert.equal((await read(page, '/reservations/' + record.id)).status, status);
      }
      return success('已依序观察到签到、暂离、返回与结束的服务端状态。');
    });
  await check('cancel-submit', '另设一条待签到预约后确认取消',
    '记录留在本人列表并成为 CANCELLED', async () => {
      const response = await post(page, '/reservations', {
        seat_id: 'activity-24:A02', start_at: start, end_at: end, idempotency_key: 'audit-cancel-setup',
      });
      assert.equal(response.status(), 201);
      const record = (await response.json()).data;
      const card = page.locator(`[data-record="${record.id}"]`);
      await click(page, '#reload-bookings');
      await card.locator('[data-booking-action="cancel"]').click();
      await click(page, '#sheet-confirm');
      await text(card.locator('.badge'), '已取消');
      assert.equal((await read(page, '/reservations/' + record.id)).status, 'CANCELLED');
      return success(`真实取消回执与界面一致 ${record.id}`);
    });
}

async function main() {
  if (process.argv.includes('--inventory')) {
    fatal = process.env.STUDYSEAT_AUDIT_BLOCKER || '本次仅生成控件清单，尚未执行浏览器验收。';
    report();
    return;
  }
  if (!base) throw new Error('Specify an isolated real service with STUDYSEAT_TEST_URL.');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  browserName = browser.version();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    observe(page, errors, 'student');
    const flow = await studentFlow(page);
    const other = await browser.newPage();
    observe(other, errors, 'other-student');
    await check('student-isolation', '用独立浏览上下文登录学生 B 并检查本人记录和后台权限',
      '学生 B 的列表看不到学生 A 的记录，访问管理 API 返回 403', async () => {
        await login(other, 'student02', 'Study1234');
        await click(other, '[data-nav="bookings"]');
        await text(other.locator('#booking-list'), '没有符合条件');
        assert.equal((await other.request.get(base + '/api/v1/admin/resources')).status(), 403);
        assert.equal((await other.request.get(base + '/api/v1/reservations/' + flow.record.id)).status(), 404);
        return success('本人视图、归属和管理员权限隔离有效。');
      });
    const admin = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    observe(admin, errors, 'admin');
    await adminFlow(admin, page, flow);
    await attendanceFlow(page);
    await check('desktop-width', '在桌面检查已验证页面的内容宽度',
      '桌面预约和管理页面没有横向溢出', async () => {
        await fit(page);
        await fit(admin);
        return success('桌面预约与管理日志宽度通过。');
      });
    for (const [width, height] of [[375, 812], [390, 844]]) {
      await check('mobile-' + width, `在 ${width}×${height} 触屏登录，触控房间卡片并查询座位`,
        '触屏导航、查询、网格实际可达且页面无横向溢出', async () => {
          const mobile = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
          observe(mobile, errors, 'mobile-student');
          try {
            await login(mobile, 'student02', 'Study1234');
            await mobile.locator('[data-room="lib-a101"]').tap();
            await route(mobile, 'room');
            await mobile.locator('#find-seats').tap();
            await mobile.locator('[data-seat]').first().waitFor();
            await fit(mobile);
            return success(`触屏在 ${width}px 宽度可进入房间并读到真实座位。`, [await screenshot(mobile, 'mobile-room-' + width)]);
          } finally {
            await mobile.close();
          }
        });
    }
    assert.deepEqual(errors, []);
    assert.equal(traffic.filter(item => ['student', 'mobile-student'].includes(item.role) && item.path.includes('/admin/')).length, 0);
    assert(Object.values(rows).every(row => row.result === 'passed'));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  fatal = error.message;
  console.error(error);
  process.exitCode = 1;
}).finally(report);
