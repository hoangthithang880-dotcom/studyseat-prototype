const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5057';
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/phase3/phase3-browser');
const checks = [];
const accounts = { A: ['832402116', '123456'], B: ['student02', 'Study1234'], admin: ['admin01', 'Admin1234'] };
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
async function login(page, who) {
  await page.locator('#username').fill(accounts[who][0]);
  await page.locator('#password').fill(accounts[who][1]);
  await page.locator('#login-form button').click();
  await contains(page, 'identity', accounts[who][0]);
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 4 && document.getElementById('initialization-state').textContent === '');
  if (who === 'admin') await page.waitForFunction(() => !document.getElementById('admin-fields').disabled);
}
async function request(page, endpoint, body) {
  return page.evaluate(async ({ endpoint, body }) => {
    const session = await (await fetch('/api/v1/auth/session')).json();
    const response = await fetch('/api/v1' + endpoint, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.data.csrf_token }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { endpoint, body });
}
const beijingInput = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(' ', 'T');
async function book(page, start) {
  await page.locator('#room-id').selectOption('activity-24');
  await page.locator('#start-at').fill(beijingInput(start));
  await page.locator('#end-at').fill(beijingInput(new Date(start.getTime() + 3600000)));
  await page.locator('#search-form button').click();
  await contains(page, 'availability', '此时段可预约');
  await page.locator('#seat-id').selectOption('activity-24:A01');
  await page.locator('#booking-form button').click();
  await contains(page, 'status', '预约已保存');
  await page.waitForFunction(() => document.querySelectorAll('#reservations li').length > 0);
  const records = (await request(page, '/reservations')).body.data;
  return records.find(record => record.status === 'PENDING_CHECKIN');
}
async function stateAction(page, id, label, expected) {
  const item = page.locator(`[data-reservation-id="${id}"]`);
  await item.getByRole('button', { name: label, exact: true }).click();
  await item.filter({ hasText: expected }).waitFor();
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
async function hold(page, endpoint, failure = false) {
  const ready = deferred(), release = deferred(), delivered = deferred();
  const marker = `phase3-held-${Date.now()}-${Math.random()}`;
  await page.evaluate(({ endpoint, marker }) => {
    const original = window.fetch;
    let selected = false;
    window.fetch = async (...args) => {
      const chosen = !selected && String(args[0]) === '/api/v1' + endpoint;
      if (chosen) selected = true;
      const response = await original(...args);
      if (chosen) {
        const json = response.json.bind(response);
        response.json = async () => { const body = await json(); setTimeout(() => { window[marker] = true; }, 0); return body; };
      }
      return response;
    };
  }, { endpoint, marker });
  const pattern = '**/api/v1' + endpoint;
  const handler = async route => {
    const response = await route.fetch();
    ready.resolve();
    await release.promise;
    await route.fulfill(failure ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'obsolete management failure' } }) } : { response });
    delivered.resolve();
  };
  await page.route(pattern, handler, { times: 1 });
  return { ready: ready.promise, release: async () => { release.resolve(); await delivered.promise; await page.waitForFunction(marker => window[marker], marker); await page.unroute(pattern, handler); } };
}
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  const studentContext = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 1360, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const student = await studentContext.newPage();
  const admin = await adminContext.newPage();
  const errors = [];
  for (const page of [student, admin]) { page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); }
  try {
    await student.goto(new URL('/diagnostics', base).href);
    await student.locator('#username').waitFor();
    await login(student, 'A');
    const serverNow = new Date((await request(student, '/health')).body.data.server_time);
    const soon = new Date(Math.ceil((serverNow.getTime() + 120000) / 60000) * 60000);
    const first = await book(student, soon);
    assert.ok(first);
    await stateAction(student, first.id, '签到（页面确认）', '使用中');
    await stateAction(student, first.id, '暂离', '暂离中');
    await contains(student, 'reservations', '暂离截止');
    await student.screenshot({ path: path.join(evidence, 'student-leave-desktop.png'), fullPage: true });
    await student.reload();
    await student.locator(`[data-reservation-id="${first.id}"]`).filter({ hasText: '暂离中' }).waitFor();
    await stateAction(student, first.id, '返回座位', '使用中');
    await stateAction(student, first.id, '暂离', '暂离中');
    await stateAction(student, first.id, '结束使用', '已结束');
    const final = (await request(student, '/reservations/' + first.id)).body.data;
    assert.equal(final.status, 'COMPLETED');
    assert.ok(final.checked_in_at && final.ended_at);
    assert.equal((await request(student, `/reservations/${first.id}/check-in`, { idempotency_key: 'late-retry' })).body.data.status, 'COMPLETED');
    checks.push('真实学生页面：预约→签到→暂离→刷新恢复→返回→再次暂离→结束；终态不复活');

    await student.locator('#logout').click();
    await student.locator('#username').waitFor();
    await login(student, 'B');
    assert.equal(await student.locator('#reservations li').count(), 0);
    for (const action of ['check-in', 'leave', 'return', 'finish']) {
      assert.equal((await request(student, `/reservations/${first.id}/${action}`, { idempotency_key: action, expected_version: 0 })).status, 404);
    }
    assert.equal((await request(student, '/admin/reservations')).status, 403);
    checks.push('账号 B 看不到 A 的记录，四种状态操作均 404，管理读取 403');

    await admin.goto(new URL('/diagnostics', base).href);
    await admin.locator('#username').waitFor();
    await login(admin, 'admin');
    await contains(admin, 'admin-reservations', first.id);
    await contains(admin, 'admin-reservations', '已结束');
    await admin.locator('#rule-leave').fill('45');
    admin.once('dialog', dialog => dialog.dismiss());
    await admin.locator('#logout').click();
    assert.equal(await admin.locator('#dashboard').isVisible(), true);
    assert.equal(await admin.locator('#rule-leave').inputValue(), '45');
    await admin.locator('#note').fill('保护未保存规则');
    await admin.locator('#note-form button').click();
    await contains(admin, 'notes', '保护未保存规则');
    await contains(admin, 'status', '已保存，可刷新');
    assert.equal(await admin.locator('#rule-leave').inputValue(), '45');
    await admin.locator('#rules-form button[type="submit"]').click();
    await contains(admin, 'status', '规则已保存');
    await contains(admin, 'rule-version', 'v2');
    assert.equal((await request(student, '/rules')).body.data.settings.leave_limit_minutes, 45);
    assert.equal((await request(admin, '/admin/reservations')).body.data.find(r => r.id === first.id).rule_snapshot.leave_limit_minutes, 30);
    checks.push('管理端看到同一预约；未保存退出保护；规则 v2 跨端共享且旧预约保留 v1 快照');

    // Save one draft, then edit while its real committed receipt is delayed.
    await admin.locator('#rule-leave').fill('46');
    const heldSave = await hold(admin, '/admin/rules');
    await admin.locator('#rules-form button[type="submit"]').click();
    await heldSave.ready;
    await admin.locator('#rule-leave').fill('47');
    await heldSave.release();
    await contains(admin, 'status', '后续修改仍未保存');
    assert.equal(await admin.locator('#rule-leave').inputValue(), '47');
    assert.equal((await request(student, '/rules')).body.data.settings.leave_limit_minutes, 46);
    await admin.locator('#rules-form button[type="submit"]').click();
    await contains(admin, 'status', '规则已保存；已有预约');
    assert.equal((await request(student, '/rules')).body.data.settings.leave_limit_minutes, 47);
    checks.push('规则保存回执延迟时继续编辑，较新的草稿被保留，并可按新版本再次保存');

    const tomorrow = new Date(soon.getTime() + 86400000);
    const pending = await book(student, tomorrow);
    await admin.locator('#closure-room').selectOption('activity-24');
    await admin.locator('#closure-seat').selectOption('activity-24:A01');
    await admin.locator('#closure-reason').fill('阶段三浏览器检修');
    const beforeEvents = (await request(admin, '/admin/audit-events')).body.data;
    await admin.locator('#closure-form button').click();
    await contains(admin, 'closure-preview', '将取消 1 条');
    await contains(admin, 'closure-preview', pending.id);
    await admin.screenshot({ path: path.join(evidence, 'admin-preview-desktop.png'), fullPage: true });
    assert.deepEqual((await request(admin, '/admin/audit-events')).body.data, beforeEvents);
    await admin.locator('#confirm-closure').click();
    await contains(admin, 'status', '资源已关闭');
    await student.locator('#reload-reservations').click();
    await student.locator(`[data-reservation-id="${pending.id}"]`).filter({ hasText: '已取消' }).waitFor();
    assert.equal((await request(admin, '/admin/resources')).body.data.closures.length, 1);
    await admin.locator('#events [data-action="RESOURCE_CLOSED"]').filter({ hasText: '关闭资源' }).waitFor();
    await admin.screenshot({ path: path.join(evidence, 'admin-closed-desktop.png'), fullPage: true });
    await admin.getByRole('button', { name: '重新开放', exact: true }).click();
    await contains(admin, 'status', '已重新开放');
    assert.equal((await request(student, '/reservations/' + pending.id)).body.data.status, 'CANCELLED');
    checks.push('只读关闭预览→关闭事务→学生刷新取消→重新开放不复活；真实审计可查');

    const next = await book(student, tomorrow);
    await admin.locator('#closure-form button').click();
    await contains(admin, 'closure-preview', '将取消 1 条');
    const race = (await request(student, `/reservations/${next.id}/cancel`, {}));
    assert.equal(race.status, 200);
    await admin.locator('#confirm-closure').click();
    await contains(admin, 'status', '影响范围已改变');
    assert.equal((await request(admin, '/admin/resources')).body.data.closures.filter(c => !c.reopened_at).length, 0);
    await admin.locator('#closure-reason').fill('修改范围使预览失效');
    assert.equal(await admin.locator('#confirm-closure').isVisible(), false);
    checks.push('预览之后学生取消，确认关闭返回明确过期提示；编辑关闭条件使确认入口失效');

    const current = await book(student, soon);
    await stateAction(student, current.id, '签到（页面确认）', '使用中');
    await admin.locator('#closure-form button').click();
    await contains(admin, 'closure-preview', '1 条使用中或暂离中预约阻止关闭');
    await contains(admin, 'closure-preview', current.id);
    assert.equal(await admin.locator('#confirm-closure').isVisible(), false);
    await stateAction(student, current.id, '结束使用', '已结束');
    checks.push('使用中预约阻止关闭，页面不给确认入口；结束后可重新预览');

    for (const failure of [false, true]) {
      const target = await book(student, tomorrow);
      const old = await hold(admin, '/admin/reservations', failure);
      await admin.locator('#reload-admin').click();
      await old.ready;
      await admin.locator('#closure-form button').click();
      await contains(admin, 'closure-preview', '将取消 1 条');
      await admin.locator('#confirm-closure').click();
      await contains(admin, 'status', '资源已关闭');
      const message = await admin.locator('#status').textContent();
      await old.release();
      assert.equal(await admin.locator('#status').textContent(), message);
      const text = await admin.locator('#admin-reservations').textContent();
      assert.ok(text.includes(target.id));
      assert.equal(text.includes('待签到'), false);
      assert.equal((await request(student, '/reservations/' + target.id)).body.data.status, 'CANCELLED');
      await admin.getByRole('button', { name: '重新开放', exact: true }).click();
      await contains(admin, 'status', '已重新开放');
      checks.push(failure ? '旧管理读取错误晚到，不能覆盖关闭成功反馈或当前数据' : '关闭前管理列表晚到，不能覆盖关闭后的取消状态');
    }

    await admin.locator('#hours-room').selectOption('activity-24');
    await admin.locator('#hours-open').fill('01:00');
    await admin.locator('#hours-form button').click();
    await contains(admin, 'status', '开放时间已保存');
    assert.equal((await request(student, '/rooms')).body.data.find(r => r.id === 'activity-24').opens_minute, 60);
    checks.push('每日开放安排保存后学生读取同一资源数据');
    await student.locator('#reload-reservations').click();
    await student.waitForFunction(() => !document.getElementById('reload-reservations').disabled);
    assert.equal((await student.locator('#reservations').textContent()).includes('待签到'), false);
    await admin.setViewportSize({ width: 390, height: 844 });
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await admin.screenshot({ path: path.join(evidence, 'admin-mobile.png'), fullPage: true });
    await student.setViewportSize({ width: 390, height: 844 });
    assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await student.screenshot({ path: path.join(evidence, 'student-mobile.png'), fullPage: true });
    checks.push('学生与管理页面 390px 移动端无横向溢出');
    await admin.locator('#logout').click();
    await admin.locator('#username').waitFor();
    assert.equal(await admin.locator('#admin-reservations').textContent(), '');
    assert.equal(await admin.locator('#closures').textContent(), '');
    assert.equal(await admin.locator('#rule-leave').inputValue(), '');
    assert.deepEqual(errors, []);
    checks.push('退出清空管理私有数据与表单，浏览器无未捕获异常');
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), checks };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', error: error.stack, checks }, null, 2));
    await student.screenshot({ path: path.join(evidence, 'student-failure.png'), fullPage: true });
    await admin.screenshot({ path: path.join(evidence, 'admin-failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
