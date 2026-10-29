/* Static prototype domain. No server authorization or cross-tab locking is implied. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    const adapter = name => ({ getItem: key => root[name].getItem(key), setItem: (key, value) => root[name].setItem(key, value), removeItem: key => root[name].removeItem(key) });
    root.StudySeat = factory({ storage: adapter('localStorage'), session: adapter('sessionStorage') });
  }
})(typeof window !== 'undefined' ? window : globalThis, function createStudySeat(options) {
  'use strict';
  const storage = options.storage, session = options.session;
  const KEY = 'studyseat:v2:data', CLOCK = 'studyseat:v2:clock', DRAFT = 'studyseat:v2:draft';
  const ACTIVE = ['PENDING_CHECKIN', 'IN_USE', 'ON_LEAVE'];
  const STATUS = { PENDING_CHECKIN: '待签到', IN_USE: '使用中', ON_LEAVE: '暂离中', COMPLETED: '已结束', EXPIRED: '已超时', CANCELLED: '已取消' };
  // Login names can change without changing reservation ownership or existing sessions.
  const accounts = [{ id: 'student01', username: '832402116', role: 'student', name: '申子衡', password: '123456' }, { id: 'student02', username: 'student02', role: 'student', name: '学生 B', password: 'Study1234' }, { id: 'admin01', username: 'admin01', role: 'admin', name: '演示管理员', password: 'Admin1234' }];
  function fail(type, message, extra) { throw Object.assign(new Error(message), { type }, extra); }
  function read(key, target = storage) {
    try { const value = target.getItem(key); return value === null ? undefined : JSON.parse(value); }
    catch (e) { fail(e instanceof SyntaxError ? 'CORRUPT_DATA' : 'STORAGE_READ', e instanceof SyntaxError ? '本项目保存的数据损坏，请查看恢复选项。' : '无法读取本地存储，请允许存储后重试。'); }
  }
  function write(key, value, target = storage) { try { target.setItem(key, JSON.stringify(value)); } catch (_) { fail('STORAGE_WRITE', '保存失败，请检查浏览器存储空间或权限后重试；本次操作未成功。'); } }
  function remove(key, target = storage) { try { target.removeItem(key); } catch (_) { fail('STORAGE_WRITE', '无法清理本项目数据，请检查存储权限。'); } }
  function getNow() {
    const real = options.now ? options.now() : Date.now();
    const clock = read(CLOCK);
    if (clock && (!Number.isFinite(clock.at) || !Number.isFinite(clock.realAt))) fail('CORRUPT_DATA', '演示时钟损坏，请重置本项目数据。');
    return clock ? clock.at + real - clock.realAt : real;
  }
  function setDemoTime(at) {
    if (at === null) remove(CLOCK);
    else { if (!Number.isFinite(at)) fail('TIME', '请选择有效的演示时间。'); write(CLOCK, { at, realAt: options.now ? options.now() : Date.now() }); }
    reconcileExpiredReservations();
  }
  function dateKey(at) { return new Date(at + 8 * 3600000).toISOString().slice(0, 10); }
  function atTime(day, time) { return Date.parse(day + 'T' + time + ':00+08:00'); }
  function addDays(day, n) { return dateKey(atTime(day, '00:00') + n * 86400000); }
  function format(at, timeOnly = false) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(timeOnly ? {} : { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at); }
  function uid() { return 'ss-' + (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2)); }
  function freshData() {
    const rooms = [
      { id: 'lib-a101', name: '图书馆 3F 自习室 A101', building: '图书馆', floor: '3F', location: '北校区图书馆 3F 东侧', type: '静音区', capacity: 120, openingHours: [8, 22] },
      { id: 'east-b203', name: '东区教学楼 B203', building: '东区教学楼', floor: '2F', location: '东区教学楼 2F', type: '研讨区', capacity: 48, openingHours: [8, 22] },
      { id: 'activity-24', name: '学生活动中心 24小时自习室', building: '学生活动中心', floor: '1F', location: '西区学生活动中心 1F', type: '通宵区', capacity: 64, openingHours: [0, 24] },
      { id: 'lib-window', name: '图书馆 2F 临窗阅览区', building: '图书馆', floor: '2F', location: '北校区图书馆 2F 西侧', type: '静音区', capacity: 80, openingHours: [8, 22] }
    ];
    return { version: 2, initialized: true, rooms, seats: rooms.flatMap(r => Array.from({ length: r.capacity }, (_, i) => { const label = String.fromCharCode(65 + Math.floor(i / 30)) + String(i % 30 + 1).padStart(2, '0'); return { id: r.id + ':' + label, roomId: r.id, zoneId: label[0], label, enabled: i !== r.capacity - 1 }; })), rules: { version: 'demo-1', maxDurationMinutes: 240, maxAdvanceDays: 7, checkInEarlyMinutes: 10, checkInLateMinutes: 15, leaveLimitMinutes: 30 }, reservations: [], events: [], sequences: {}, authAttempts: {}, legacyHandled: false };
  }
  function validRule(r) { return r && typeof r.version === 'string' && ['maxDurationMinutes', 'maxAdvanceDays', 'checkInEarlyMinutes', 'checkInLateMinutes', 'leaveLimitMinutes'].every(k => Number.isFinite(r[k]) && r[k] >= 0) && r.maxDurationMinutes > 0; }
  function loadData() {
    const d = read(KEY);
    if (d === undefined) { const initial = freshData(); saveData(initial); return initial; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) fail('CORRUPT_DATA', '本项目数据结构损坏，请查看恢复选项。');
    if (d.version !== 2) fail('VERSION', '本项目数据版本不受支持，请保留原数据并选择恢复方式。');
    if (!d.initialized || !Array.isArray(d.rooms) || !d.rooms.length || !Array.isArray(d.seats) || !Array.isArray(d.reservations) || !Array.isArray(d.events) || !validRule(d.rules) || !d.sequences || typeof d.sequences !== 'object' || Array.isArray(d.sequences) || !d.authAttempts || typeof d.authAttempts !== 'object' || Array.isArray(d.authAttempts) ||
      Object.values(d.sequences).some(v => !Number.isSafeInteger(v) || v < 0) || Object.values(d.authAttempts).some(a => !a || !Number.isSafeInteger(a.count) || a.count < 0 || !Number.isFinite(a.until)) ||
      d.rooms.some(r => !r.id || !r.name || !Array.isArray(r.openingHours) || r.openingHours.length !== 2) ||
      d.seats.some(s => !s.id || !s.label || !d.rooms.some(r => r.id === s.roomId) || typeof s.enabled !== 'boolean') ||
      d.reservations.some(r => !r.id || !r.code || !r.studentId || !r.submitToken || !STATUS[r.status] || !Number.isFinite(r.startAt) || !Number.isFinite(r.endAt) || r.endAt <= r.startAt || !Number.isFinite(r.createdAt) || !validRule(r.ruleSnapshot) || !d.seats.some(s => s.id === r.seatId && s.roomId === r.roomId) || (r.status === 'ON_LEAVE' && (!Number.isFinite(r.leaveDeadline) || !Number.isFinite(r.leaveStartedAt))) || (['IN_USE', 'ON_LEAVE'].includes(r.status) && !Number.isFinite(r.checkedInAt))) ||
      d.events.some(e => !e.id || !e.reservationId || !e.action || !Number.isFinite(e.at))) fail('CORRUPT_DATA', '本项目数据缺少必要字段，请查看恢复选项。');
    return d;
  }
  function saveData(d) { write(KEY, d); }
  function getSession() { const s = read('studyseat:v2:session', session), account = s && accounts.find(a => a.id === s.id && a.role === s.role); return account ? { id: account.id, username: account.username, role: account.role, name: account.name } : null; }
  function requireStudent() { const s = getSession(); if (!s || s.role !== 'student') fail('AUTH', '请先使用学生演示账号登录。'); return s; }
  function login(id, password, role) {
    if (!id || !password) fail('REQUIRED', '请填写演示账号和密码。');
    const account = accounts.find(x => x.username === id), attemptKey = account ? account.id : id;
    const d = loadData(), now = getNow(), a = Object.hasOwn(d.authAttempts, attemptKey) ? d.authAttempts[attemptKey] : { count: 0, until: 0 };
    if (a.until > now) fail('LOCKED', '该演示账号已锁定，请在 ' + Math.ceil((a.until - now) / 60000) + ' 分钟后重试。');
    if (a.until && a.until <= now) { a.count = 0; a.until = 0; }
    if (!account || account.password !== password || account.role !== role) { a.count++; if (a.count >= 5) a.until = now + 600000; d.authAttempts = { ...d.authAttempts, [attemptKey]: a }; saveData(d); fail(a.until ? 'LOCKED' : 'CREDENTIALS', a.until ? '连续错误 5 次，该演示账号已锁定 10 分钟。' : '演示账号、密码或所选角色不正确。'); }
    delete d.authAttempts[attemptKey]; saveData(d);
    const s = { id: account.id, username: account.username, name: account.name, role: account.role }; write('studyseat:v2:session', s, session); return s;
  }
  function logout() { remove('studyseat:v2:session', session); }
  function event(d, r, action, at, actorId, reason, processedAt) { d.events.push({ id: uid(), reservationId: r.id, action, at, actorId, reason: reason || '', processedAt: processedAt ?? at }); }
  function reconcile(d, now) {
    let changed = false;
    for (const r of d.reservations) {
      let status, at, reason;
      if (r.status === 'PENDING_CHECKIN' && now > r.startAt + r.ruleSnapshot.checkInLateMinutes * 60000) { status = 'EXPIRED'; at = r.startAt + r.ruleSnapshot.checkInLateMinutes * 60000; reason = '未在签到窗口内到场'; }
      if (r.status === 'IN_USE' && now >= r.endAt) { status = 'COMPLETED'; at = r.endAt; reason = '预约时段自然结束'; }
      if (r.status === 'ON_LEAVE') {
        if (r.endAt <= r.leaveDeadline && now >= r.endAt) { status = 'COMPLETED'; at = r.endAt; reason = '预约时段自然结束'; }
        else if (r.leaveDeadline < r.endAt && now > r.leaveDeadline) { status = 'EXPIRED'; at = r.leaveDeadline; reason = '暂离超过允许期限'; }
      }
      if (status) { r.status = status; r.updatedAt = at; r.reason = reason; r[status === 'EXPIRED' ? 'expiredAt' : 'completedAt'] = at; event(d, r, status, at, 'system', reason, now); changed = true; }
    }
    return changed;
  }
  function reconcileExpiredReservations() { const d = loadData(); if (reconcile(d, getNow())) saveData(d); return d; }
  function overlap(a, b) { return a.startAt < b.endAt && b.startAt < a.endAt; }
  function validateSelection(d, selection, now) {
    const { roomId, seatId, startAt, endAt } = selection || {};
    const room = d.rooms.find(r => r.id === roomId), seat = d.seats.find(s => s.id === seatId && s.roomId === roomId);
    if (!room || !seat || !seat.enabled) fail('SEAT', '座位无效、已停用或不属于该房间，请重新选座。');
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) fail('TIME', '结束时间必须晚于开始时间。');
    if (endAt - startAt > d.rules.maxDurationMinutes * 60000) fail('DURATION', '单次预约不能超过 ' + d.rules.maxDurationMinutes / 60 + ' 小时。');
    const day = dateKey(startAt), today = dateKey(now);
    if (day < today || day > addDays(today, d.rules.maxAdvanceDays)) fail('DATE_RANGE', '请选择当天至未来 ' + d.rules.maxAdvanceDays + ' 天内的日期。');
    if (startAt < now) fail('PAST', '不能预约已经过去的时段，请调整开始时间。');
    const open = atTime(day, String(room.openingHours[0]).padStart(2, '0') + ':00');
    const close = room.openingHours[1] === 24 ? atTime(addDays(day, 1), '00:00') : atTime(day, String(room.openingHours[1]).padStart(2, '0') + ':00');
    if (startAt < open || endAt > close) fail('OPENING_HOURS', '所选时段超出房间开放时间。');
    return { room, seat };
  }
  function validateReservation(d, studentId, selection, now) {
    validateSelection(d, selection, now);
    const own = d.reservations.find(r => ACTIVE.includes(r.status) && r.studentId === studentId && overlap(r, selection));
    if (own) fail('SELF_CONFLICT', '本人已有预约 ' + own.code + '（' + format(own.startAt) + '–' + format(own.endAt, true) + '），时段不能重叠。', { reservationId: own.id });
    if (d.reservations.some(r => ACTIVE.includes(r.status) && r.seatId === selection.seatId && overlap(r, selection))) fail('SEAT_CONFLICT', '该座位在所选时段已被预约，请重新选座。');
  }
  function createReservation(selection, submitToken) {
    const s = requireStudent(), d = reconcileExpiredReservations(), now = getNow();
    if (!submitToken || typeof submitToken !== 'string') fail('TOKEN', '选择草稿无效，请重新选座。');
    const existing = d.reservations.find(r => r.studentId === s.id && r.submitToken === submitToken);
    if (existing) return existing;
    validateReservation(d, s.id, selection, now);
    const day = dateKey(now).replaceAll('-', '');
    const sequence = Math.max(d.sequences[day] || 0, ...d.reservations.filter(r => r.code.startsWith('SE-' + day + '-')).map(r => Number(r.code.split('-')[2]) || 0)) + 1;
    d.sequences[day] = sequence;
    const r = { id: uid(), code: 'SE-' + day + '-' + String(sequence).padStart(4, '0'), studentId: s.id, roomId: selection.roomId, seatId: selection.seatId, startAt: selection.startAt, endAt: selection.endAt, status: 'PENDING_CHECKIN', createdAt: now, updatedAt: now, checkedInAt: null, leaveStartedAt: null, leaveDeadline: null, completedAt: null, cancelledAt: null, expiredAt: null, reason: '', ruleSnapshot: { ...d.rules }, submitToken };
    d.reservations.push(r); event(d, r, 'CREATED', now, s.id); saveData(d); return r;
  }
  function act(id, action) {
    const s = requireStudent(), d = reconcileExpiredReservations(), r = d.reservations.find(x => x.id === id && x.studentId === s.id), now = getNow();
    if (!r) fail('NOT_FOUND', '未找到本人的预约。');
    const repeated = (action === 'CHECKIN' && r.checkedInAt !== null) || (action === 'CANCEL' && r.status === 'CANCELLED') || (action === 'COMPLETE' && r.status === 'COMPLETED') || (action === 'LEAVE' && r.status === 'ON_LEAVE') || (action === 'RETURN' && r.status === 'IN_USE');
    if (!ACTIVE.includes(r.status)) { if (repeated) return r; fail('TERMINAL', r.status === 'EXPIRED' ? '预约已超时，座位已释放，不能恢复使用。' : '预约已进入终态，不能执行此操作。'); }
    if (repeated) return r;
    if (action === 'CHECKIN') {
      if (r.status !== 'PENDING_CHECKIN') fail('STATE', '当前状态不能签到。');
      if (now < r.startAt - r.ruleSnapshot.checkInEarlyMinutes * 60000) fail('WINDOW_NOT_OPEN', '签到尚未开放，开放时间：' + format(r.startAt - r.ruleSnapshot.checkInEarlyMinutes * 60000));
      r.status = 'IN_USE'; r.checkedInAt = now;
    } else if (action === 'CANCEL' && r.status === 'PENDING_CHECKIN') { r.status = 'CANCELLED'; r.cancelledAt = now; r.reason = '本人取消预约，释放未来剩余时段'; }
    else if (action === 'LEAVE' && r.status === 'IN_USE') { r.status = 'ON_LEAVE'; r.leaveStartedAt = now; r.leaveDeadline = now + r.ruleSnapshot.leaveLimitMinutes * 60000; }
    else if (action === 'RETURN' && r.status === 'ON_LEAVE') { r.status = 'IN_USE'; }
    else if (action === 'COMPLETE' && ['IN_USE', 'ON_LEAVE'].includes(r.status)) { r.status = 'COMPLETED'; r.completedAt = now; r.reason = '本人结束使用，释放未来剩余时段'; }
    else fail('STATE', '当前状态不允许该操作；使用中或暂离中请结束使用。');
    r.updatedAt = now; event(d, r, action, now, s.id, r.reason); saveData(d); return r;
  }
  function listAvailableSeats(roomId, startAt, endAt) { const d = reconcileExpiredReservations(); return d.seats.filter(s => s.roomId === roomId).map(s => ({ ...s, available: s.enabled && !d.reservations.some(r => ACTIVE.includes(r.status) && r.seatId === s.id && overlap(r, { startAt, endAt })) })); }
  function listMyReservations() { const s = requireStudent(); return reconcileExpiredReservations().reservations.filter(r => r.studentId === s.id); }
  function saveDraft(draft) { const s = requireStudent(); write(DRAFT, { ...draft, studentId: s.id }); }
  function getDraft() { const d = read(DRAFT), s = getSession(); return d && s && d.studentId === s.id ? d : null; }
  function legacyData() {
    const d = loadData(); if (d.legacyHandled) return null;
    try { const selection = storage.getItem('studyseat_selection'), booking = storage.getItem('studyseat_booking'); return selection || booking ? { selection, booking } : null; } catch (_) { fail('STORAGE_READ', '无法读取旧演示数据。'); }
  }
  function importLegacyPreview() { const d = loadData(); d.legacyPreview = legacyData(); d.legacyHandled = true; saveData(d); }
  function resetDemoData() {
    // Write before removal: failure must leave existing records intact.
    saveData(freshData());
    for (const k of [CLOCK, DRAFT, 'studyseat_selection', 'studyseat_booking']) remove(k);
  }
  function initializeDemoData() {
    resetDemoData(); setDemoTime(Date.parse('2026-10-26T13:40:00+08:00'));
    const d = loadData(), startAt = atTime('2026-10-26', '14:00'), endAt = atTime('2026-10-26', '16:00');
    const r = { id: uid(), code: 'SE-20261026-0001', studentId: 'student02', roomId: 'east-b203', seatId: 'east-b203:A01', startAt, endAt, status: 'PENDING_CHECKIN', createdAt: getNow(), updatedAt: getNow(), checkedInAt: null, leaveStartedAt: null, leaveDeadline: null, completedAt: null, cancelledAt: null, expiredAt: null, reason: '', ruleSnapshot: { ...d.rules }, submitToken: 'fixture-student02' };
    d.reservations.push(r); d.sequences['20261026'] = 1; event(d, r, 'CREATED', r.createdAt, 'student02', '明确标记的演示占用'); saveData(d);
  }
  return { KEY, CLOCK, DRAFT, STATUS, ACTIVE, accounts: accounts.map(({ password, ...a }) => a), loadData, saveData, getNow, setDemoTime, dateKey, atTime, addDays, format, uid, getSession, login, logout, requireStudent, createReservation, validateReservation, validateSelection, listAvailableSeats, listMyReservations, act, reconcileExpiredReservations, saveDraft, getDraft, legacyData, importLegacyPreview, resetDemoData, initializeDemoData, isDemo: () => !!read(CLOCK) };
});
