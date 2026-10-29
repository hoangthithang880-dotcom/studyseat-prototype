const { test } = require('node:test');
const assert = require('node:assert/strict');
const create = require('../deploy/assets/js/studyseat-domain.js');
class MemoryStorage {
  constructor() { this.values = new Map(); this.failRead = false; this.failWrite = false; }
  getItem(k) { if (this.failRead) throw new Error('blocked'); return this.values.get(k) ?? null; }
  setItem(k, v) { if (this.failWrite) throw new Error('quota'); this.values.set(k, String(v)); }
  removeItem(k) { if (this.failWrite) throw new Error('blocked'); this.values.delete(k); }
}
const ts = value => Date.parse('2026-10-26T' + value + '+08:00');
function fixture() {
  let now = ts('13:40:00'); const storage = new MemoryStorage(), session = new MemoryStorage();
  const S = create({ storage, session, now: () => now }); S.login('832402116', '123456', 'student');
  return { S, storage, session, time: value => { now = typeof value === 'number' ? value : ts(value); }, reload: () => create({ storage, session, now: () => now }) };
}
const selection = (extra = {}) => ({ roomId: 'east-b203', seatId: 'east-b203:A02', startAt: ts('14:00:00'), endAt: ts('16:00:00'), ...extra });
function reserve(f, extra = {}, token = f.S.uid()) { return f.S.createReservation(selection(extra), token); }
function throwsType(fn, type) { assert.throws(fn, e => e.type === type, type); }
function events(S, id) { return S.loadData().events.filter(e => e.reservationId === id); }
function record(S, id) { return S.loadData().reservations.find(r => r.id === id); }

test('T08 range: today and +7 inclusive; +8 rejected, Shanghai day and labels', () => {
 const f = fixture(); reserve(f); const day = '2026-11-02'; reserve(f, { startAt: f.S.atTime(day, '14:00'), endAt: f.S.atTime(day, '16:00') });
 throwsType(() => reserve(f, { startAt: f.S.atTime('2026-11-03', '14:00'), endAt: f.S.atTime('2026-11-03', '16:00') }), 'DATE_RANGE');
 assert.equal(f.S.dateKey(ts('00:00:00')), '2026-10-26'); assert.match(f.S.format(f.S.atTime('2026-10-27', '14:00')), /周二/);
});
test('T08 duration, past, malformed time, opening hours and seat ownership', () => {
 const f = fixture();
 throwsType(() => reserve(f, { endAt: ts('18:01:00') }), 'DURATION');
 throwsType(() => reserve(f, { startAt: ts('13:39:59') }), 'PAST');
 throwsType(() => reserve(f, { endAt: ts('14:00:00') }), 'TIME');
 throwsType(() => reserve(f, { startAt: NaN }), 'TIME');
 throwsType(() => reserve(f, { startAt: ts('21:00:00'), endAt: ts('23:00:00') }), 'OPENING_HOURS');
 throwsType(() => reserve(f, { seatId: 'lib-a101:A01' }), 'SEAT');
 throwsType(() => reserve(f, { seatId: 'east-b203:B18' }), 'SEAT');
 reserve(f, { endAt: ts('18:00:00') });
});
test('T10–T11 multiple reservations, daily creation code, idempotent token and event', () => {
 const f = fixture(), a = reserve(f, {}, 'one'); assert.equal(reserve(f, {}, 'one').id, a.id);
 const b = reserve(f, { startAt: ts('16:00:00'), endAt: ts('18:00:00') }, 'two');
 assert.notEqual(a.id, b.id); assert.match(a.code, /^SE-20261026-0001$/); assert.notEqual(a.code, b.code);
 assert.equal(f.reload().listMyReservations().length, 2); assert.equal(events(f.S, a.id).length, 1);
 f.S.act(a.id, 'CANCEL'); assert.equal(reserve(f, {}, 'three').code, 'SE-20261026-0003');
});
test('T12–T13 other student seat conflict, privacy, self conflict, adjacency and room-scoped seat IDs', () => {
 const f = fixture(), a = reserve(f);
 throwsType(() => reserve(f, { seatId: 'east-b203:A03' }), 'SELF_CONFLICT');
 assert.throws(() => reserve(f, { seatId: 'east-b203:A03' }), e => e.reservationId === a.id && e.message.includes(a.code));
 f.S.login('student02', 'Study1234', 'student');
 assert.equal(f.S.listMyReservations().length, 0);
 assert.throws(() => reserve(f), e => e.type === 'SEAT_CONFLICT' && !e.message.includes('student01'));
 reserve(f, { roomId: 'lib-a101', seatId: 'lib-a101:A02' });
 reserve(f, { startAt: ts('16:00:00'), endAt: ts('18:00:00') });
 assert.equal(f.S.listAvailableSeats('east-b203', ts('14:00:00'), ts('16:00:00')).find(s => s.id === a.seatId).available, false);
});
for (const [at, expected] of [['13:49:59', 'WINDOW_NOT_OPEN'], ['13:50:00', 'IN_USE'], ['14:15:00', 'IN_USE'], ['14:15:01', 'TERMINAL']]) {
 test('T15 independent check-in boundary ' + at, () => { const f = fixture(), r = reserve(f); f.time(at); if (expected === 'IN_USE') assert.equal(f.S.act(r.id, 'CHECKIN').status, expected); else throwsType(() => f.S.act(r.id, 'CHECKIN'), expected); if (at === '14:15:01') assert.equal(record(f.S, r.id).status, 'EXPIRED'); });
}
test('T16 check-in survives reload, repeated request preserves first time and event', () => {
 const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.time('14:01:00');
 const r2 = f.reload().act(r.id, 'CHECKIN'); assert.equal(r2.checkedInAt, ts('14:00:00')); assert.equal(events(f.S, r.id).length, 2);
});
test('T17–T18 leave survives reload; repeated leave preserves origin and deadline', () => {
 const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.S.act(r.id, 'LEAVE'); f.time('14:20:00');
 const r2 = f.reload().act(r.id, 'LEAVE'); assert.equal(r2.leaveStartedAt, ts('14:00:00')); assert.equal(r2.leaveDeadline - f.S.getNow(), 600000); assert.equal(events(f.S, r.id).length, 3);
 f.time('14:30:00'); assert.equal(f.S.act(r.id, 'RETURN').status, 'IN_USE'); assert.equal(events(f.S, r.id).length, 4);
});
test('T18 beyond leave deadline refuses return and releases seat', () => {
 const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.S.act(r.id, 'LEAVE'); f.time('14:30:01');
 throwsType(() => f.S.act(r.id, 'RETURN'), 'TERMINAL'); assert.equal(record(f.S, r.id).status, 'EXPIRED'); assert.equal(record(f.S, r.id).expiredAt, ts('14:30:00'));
 assert.equal(f.S.listAvailableSeats(r.roomId, ts('15:00:00'), ts('16:00:00')).find(s => s.id === r.seatId).available, true);
});
test('T19 complete while away is durable and accounts for leave in duration', () => {
 const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.S.act(r.id, 'LEAVE'); f.time('14:10:00'); f.S.act(r.id, 'COMPLETE');
 const final = f.reload().listMyReservations()[0]; assert.equal(final.status, 'COMPLETED'); assert.equal(final.completedAt - final.checkedInAt, 600000);
});
for (const [leaveAt, opensAt, expected, effective] of [['14:00:00', '18:05:00', 'EXPIRED', '14:30:00'], ['15:50:00', '16:01:00', 'COMPLETED', '16:00:00'], ['15:30:00', '18:00:00', 'COMPLETED', '16:00:00']]) {
 test('T20–T21 late reopening chronology ' + leaveAt, () => {
  const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.time(leaveAt); f.S.act(r.id, 'LEAVE'); f.time(opensAt);
  const final = f.reload().listMyReservations()[0]; assert.equal(final.status, expected); assert.equal(final.expiredAt ?? final.completedAt, ts(effective));
  const e = events(f.S, r.id).at(-1); assert.equal(e.at, ts(effective)); assert.equal(e.processedAt, ts(opensAt));
 });
}
test('T20 natural end at endpoint for in-use and no background page required', () => { const f = fixture(), r = reserve(f); f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.time('16:00:00'); assert.equal(f.reload().listMyReservations()[0].status, 'COMPLETED'); });
test('T22 pending opened after reservation end stays no-show expired', () => { const f = fixture(), r = reserve(f); f.time('18:00:00'); assert.equal(f.reload().listMyReservations()[0].status, 'EXPIRED'); assert.equal(record(f.S, r.id).expiredAt, ts('14:15:00')); });
for (const operation of ['CANCEL', 'COMPLETE', 'EXPIRE']) {
 test('T23 terminal repeated operations preserve state, time and event: ' + operation, () => {
  const f = fixture(), r = reserve(f);
  if (operation === 'CANCEL') f.S.act(r.id, operation);
  else { f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); if (operation === 'COMPLETE') f.S.act(r.id, operation); else { f.S.act(r.id, 'LEAVE'); f.time('14:31:00'); f.S.reconcileExpiredReservations(); } }
  const before = JSON.stringify(record(f.S, r.id)), count = events(f.S, r.id).length;
  f.time('18:00:00'); if (operation !== 'EXPIRE') f.S.act(r.id, operation); else throwsType(() => f.S.act(r.id, 'RETURN'), 'TERMINAL');
  f.S.reconcileExpiredReservations(); assert.equal(JSON.stringify(record(f.S, r.id)), before); assert.equal(events(f.S, r.id).length, count);
 });
}
test('T24 operation on one reservation leaves the other untouched', () => { const f = fixture(), a = reserve(f), b = reserve(f, { startAt: ts('16:00:00'), endAt: ts('18:00:00') }); const before = JSON.stringify(record(f.S, b.id)); f.time('14:00:00'); f.S.act(a.id, 'CHECKIN'); f.S.act(a.id, 'LEAVE'); assert.equal(JSON.stringify(record(f.S, b.id)), before); });
for (const mode of ['cancel', 'complete', 'expire']) {
 test('T25 released future can be booked; past cannot: ' + mode, () => {
  const f = fixture(), r = reserve(f);
  if (mode === 'cancel') f.S.act(r.id, 'CANCEL'); else { f.time('14:00:00'); f.S.act(r.id, 'CHECKIN'); f.S.act(r.id, 'LEAVE'); f.time(mode === 'complete' ? '14:10:00' : '14:31:00'); if (mode === 'complete') f.S.act(r.id, 'COMPLETE'); else f.S.reconcileExpiredReservations(); }
  f.S.login('student02', 'Study1234', 'student'); reserve(f, { startAt: ts('15:00:00') }); throwsType(() => reserve(f, { startAt: ts('13:00:00'), endAt: ts('14:00:00') }), 'PAST');
 });
}
test('T26 full rule snapshot governs old reservation; new version governs new reservation', () => {
 const f = fixture(), a = reserve(f), d = f.S.loadData(); d.rules = { version: 'test-2', maxDurationMinutes: 60, maxAdvanceDays: 1, checkInEarlyMinutes: 2, checkInLateMinutes: 1, leaveLimitMinutes: 5 }; f.S.saveData(d);
 throwsType(() => reserve(f, { startAt: ts('16:00:00'), endAt: ts('18:00:00') }), 'DURATION');
 const b = reserve(f, { startAt: ts('16:00:00'), endAt: ts('17:00:00') }); assert.equal(b.ruleSnapshot.version, 'test-2');
 f.time('13:50:00'); assert.equal(f.S.act(a.id, 'CHECKIN').status, 'IN_USE'); f.S.act(a.id, 'LEAVE'); assert.equal(record(f.S, a.id).leaveDeadline, ts('14:20:00'));
 assert.equal(record(f.S, a.id).ruleSnapshot.maxDurationMinutes, 240);
});
test('T02 login requires correct role, fifth failure locks for ten minutes across reload', () => {
 const f = fixture(); f.S.logout(); throwsType(() => f.S.login('', '', 'student'), 'REQUIRED');
 for (let i = 0; i < 4; i++) throwsType(() => f.S.login('832402116', 'bad', 'student'), 'CREDENTIALS');
 throwsType(() => f.S.login('832402116', 'bad', 'student'), 'LOCKED'); throwsType(() => f.reload().login('832402116', '123456', 'student'), 'LOCKED');
 f.time('13:50:00'); assert.equal(f.S.login('832402116', '123456', 'student').id, 'student01');
 throwsType(() => f.S.login('admin01', 'Admin1234', 'student'), 'CREDENTIALS'); assert.equal(f.S.login('admin01', 'Admin1234', 'admin').role, 'admin');
});
test('T03–T04 ownership, sessions, draft isolation and logout preserves records', () => {
 const f = fixture(), r = reserve(f); f.S.saveDraft({ ...selection(), submitToken: 'draft-a' }); f.S.logout(); throwsType(() => reserve(f), 'AUTH');
 f.S.login('student02', 'Study1234', 'student'); assert.equal(f.S.getDraft(), null); throwsType(() => f.S.act(r.id, 'CANCEL'), 'NOT_FOUND');
 f.S.login('832402116', '123456', 'student'); assert.equal(f.S.listMyReservations().length, 1); assert.equal(f.S.getDraft().submitToken, 'draft-a');
 assert(!f.storage.getItem(f.S.KEY).includes('Study1234'));
});
test('T05 write failure does not create reservation or false operation success', () => {
 const f = fixture(), before = f.storage.getItem(f.S.KEY); f.storage.failWrite = true; throwsType(() => reserve(f), 'STORAGE_WRITE'); assert.equal(f.storage.values.get(f.S.KEY), before);
 f.storage.failWrite = false; const r = reserve(f); f.time('14:00:00'); f.storage.failWrite = true; throwsType(() => f.S.act(r.id, 'CHECKIN'), 'STORAGE_WRITE'); f.storage.failWrite = false; assert.equal(record(f.S, r.id).status, 'PENDING_CHECKIN');
});
test('T05 damaged JSON, missing fields and unknown versions are retained for explicit recovery', () => {
 const f = fixture();
 for (const value of ['{', JSON.stringify({ version: 3 }), JSON.stringify({ ...f.S.loadData(), seats: null })]) { f.storage.setItem(f.S.KEY, value); assert.throws(() => f.S.loadData(), e => ['CORRUPT_DATA', 'VERSION'].includes(e.type)); assert.equal(f.storage.getItem(f.S.KEY), value); if (value !== '{') f.S.resetDemoData(); else f.S.resetDemoData(); }
 f.storage.failRead = true; throwsType(() => f.S.loadData(), 'STORAGE_READ');
});
test('T05 storage failure while reconciling refuses further mutation', () => { const f = fixture(), r = reserve(f); f.time('14:16:00'); f.storage.failWrite = true; throwsType(() => f.S.act(r.id, 'CHECKIN'), 'STORAGE_WRITE'); f.storage.failWrite = false; assert.equal(record(f.S, r.id).status, 'PENDING_CHECKIN'); assert.equal(f.S.listMyReservations()[0].status, 'EXPIRED'); });
test('T30 reset only project keys, demo clock persists and returning time does not resurrect terminal', () => {
 const f = fixture(); f.storage.setItem('another-project', 'keep'); f.S.initializeDemoData(); assert.equal(f.S.isDemo(), true); assert.equal(f.reload().getNow(), ts('13:40:00')); assert.equal(f.S.loadData().reservations[0].studentId, 'student02');
 f.S.setDemoTime(ts('14:16:00')); assert.equal(f.S.loadData().reservations[0].status, 'EXPIRED'); f.S.setDemoTime(ts('13:40:00')); assert.equal(f.S.loadData().reservations[0].status, 'EXPIRED');
 f.S.resetDemoData(); assert.equal(f.S.loadData().reservations.length, 0); assert.equal(f.S.isDemo(), false); assert.equal(f.storage.getItem('another-project'), 'keep');
});
test('M01 legacy migration is explicit read-only, once only, no fabricated year', () => { const f = fixture(); f.storage.setItem('studyseat_booking', '{"date":"10月25日"}'); assert(f.S.legacyData()); f.S.importLegacyPreview(); assert.equal(f.S.legacyData(), null); assert.equal(f.S.loadData().reservations.length, 0); assert(f.S.loadData().legacyPreview.booking.includes('10月25日')); f.S.resetDemoData(); assert.equal(f.storage.getItem('studyseat_booking'), null); });
test('T14 full room availability recovers when query changes and cancellation stays empty', () => {
 const f = fixture(), d = f.S.loadData(); d.seats.filter(s => s.roomId === 'east-b203').forEach(s => s.enabled = s.label === 'A02'); f.S.saveData(d);
 const r = reserve(f); assert.equal(f.S.listAvailableSeats(r.roomId, r.startAt, r.endAt).filter(s => s.available).length, 0);
 assert.equal(f.S.listAvailableSeats(r.roomId, r.endAt, ts('18:00:00')).filter(s => s.available).length, 1); f.S.act(r.id, 'CANCEL'); assert.equal(f.reload().listMyReservations().filter(r => f.S.ACTIVE.includes(r.status)).length, 0);
});
test('M01 schema-invalid values never silently initialize over existing data', () => {
 const f = fixture();
 for (const value of ['null', 'false', '0', '[]', JSON.stringify({...f.S.loadData(), authAttempts: []})]) {
  f.storage.setItem(f.S.KEY,value); throwsType(()=>f.S.loadData(),'CORRUPT_DATA'); assert.equal(f.storage.getItem(f.S.KEY),value); f.S.resetDemoData();
 }
});
test('T16/T23 repeated check-in during leave cannot cancel leave or resurrect a terminal', () => {
 const f=fixture(),r=reserve(f);f.time('14:00:00');f.S.act(r.id,'CHECKIN');f.S.act(r.id,'LEAVE');const before=events(f.S,r.id).length;
 assert.equal(f.S.act(r.id,'CHECKIN').status,'ON_LEAVE');assert.equal(events(f.S,r.id).length,before);
 f.S.act(r.id,'COMPLETE');assert.equal(f.S.act(r.id,'CHECKIN').status,'COMPLETED');assert.equal(events(f.S,r.id).length,before+1);
});
test('T11 closing receipt and retrying a successful old draft does not duplicate after cancellation',()=>{
 const f=fixture(),r=reserve(f,{},'receipt');f.S.act(r.id,'CANCEL');f.time('18:00:00');const again=reserve(f,{},'receipt');assert.equal(again.id,r.id);assert.equal(again.status,'CANCELLED');assert.equal(f.S.loadData().reservations.length,1);assert.equal(events(f.S,r.id).filter(e=>e.action==='CREATED').length,1);
});
test('Original student login uses the original public credentials and rejects the replaced password',()=>{
 const f=fixture();f.S.logout();throwsType(()=>f.S.login('student01','Study1234','student'),'CREDENTIALS');throwsType(()=>f.S.login('832402116','Study1234','student'),'CREDENTIALS');
 const s=f.S.login('832402116','123456','student');assert.equal(s.id,'student01');assert.equal(s.username,'832402116');assert.equal(s.name,'申子衡');
 assert.equal(f.S.accounts.find(a=>a.id==='student01').username,'832402116');assert(f.S.accounts.every(a=>!Object.hasOwn(a,'password')));
 assert(!f.session.getItem('studyseat:v2:session').includes('123456'));assert(!f.storage.getItem(f.S.KEY).includes('123456'));
});
test('Changing public credentials preserves old session, draft, reservation and attendance ownership',()=>{
 const f=fixture(),r=reserve(f);f.S.saveDraft({...selection(),submitToken:'existing-draft'});
 f.session.setItem('studyseat:v2:session',JSON.stringify({id:'student01',role:'student',name:'学生 A'}));
 const oldRecords=f.S.loadData().reservations,oldEvents=f.S.loadData().events,S=f.reload();assert.equal(S.getSession().username,'832402116');assert.equal(S.getSession().name,'申子衡');assert.equal(S.getDraft().submitToken,'existing-draft');assert.equal(S.listMyReservations()[0].id,r.id);
 S.logout();S.login('832402116','123456','student');assert.deepEqual(S.loadData().reservations,oldRecords);assert.deepEqual(S.loadData().events,oldEvents);assert.equal(S.getDraft().studentId,'student01');
 S.login('student02','Study1234','student');assert.equal(S.listMyReservations().length,0);throwsType(()=>S.act(r.id,'CANCEL'),'NOT_FOUND');
});
test('Original public username retains the existing student account lock across reload',()=>{
 const f=fixture(),d=f.S.loadData();d.authAttempts.student01={count:5,until:ts('13:50:00')};f.S.saveData(d);f.S.logout();
 throwsType(()=>f.reload().login('832402116','123456','student'),'LOCKED');assert.equal(f.S.loadData().authAttempts.student01.until,ts('13:50:00'));
 f.time('13:50:00');assert.equal(f.S.login('832402116','123456','student').id,'student01');assert(!Object.hasOwn(f.S.loadData().authAttempts,'student01'));
});
