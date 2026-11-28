const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Approved seated-person mark is identical in prototype, live UI, favicon and export assets', () => {
  const canonical = read('prototype/brand-mark.svg');
  for (const file of ['alpha/studyseat/static/brand-mark.svg', 'deploy/assets/brand-mark.svg', 'deploy/assets/icon.svg']) {
    assert.equal(read(file), canonical, file);
  }
  assert(canonical.includes('data-brand="seat-person"'));
  assert(canonical.includes('<circle cx="32" cy="21.5" r="6.5"'));
  assert(canonical.includes('fill="#fff"'));
  assert(canonical.includes('linearGradient'));
  const paths = [...canonical.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  for (const file of ['deploy/assets/js/studyseat-prototype.js', 'modao/StudySeat_定版原型.html', 'deploy/assets/icon.svg']) {
    const text = read(file);
    for (const shape of paths) assert(text.includes(shape), file + ': missing approved shape');
    assert(!text.includes('M12 12c8-2 14-1 20 3'), file + ': previous book logo remains');
    assert(!/[\u2667\u2663\u2618\u{1F340}]/u.test(text), file + ': retired brand remains');
  }
  const live = read('alpha/studyseat/static/prototype.js');
  assert(live.includes('src="/static/brand-mark.svg?v=seat-person-20261128"'));
  assert(!/[\u2667\u2663\u2618\u{1F340}]/u.test(live));
  assert(read('alpha/studyseat/templates/prototype.html').includes("filename='brand-mark.svg', v='seat-person-20261128'"));
  assert(fs.existsSync(path.join(root, 'prototype/branding/seat-person-approved.png')));
  assert(read('prototype/admin-ui.js').includes('data-brand="seat-person"'));
  assert(!read('prototype/admin-ui.js').includes('class="brandicon">S</div>'));
  assert(read('alpha/studyseat/templates/index.html').includes("filename='brand-mark.svg', v='seat-person-20261128'"));
  const vm = require('node:vm'), context = { window: {} };
  const standalone = read('modao/StudySeat_定版原型.html');
  vm.runInNewContext(standalone.match(/<script>(window\.UNIFIED_STUDENT=[\s\S]*?)<\/script>/)[1], context);
  assert(context.window.UNIFIED_ADMIN.includes('data-brand="seat-person"'));
  assert(!context.window.UNIFIED_ADMIN.includes('class="brandicon">S</div>'));
});
