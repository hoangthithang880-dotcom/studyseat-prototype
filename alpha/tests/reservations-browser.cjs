const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/phase2/reservations-browser');
const base = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5057';
const accounts = { A: ['832402116', '123456'], B: ['student02', 'Study1234'], admin: ['admin01', 'Admin1234'] };
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const checks = [];
async function login(page, who) {
  await page.locator('#username').fill(accounts[who][0]);
  await page.locator('#password').fill(accounts[who][1]);
  await page.locator('#login-form button').click();
  await contains(page, 'identity', accounts[who][0]);
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 4);
  if (who !== 'admin') await page.waitForFunction(() => {
    const text = document.getElementById('reservations').textContent;
    return text && !text.includes('尚未加载');
  });
  if (who !== 'admin') await page.locator('#room-id').selectOption('lib-a101');
}
async function logout(page) {
  await page.locator('#logout').click();
  await page.locator('#username').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#reservations').textContent(), '');
  assert.equal(await page.locator('#seat-id option').count(), 0);
  assert.equal(await page.locator('#start-at').inputValue(), '');
}
async function search(page) {
  await page.locator('#search-form button').click();
  await contains(page, 'availability', '此时段可预约');
}
async function backend(page, url, cancel = false) {
  return page.evaluate(async ({ url, cancel }) => {
    const session = await (await fetch('/api/v1/auth/session')).json();
    const result = await fetch('/api/v1' + url, cancel ? { method: 'POST', headers: { 'X-CSRF-Token': session.data.csrf_token } } : {});
    return { status: result.status, body: await result.json() };
  }, { url, cancel });
}
// Pause only delivery of a real response, then observe its JSON consumer finishing.
async function hold(page, endpoint) {
  const ready = deferred(), release = deferred(), delivered = deferred();
  const marker = `held-${Date.now()}`;
  await page.evaluate(({ endpoint, marker }) => {
    const fetchOriginal = window.fetch;
    let captured = false;
    window.fetch = async (...args) => {
      const selected = !captured && String(args[0]) === '/api/v1' + endpoint;
      if (selected) captured = true;
      const result = await fetchOriginal(...args);
      if (selected) {
        const jsonOriginal = result.json.bind(result);
        result.json = async () => {
          const body = await jsonOriginal();
          setTimeout(() => { window[marker] = true; }, 0);
          return body;
        };
      }
      return result;
    };
  }, { endpoint, marker });
  const pattern = `**/api/v1${endpoint}`;
  await page.route(pattern, async route => {
    const response = await route.fetch();
    ready.resolve();
    await release.promise;
    await route.fulfill({ response });
    delivered.resolve();
  }, { times: 1 });
  return { ready: ready.promise, release: async () => {
    release.resolve(); await delivered.promise;
    await page.waitForFunction(marker => window[marker], marker);
    await page.unroute(pattern);
  } };
}
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  // A non-Beijing device timezone catches accidental local-to-UTC conversions.
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 1360, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL('/diagnostics', base).href);
    await page.locator('#username').waitFor({ state: 'visible' });
    await login(page, 'A');
    const date = await page.locator('#start-at').inputValue();
    await page.locator('#end-at').fill(`${date.slice(0, 10)}T14:00`);
    await page.locator('#search-form button').click();
    await contains(page, 'status', '时长超过');
    await page.locator('#end-at').fill(`${date.slice(0, 10)}T10:00`);
    await search(page);
    assert.equal(await page.locator('#seat-id option').count(), 119);
    const seat = await page.locator('#seat-id').inputValue();
    let committed, originalPayload;
    // Real backend commits, but the first receipt is lost. Retry must use the same key.
    await page.route('**/api/v1/reservations', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      originalPayload = route.request().postDataJSON();
      committed = (await (await route.fetch()).json()).data;
      await route.abort('failed');
    }, { times: 1 });
    await page.locator('#booking-form button').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.length > 0);
    const retried = page.waitForResponse(r => r.url().endsWith('/api/v1/reservations') && r.request().method() === 'POST');
    await page.locator('#booking-form button').click();
    const retry = await retried;
    assert.equal(retry.status(), 200);
    assert.equal(retry.request().postDataJSON().idempotency_key, originalPayload.idempotency_key);
    assert.equal((await retry.json()).data.id, committed.id);
    assert.equal(originalPayload.start_at, date + ':00+08:00');
    assert.equal(committed.start_at, new Date(originalPayload.start_at).toISOString().replace('.000Z', '.000000Z'));
    await contains(page, 'reservations', '待签到');
    assert.equal(await page.locator('#reservations li').count(), 1);
    await page.reload();
    await contains(page, 'reservations', '待签到');
    assert.equal(await page.locator('#reservations li').getAttribute('data-reservation-id'), committed.id);
    await logout(page); await login(page, 'A');
    assert.equal(await page.locator('#reservations li').getAttribute('data-reservation-id'), committed.id);
    checks.push('real query/create; lost receipt retried with same key; refresh/relogin persistence; Beijing payload on Los Angeles device');
    await page.screenshot({ path: path.join(evidence, 'reservation-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(evidence, 'reservation-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1100 });
    checks.push('desktop and 390px mobile layout without horizontal overflow');
    await logout(page); await login(page, 'B');
    assert.equal(await page.locator('#reservations li').count(), 0);
    assert.equal((await backend(page, '/reservations/' + committed.id)).status, 404);
    assert.equal((await backend(page, '/reservations/' + committed.id + '/cancel', true)).status, 404);
    await search(page);
    assert.equal(await page.locator(`#seat-id option[value="${seat}"]`).count(), 0);
    await logout(page); await login(page, 'A');
    await page.locator('#reservations').getByRole('button', { name: '取消预约', exact: true }).click();
    await contains(page, 'status', '已取消');
    const cancelled = (await backend(page, '/reservations/' + committed.id)).body.data;
    assert.deepEqual((await backend(page, '/reservations/' + committed.id + '/cancel', true)).body.data, cancelled);
    await logout(page); await login(page, 'B');
    await search(page);
    await page.locator('#seat-id').selectOption(seat);
    await page.locator('#booking-form button').click();
    await contains(page, 'status', '预约已保存');
    const bRecord = (await backend(page, '/reservations')).body.data[0];
    assert.equal(bRecord.seat_id, seat);
    checks.push('ownership read/cancel 404; occupied seat hidden; duplicate cancel stable; student B books released interval');
    await logout(page); await login(page, 'A');
    const held = await hold(page, '/reservations');
    await page.locator('#reload-reservations').click();
    await held.ready;
    await logout(page); await login(page, 'B');
    await held.release();
    assert.equal(await page.locator('#reservations li').count(), 1);
    assert.equal(await page.locator('#reservations li').getAttribute('data-reservation-id'), bRecord.id);
    assert(!(await page.locator('#reservations').textContent()).includes('已取消'));
    checks.push('delayed student A reservation response cannot overwrite student B list');
    await logout(page); await login(page, 'A');
    const parameters = { room_id: await page.locator('#room-id').inputValue(), start_at: date + ':00+08:00', end_at: date.slice(0,10) + 'T10:00:00+08:00' };
    const heldSeats = await hold(page, '/seats?' + new URLSearchParams(parameters));
    await page.locator('#search-form button').click();
    await heldSeats.ready;
    await page.locator('#end-at').fill(date.slice(0,10) + 'T11:00');
    await heldSeats.release();
    assert.equal(await page.locator('#seat-id option').count(), 0);
    assert(await page.locator('#booking-form').isHidden());
    checks.push('changing query discards delayed seat availability response');
    await logout(page);
    await page.route('**/api/v1/reservations', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '预约读取测试失败' } }) }));
    // A failed load after switching identity must not resurrect the old reservation.
    await page.locator('#username').fill(accounts.B[0]); await page.locator('#password').fill(accounts.B[1]); await page.locator('#login-form button').click();
    await contains(page, 'status', '预约读取测试失败');
    assert.equal(await page.locator('#reservations li').count(), 0);
    await page.unroute('**/api/v1/reservations');
    await page.locator('#reload-reservations').click();
    await contains(page, 'reservations', '待签到');
    await logout(page); await login(page, 'admin');
    assert(await page.locator('#student-booking').isHidden());
    assert.equal(await page.locator('#reservations li').count(), 0);
    checks.push('failed reservation load has no prior account data; explicit refresh recovers; admin has no student controls');
    assert.deepEqual(errors, []);
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge', playwright: require('playwright/package.json').version, device_timezone: 'America/Los_Angeles', checks, errors };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
    fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', completed_checks: checks, error: error.stack }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
