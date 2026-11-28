/* New prototype UI: real HTTP responses, controlled delivery and explicit completion. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const base = process.env.STUDYSEAT_TEST_URL;
const output = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/prototype-async');
const checks = [];
const errors = [];
const releases = new Set();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const click = (page, selector) => page.locator(selector).click();
const visible = (page, selector, value) => page.locator(selector).filter({ hasText: value }).first().waitFor();
const recordCard = (page, record) => page.locator(`[data-record="${record.id}"]`);
let browser;

function report() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
    commit, browser: browser?.version(), checks, page_errors: errors,
  }, null, 2) + '\n');
}

async function test(name, work) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({ name, message: error.message }));
  // Mark completion after the application has consumed JSON or handled a fetch failure.
  // A task boundary drains its promise chain; this is a signal, not a fixed sleep.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.__settled = {};
    window.fetch = async (...args) => {
      const key = new URL(args[0], location.href).pathname;
      const done = () => setTimeout(() => { window.__settled[key] = (window.__settled[key] || 0) + 1; }, 0);
      try {
        const response = await original(...args);
        const json = response.json.bind(response);
        response.json = async () => { try { return await json(); } finally { done(); } };
        return response;
      } catch (error) { done(); throw error; }
    };
  });
  try {
    await work(page);
    checks.push({ name, result: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({ name, result: 'failed', error: error.message });
    await page.screenshot({ path: path.join(output, name + '-failure.png') }).catch(() => {});
    console.error('FAIL ' + name + ': ' + error.message);
    process.exitCode = 1;
  } finally {
    for (const release of releases) release();
    releases.clear();
    await page.unrouteAll({ behavior: 'wait' });
    await context.close();
    report();
  }
}

async function read(page, endpoint) {
  const response = await page.request.get(base + '/api/v1' + endpoint);
  assert(response.ok(), endpoint + ': ' + response.status());
  return (await response.json()).data;
}
async function post(page, endpoint, body) {
  const { csrf_token } = await read(page, '/auth/session');
  return page.request.post(base + '/api/v1' + endpoint, {
    data: body, headers: { 'X-CSRF-Token': csrf_token },
  });
}
async function login(page, other = false) {
  await page.goto(base);
  await page.locator('#account').fill(other ? 'student02' : '832402116');
  await page.locator('#password').fill(other ? 'Study1234' : '123456');
  await click(page, '#sign-in');
  await page.locator('[data-room="lib-a101"]').waitFor();
}
async function room(page, start = '10:00', end = '11:00', seat = 'A01') {
  await click(page, '[data-nav="home"]');
  await click(page, '[data-room="lib-a101"]');
  await page.locator('#query-start').fill(start);
  await page.locator('#query-end').fill(end);
  await click(page, '#find-seats');
  await page.locator(`[data-seat="lib-a101:${seat}"]`).waitFor();
}
async function confirm(page, seat = 'A01') {
  await click(page, `[data-seat="lib-a101:${seat}"]`);
  await click(page, '#next-confirm');
  await page.locator('#agreement').check();
}
async function gate(page, endpoint, { method = 'GET', fail = false, csrfError = false, abort = false } = {}) {
  const ready = deferred(), release = deferred(), delivered = deferred();
  const pattern = url => new URL(url).pathname === '/api/v1' + endpoint;
  let claimed = false;
  const handler = async route => {
    if (claimed || route.request().method() !== method) return route.fallback();
    claimed = true;
    const response = await route.fetch(csrfError ? {
      headers: { ...route.request().headers(), 'X-StudySeat-Session': 'obsolete-session-token' },
    } : {});
    const body = await response.json();
    ready.resolve({ status: response.status(), body });
    await release.promise;
    try {
      if (abort) await route.abort();
      else if (fail) await route.fulfill({ status: 503, json: { error: { code: 'REVIEW_TEMPORARY', message: '受控读取失败' } } });
      else await route.fulfill({ response });
    } finally { delivered.resolve(); }
  };
  await page.route(pattern, handler);
  const unblock = () => release.resolve();
  releases.add(unblock);
  return {
    ready: ready.promise,
    async finish() {
      const key = '/api/v1' + endpoint;
      const previous = await page.evaluate(key => window.__settled[key] || 0, key);
      unblock();
      await delivered.promise;
      await page.waitForFunction(({ key, previous }) => (window.__settled[key] || 0) > previous, { key, previous });
      await page.unroute(pattern, handler);
      releases.delete(unblock);
    },
  };
}
async function cleanup(page, id) {
  if (id) assert((await post(page, '/reservations/' + id + '/cancel', {})).ok());
}

async function draftReceipt(page) {
  await login(page);
  await room(page);
  await confirm(page);
  const held = await gate(page, '/reservations', { method: 'POST' });
  let saved;
  try {
    await click(page, '#confirm-booking');
    const response = await held.ready;
    assert.equal(response.status, 201);
    saved = response.body.data;
    await click(page, '#global-back');
    await page.locator('#query-start').fill('13:00');
    await page.locator('#query-end').fill('14:00');
    await click(page, '#find-seats');
    await click(page, '[data-seat="lib-a101:A02"]');
    await held.finish();
    await click(page, '[data-nav="home"]');
    await click(page, '[data-room="lib-a101"]');
    assert.equal(await page.locator('#query-start').inputValue(), '13:00');
    assert.equal(await page.locator('#query-end').inputValue(), '14:00');
    assert.equal(await page.locator('[data-seat="lib-a101:A02"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await read(page, '/reservations/' + saved.id)).start_at, saved.start_at);
    await page.screenshot({ path: path.join(output, 'new-draft-preserved.png') });
  } finally { await cleanup(page, saved?.id); }
}

async function reserve(page, { start = '10:00', end = '11:00', seat = 'A01' } = {}) {
  const health = await read(page, '/health');
  const day = new Date(Date.parse(health.server_time) + 86400000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const response = await post(page, '/reservations', {
    seat_id: 'lib-a101:' + seat, start_at: day + 'T' + start + ':00+08:00',
    end_at: day + 'T' + end + ':00+08:00', idempotency_key: crypto.randomUUID(),
  });
  assert.equal(response.status(), 201);
  return (await response.json()).data;
}

async function uncertainCreate(page) {
  await login(page);
  await room(page);
  await confirm(page);
  const held = await gate(page, '/reservations', { method: 'POST', abort: true });
  let saved;
  try {
    await click(page, '#confirm-booking');
    const created = await held.ready;
    assert.equal(created.status, 201);
    saved = created.body.data;
    await held.finish();
    await visible(page, '#feedback', '暂时无法连接');
    assert.equal(await page.locator('#confirm-booking').isEnabled(), true);
    const reply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/reservations'
      && r.request().method() === 'POST');
    await click(page, '#confirm-booking');
    const retried = await reply;
    assert.equal(retried.status(), 200);
    assert.equal((await retried.json()).data.id, saved.id);
    await visible(page, 'dialog[open]', saved.id);
    assert.equal((await read(page, '/reservations')).filter(row => row.id === saved.id).length, 1);
  } finally { await cleanup(page, saved?.id); }
}
async function bookings(page) {
  await click(page, '[data-nav="bookings"]');
  await visible(page, '#list-status', '预约已更新');
}

async function createFromPage(page) {
  await room(page, '13:00', '14:00', 'A02');
  await confirm(page, 'A02');
  const reply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/reservations'
    && response.request().method() === 'POST');
  await click(page, '#confirm-booking');
  const response = await reply;
  assert.equal(response.status(), 201, 'The current UI session and CSRF must permit a real write');
  const saved = (await response.json()).data;
  await visible(page, 'dialog[open]', saved.id);
  await click(page, '#sheet-cancel');
  await recordCard(page, saved).waitFor();
  return saved;
}

async function seatOrder(page, order, fail = false) {
  const other = await browser.newPage();
  let occupied;
  try {
    await login(other, true);
    occupied = await reserve(other, { start: '13:00', end: '14:00' });
    await login(page);
    await room(page);
    const old = await gate(page, '/seats', { fail });
    await click(page, '#find-seats');
    assert.equal((await old.ready).status, 200);
    await page.locator('#query-start').fill('13:00');
    await page.locator('#query-end').fill('14:00');
    const latest = await gate(page, '/seats');
    await click(page, '#find-seats');
    assert.equal((await latest.ready).status, 200);
    if (order === 'old-first') {
      await old.finish();
      assert.equal(await page.locator('[data-seat]').count(), 0);
      assert.equal(await page.locator('#find-seats').isDisabled(), true);
      await visible(page, '#seat-status', '正在查询');
      await latest.finish();
    } else {
      await latest.finish();
      await page.locator('[data-seat="lib-a101:A01"]').waitFor();
      await old.finish();
    }
    assert.equal(await page.locator('[data-seat="lib-a101:A01"]').isDisabled(), true);
    assert.equal(await page.locator('[data-seat="lib-a101:A02"]').isEnabled(), true);
    assert.equal(await page.locator('#query-start').inputValue(), '13:00');
    assert.equal(await page.locator('#find-seats').isEnabled(), true);
    assert(!/失败|无法/.test(await page.locator('#seat-status').innerText()));
  } finally { await cleanup(other, occupied?.id); await other.close(); }
}

async function createList(page) {
  await login(page);
  await bookings(page);
  const before = await read(page, '/reservations');
  const old = await gate(page, '/reservations');
  await click(page, '#reload-bookings');
  const observed = (await old.ready).body.data;
  assert.deepEqual(observed, before);
  let saved;
  try {
    await room(page);
    await confirm(page);
    const reply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/reservations'
      && r.request().method() === 'POST');
    await click(page, '#confirm-booking');
    saved = (await (await reply).json()).data;
    await visible(page, 'dialog[open]', saved.id);
    await click(page, '#sheet-cancel');
    await visible(page, '#list-status', '预约已更新');
    await recordCard(page, saved).waitFor();
    await old.finish();
    await visible(page, `[data-record="${saved.id}"] .badge`, '待签到');
    assert.equal((await read(page, '/reservations/' + saved.id)).status, 'PENDING_CHECKIN');
  } finally { await cleanup(page, saved?.id); }
}

async function cancelList(page, order, fail = false) {
  await login(page);
  const saved = await reserve(page);
  await bookings(page);
  const old = await gate(page, '/reservations', { fail });
  await click(page, '#reload-bookings');
  assert.equal((await old.ready).body.data.find(row => row.id === saved.id).status, 'PENDING_CHECKIN');
  const latest = await gate(page, '/reservations');
  await recordCard(page, saved).locator('[data-booking-action="cancel"]').click();
  await click(page, '#sheet-confirm');
  assert.equal((await latest.ready).body.data.find(row => row.id === saved.id).status, 'CANCELLED');
  await visible(page, '#feedback', '取消预约已完成');
  if (order === 'old-first') {
    await old.finish();
    await visible(page, '#list-status', '正在加载预约');
    await latest.finish();
  } else {
    await latest.finish();
    await visible(page, `[data-record="${saved.id}"] .badge`, '已取消');
    await old.finish();
  }
  await visible(page, `[data-record="${saved.id}"] .badge`, '已取消');
  assert.equal(await recordCard(page, saved).locator('[data-booking-action]').count(), 0);
  await visible(page, '#feedback', '取消预约已完成');
  await visible(page, '#list-status', '预约已更新');
  assert.equal((await read(page, '/reservations/' + saved.id)).status, 'CANCELLED');
}

async function listRecovery(page) {
  await login(page);
  await bookings(page);
  const held = await gate(page, '/reservations', { fail: true });
  await click(page, '#reload-bookings');
  await held.ready;
  await held.finish();
  await visible(page, '#list-status', '受控读取失败');
  assert.equal(await page.locator('#reload-bookings').isEnabled(), true);
  await click(page, '#reload-bookings');
  await visible(page, '#list-status', '预约已更新');
}

async function switchIdentity(page, csrfError = false) {
  await login(page);
  const saved = await reserve(page);
  try {
    await bookings(page);
    const old = await gate(page, '/reservations', { csrfError });
    await click(page, '#reload-bookings');
    assert.equal((await old.ready).status, csrfError ? 403 : 200);
    await click(page, '#global-exit');
    await click(page, '#sheet-confirm');
    await page.locator('#account').waitFor();
    // Login through this same document so the pending read retains its old identity.
    await page.locator('#account').fill('student02');
    await page.locator('#password').fill('Study1234');
    await click(page, '#sign-in');
    await page.locator('[data-room="lib-a101"]').waitFor();
    await bookings(page);
    await old.finish();
    assert.equal(await recordCard(page, saved).count(), 0);
    await click(page, '[data-nav="profile"]');
    await visible(page, 'main', 'student02');
    const second = await createFromPage(page);
    await cleanup(page, second.id);
  } finally {
    // The first identity's record is deliberately inaccessible to the second.
    await post(page, '/auth/logout', {});
    assert((await post(page, '/auth/login', { username: '832402116', password: '123456' })).ok());
    await cleanup(page, saved.id);
  }
}

async function sessionRecovery(page) {
  await login(page);
  await bookings(page);
  // Change the server session as another tab would, leaving the rendered identity old.
  assert((await post(page, '/auth/login', { username: 'student02', password: 'Study1234' })).ok());
  const held = await gate(page, '/auth/session');
  await click(page, '#reload-bookings');
  assert.equal((await held.ready).status, 200);
  await page.locator('#sign-in').waitFor();
  assert.equal(await page.locator('#sign-in').isDisabled(), true);
  assert.equal(await page.locator('[data-record]').count(), 0);
  await held.finish();
  await visible(page, '#list-status', '预约已更新');
  await click(page, '[data-nav="profile"]');
  await visible(page, 'main', 'student02');
  const saved = await createFromPage(page);
  await cleanup(page, saved.id);
}

async function initializeRecovery(page) {
  const held = await gate(page, '/rooms', { fail: true });
  await page.goto(base);
  await page.locator('#account').fill('832402116');
  await page.locator('#password').fill('123456');
  await click(page, '#sign-in');
  await held.ready;
  assert.equal(await page.locator('#query-start').count(), 0);
  await held.finish();
  await visible(page, 'main', '受控读取失败');
  await click(page, '#retry-load');
  await page.locator('[data-room="lib-a101"]').waitFor();
  await room(page);
  assert.equal(await page.locator('[data-seat="lib-a101:A01"]').isEnabled(), true);
}

async function mobileAdmin(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base);
  await click(page, '#admin-login');
  await visible(page, '#demo-accounts', 'admin01');
  assert((await page.locator('#demo-accounts').innerText()).includes('Admin1234'));
  await page.locator('#account').fill('admin01');
  await page.locator('#password').fill('Admin1234');
  await click(page, '#sign-in');
  await page.locator('[data-rule="leave_limit_minutes"]').fill('35');
  await click(page, '#rule-reset');
  await click(page, '#sheet-confirm');
  assert.equal(await page.locator('[data-rule="leave_limit_minutes"]').inputValue(), '30');
  await page.screenshot({ path: path.join(output, 'mobile-admin-rules-375.png') });
  await click(page, '[data-admin-tab="opening"]');
  await page.locator('#open-room').selectOption('east-b203');
  await page.locator('#open-start').fill('09:00');
  await click(page, '#reset-opening');
  await click(page, '#sheet-confirm');
  assert.equal(await page.locator('#open-start').inputValue(), '08:00');
  await page.locator('#open-mode').selectOption('closed');
  await click(page, '[data-nav="resources"]');
  await click(page, '#sheet-cancel');
  assert.equal(await page.locator('#open-mode').inputValue(), 'closed');
  await click(page, '[data-nav="resources"]');
  await click(page, '#sheet-confirm');
  await page.locator('#new-closure').waitFor();
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
      && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1));
    await page.screenshot({ path: path.join(output, 'mobile-admin-resources-' + width + '.png') });
  }
  await click(page, '[data-nav="rules"]');
  await click(page, '[data-admin-tab="rules"]');
  await page.locator('[data-rule="leave_limit_minutes"]').waitFor();
  await page.screenshot({ path: path.join(output, 'mobile-admin-rules-390.png') });
}

async function main() {
  assert(base, 'Use STUDYSEAT_TEST_URL with an isolated database.');
  fs.mkdirSync(output, { recursive: true });
  browser = await chromium.launch({ channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  try {
    await test('create-receipt-preserves-new-draft', draftReceipt);
    await test('uncertain-create-retries-same-reservation', uncertainCreate);
    await test('seat-new-first', page => seatOrder(page, 'new-first'));
    await test('seat-old-first', page => seatOrder(page, 'old-first'));
    await test('seat-old-error-after-new-result', page => seatOrder(page, 'new-first', true));
    await test('list-before-create-cannot-remove-new-record', createList);
    await test('list-cancel-new-first', page => cancelList(page, 'new-first'));
    await test('list-cancel-old-first', page => cancelList(page, 'old-first'));
    await test('list-old-error-after-new-result', page => cancelList(page, 'new-first', true));
    await test('list-old-error-during-new-load', page => cancelList(page, 'old-first', true));
    await test('list-current-error-retry', listRecovery);
    await test('old-account-list-after-new-login', switchIdentity);
    await test('old-account-csrf-error-after-new-login', page => switchIdentity(page, true));
    await test('delayed-session-recovery-and-csrf', sessionRecovery);
    await test('initialization-error-retry-and-ready-controls', initializeRecovery);
    await test('mobile-admin-resets-and-discard-guard', mobileAdmin);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); report(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(report);
