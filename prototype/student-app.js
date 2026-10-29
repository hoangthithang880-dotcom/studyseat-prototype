/* Shared page adapter: all successful UI transitions follow domain persistence. */
(function () {
  'use strict';
  const S = window.StudySeat, page = location.pathname.split('/').pop() || 'index.html';
  const allowed = ['home.html', 'room.html', 'confirm.html', 'bookings.html', 'profile.html', 'rules.html', 'resources.html', 'records.html'];
  const adminPages = ['rules.html', 'resources.html', 'records.html'];
  // Resource and page URLs must change together when a browser has cached an older release.
  const appVersion = new URL(document.currentScript?.src || location.href).searchParams.get('v');
  function versionedPage(href) {
    if (!appVersion || !href || href.startsWith('#')) return href;
    const url = new URL(href, location.href), name = url.pathname.split('/').pop();
    if (url.origin !== location.origin || !['login.html', ...allowed].includes(name)) return href;
    url.searchParams.set('v', appVersion);
    return name + url.search + url.hash;
  }
  function navigate(href, replace = false) { if (replace) location.replace(versionedPage(href)); else location.href = versionedPage(href); }
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor) anchor.setAttribute('href', versionedPage(anchor.getAttribute('href')));
  }, true);

  const $ = (s, el = document) => el.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const button = (text, id, cls = '') => `<button type="button" class="ss-btn ${cls}" id="${id}">${text}</button>`;
  let filter = 'ALL', currentSelection = null, pendingAction = null, refreshed = '', lastClockRender = 0;
  function message(error) {
    const activeDialog = $('#ss-modal[open] .ss-dialog-inner');
    const activeSheet = $('#checkinModal:not(.hidden)>div:last-child') || $('#cancelModal:not(.hidden)>div:last-child');
    const messageId = activeDialog ? 'ss-modal-message' : activeSheet ? activeSheet.parentElement.id + '-message' : 'ss-message';
    let box = $('#' + messageId);
    if (!box) { box = document.createElement('div'); box.id = messageId; box.className = 'ss-notice ss-error ss-message'; box.setAttribute('role', 'alert'); (activeDialog || activeSheet || $('#ss-main') || $('.content') || $('.form')).prepend(box); }
    box.textContent = error.message || String(error); box.style.display = 'block'; box.scrollIntoView({ block: 'nearest' });
  }
  function safe(fn) { return (...args) => { try { return fn(...args); } catch (e) { if (['CORRUPT_DATA', 'VERSION', 'STORAGE_READ'].includes(e.type)) recovery(e); else message(e); } }; }
  function modal(title, html) {
    $('#ss-modal')?.remove();
    const dialog = document.createElement('dialog'); dialog.id = 'ss-modal'; dialog.className = 'ss-dialog';
    dialog.innerHTML = `<div class="ss-dialog-inner"><div class="ss-topline"><h2>${esc(title)}</h2><button type="button" class="ss-btn" id="close-modal" aria-label="关闭弹窗">关闭</button></div>${html}</div>`;
    document.body.append(dialog); $('#close-modal').onclick = () => dialog.close(); dialog.showModal(); return dialog;
  }
  function confirmAction(title, description, fn) {
    modal(title, `<p>${esc(description)}</p><div class="ss-actions">${button('确认', 'accept-action', 'primary')}${button('返回', 'reject-action')}</div>`);
    $('#reject-action').onclick = () => $('#ss-modal').close();
    $('#accept-action').onclick = safe(() => { fn(); $('#ss-modal')?.close(); });
  }
  function recovery(e) {
    $('#ss-modal')?.remove();
    const root = $('#app') || $('.phone');
    root.innerHTML = `<div class="ss-recovery"><h1>本地数据需要恢复</h1><p role="alert">${esc(e.message)}</p><p>原数据暂时保留。可先下载本项目数据备份，再重置本项目模拟记录。重置不会清除同一来源的其他项目数据。</p><div class="ss-actions">${button('下载原数据备份', 'backup')}${button('重试读取', 'retry', 'primary')}${button('重置本项目演示数据', 'recover-reset', 'danger')}</div><p id="recovery-error" role="alert"></p><a href="login.html">返回登录</a></div>`;
    $('#backup').onclick = () => { try { const keys = [S.KEY, S.CLOCK, S.DRAFT, 'studyseat_selection', 'studyseat_booking']; const blob = new Blob([JSON.stringify(Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'studyseat-backup.json'; a.click(); URL.revokeObjectURL(url); } catch (_) { $('#recovery-error').textContent = '读取备份失败，请检查浏览器存储权限。'; } };
    $('#retry').onclick = () => location.reload();
    $('#recover-reset').onclick = () => confirmAction('重置本项目数据', '将清除本项目所有模拟预约、考勤、选择草稿、时钟和旧演示数据。其他项目的数据不受影响。', () => { try { S.resetDemoData(); location.reload(); } catch (error) { $('#ss-modal').close(); $('#recovery-error').textContent = error.message; } });
  }
  function loginPage() {
    let role = 'student';
    const hint = () => { $('#login-hint').textContent = role === 'student' ? '原版学生：832402116 / 123456（申子衡）；学生 B：student02 / Study1234。均为公开演示账号。' : '管理员：admin01 / Admin1234。管理界面保存等功能待后续补充。'; };
    document.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { role = b.dataset.role; document.querySelectorAll('[data-role]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); $('label[for="account"]').textContent = role === 'student' ? '学生演示账号' : '管理员演示账号'; $('#login-error').textContent = ''; hint(); });
    const eye = $('.eye'); const showPassword = () => { $('#pwd').type = $('#pwd').type === 'password' ? 'text' : 'password'; eye.setAttribute('aria-label', $('#pwd').type === 'password' ? '显示密码' : '隐藏密码'); };
    eye.onclick = showPassword; eye.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPassword(); } };
    $('#login-form').onsubmit = e => { e.preventDefault(); try { const s = S.login($('#account').value.trim(), $('#pwd').value, role); const target = new URLSearchParams(location.search).get('next'); navigate(s.role === 'admin' ? 'rules.html' : allowed.includes(target) && !adminPages.includes(target) ? target : 'home.html'); } catch (error) { if (['CORRUPT_DATA', 'VERSION', 'STORAGE_READ'].includes(error.type)) recovery(error); else $('#login-error').textContent = error.message; } };
    hint(); S.loadData();
  }
  function toolbar(session) {
    const root = $('#app') || $('.phone'), status = root.firstElementChild;
    status.classList.add('ss-status'); status.firstElementChild.id = 'ss-clock';
    const controls = document.createElement('span'); controls.className = 'ss-tools'; controls.title = session.name + ' · 本地模拟';
    controls.innerHTML = '<button type="button" id="demo-tools">演示工具</button><button type="button" id="logout">退出</button>';
    status.insertBefore(controls, status.lastElementChild);
    $('#demo-tools').onclick = safe(demoTools); $('#logout').onclick = safe(() => { S.logout(); navigate('login.html'); }); updateClock();
  }
  function updateClock() {
    const el = $('#ss-clock'); if (!el) return;
    const now = S.getNow(), demo = S.isDemo(); el.classList.toggle('demo', demo); el.title = (demo ? '演示时钟 · ' : '北京时间 · ') + S.format(now);
    el.textContent = demo ? '演示 ' + S.dateKey(now).slice(5).replace('-', '/') + ' ' + S.format(now,true) : S.format(now,true).slice(0,5);
  }
  function legacyPrompt() {
    const legacy = S.legacyData(); if (!legacy) return;
    modal('发现旧版演示数据', `<p>旧版日期可能没有年份，不能直接作为真实预约。可导入为只读档案查看；推荐备份后重置本项目数据。</p><pre>${esc(JSON.stringify(legacy, null, 2))}</pre><div class="ss-actions">${button('导入旧演示数据（只读）', 'legacy-import')}${button('重置本项目演示数据', 'legacy-reset', 'danger')}</div>`);
    $('#legacy-import').onclick = safe(() => { S.importLegacyPreview(); $('#ss-modal').close(); });
    $('#legacy-reset').onclick = () => confirmAction('重置旧演示数据', '清除本项目新旧模拟预约、考勤、草稿和时钟；不会清除其他项目的数据。', () => { S.resetDemoData(); location.reload(); });
  }
  function defaultConditions() {
    const now = S.getNow(), day = S.dateKey(now), nextHour = Math.ceil((now - S.atTime(day, '00:00')) / 3600000);
    if (nextHour < 20) { const hour = Math.max(8, nextHour + (nextHour === (now - S.atTime(day, '00:00')) / 3600000 ? 1 : 0)); return { day, start: String(hour).padStart(2, '0') + ':00', end: String(hour + 2).padStart(2, '0') + ':00' }; }
    return { day: S.addDays(day, 1), start: '14:00', end: '16:00' };
  }
  function conditions(draft) { if (!draft?.startAt || !draft?.endAt) return defaultConditions(); return { day: S.dateKey(draft.startAt), start: new Date(draft.startAt + 8 * 3600000).toISOString().slice(11, 16), end: new Date(draft.endAt + 8 * 3600000).toISOString().slice(11, 16) }; }
  function fields(c) {
    const today = S.dateKey(S.getNow()), rule = S.loadData().rules;
    return `<div class="ss-fields"><label>预约日期（北京时间）<select id="query-date">${Array.from({ length: rule.maxAdvanceDays + 1 }, (_, i) => { const day = S.addDays(today, i); const tag = i === 0 ? '今天' : i === 1 ? '明天' : ''; return `<option value="${day}" ${c.day === day ? 'selected' : ''}>${tag} ${S.format(S.atTime(day, '12:00')).split(' ')[0]}</option>`; }).join('')}</select></label><label>开始时间<input id="query-start" type="time" value="${esc(c.start)}" step="60"></label><label>结束时间<input id="query-end" type="time" value="${esc(c.end)}" step="60"></label></div>`;
  }
  function readConditions() { return { startAt: S.atTime($('#query-date').value, $('#query-start').value), endAt: S.atTime($('#query-date').value, $('#query-end').value) }; }
  function bindConditions(fn) { ['#query-date', '#query-start', '#query-end'].forEach(id => $(id).onchange = safe(fn)); }
  function conditionsValid(d, roomId, c) { const seat = d.seats.find(s => s.roomId === roomId && s.enabled); S.validateSelection(d, { roomId, seatId: seat.id, ...c }, S.getNow()); }
  function timeSummary(r) { return `${S.format(r.startAt)} — ${S.format(r.endAt, true)}`; }
  const actions = { CREATED: '创建预约', CHECKIN: '首次签到（页面模拟确认到场）', LEAVE: '暂离', RETURN: '返回座位', CANCEL: '取消预约', COMPLETE: '结束使用', COMPLETED: '自然结束', EXPIRED: '自动超时' };
  function countdown(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); }
  // Bind the existing page markup; never replace a complete normal page with a new design.
  function bindIdentity() {
    const s = S.getSession();
    document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = s.name);
    document.querySelectorAll('[data-user-id]').forEach(el => el.textContent = s.username);
    document.querySelectorAll('[data-user-avatar]').forEach(el => el.textContent = s.id === 'student01' ? s.name.slice(0,1) : 'B');
  }
  function textWithIcon(el, value) {
    if (!el) return;
    const icon = el.querySelector('svg');
    el.replaceChildren(...(icon ? [icon] : []), document.createTextNode(value));
  }
  function homePage() {
    bindIdentity();
    const c = conditions(S.getDraft()), cards = [...document.querySelectorAll('#roomList .room-card')];
    $('#home-query-fields').innerHTML = fields(c);
    const now = S.getNow(), day = S.dateKey(now);
    $('[data-home-day]').textContent = Number(day.slice(-2));
    $('[data-home-month]').textContent = `${Number(day.slice(5,7))}月 · ${S.format(now).match(/周./)?.[0] || ''}`;
    const d = S.loadData();
    document.querySelectorAll('.category-tile').forEach(tile => {
      const count = d.rooms.filter(r => ({ '静音区': 'quiet', '研讨区': 'group', '通宵区': 'night' }[r.type]) === tile.dataset.category).length;
      $('.category-count', tile).textContent = count + ' 间';
    });
    const render = () => {
      const data = S.reconcileExpiredReservations(), query = readConditions(); let total = 0;
      $('#home-query-summary').textContent = `${$('#query-date').value.slice(5).replace('-', '/')} ${$('#query-start').value}–${$('#query-end').value}`;
      let invalid = 0;
      for (const card of cards) {
        const r = data.rooms.find(r => r.id === card.dataset.room); if (!r) continue;
        let valid = true;
        try { conditionsValid(data, r.id, query); } catch (_) { valid = false; invalid++; }
        const free = valid ? S.listAvailableSeats(r.id, query.startAt, query.endAt).filter(s => s.available).length : 0;
        total += free;
        $('h4', card).textContent = r.name;
        textWithIcon($('h4', card).nextElementSibling, r.location);
        const value = $('strong', card); value.textContent = free;
        [...value.parentElement.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).forEach(n => n.textContent = ` / ${r.capacity} 空位`);
        const progress = value.parentElement.nextElementSibling?.firstElementChild;
        if (progress) progress.style.width = (free / r.capacity * 100) + '%';
        card.dataset.available = String(valid && free > 0);
        card.dataset.keywords = `${r.name} ${r.location} ${r.type} 插座 WiFi`;
        card.onclick = safe(e => { e.preventDefault(); S.saveDraft({ ...readConditions(), roomId: r.id, seatId: null, submitToken: S.uid() }); navigate(card.getAttribute('href')); });
      }
      $('main>section:first-child strong').textContent = total;
      if (invalid === cards.length) { $('#ss-message').textContent = '所选条件没有可用时段，请展开上方查询条件调整日期或时间。'; $('#ss-message').style.display = 'block'; }
      else $('#ss-message').style.display = 'none';
      window.applyFilters();
    };
    bindConditions(render); render(); window.ssRefresh = render;
  }
  function roomPage() {
    const d = S.reconcileExpiredReservations(), draft = S.getDraft();
    const roomId = new URLSearchParams(location.search).get('roomId') || draft?.roomId || d.rooms[0].id;
    const room = d.rooms.find(r => r.id === roomId);
    if (!room) { $('#ss-main').innerHTML = '<div class="ss-card"><h2>未找到该房间</h2><a href="home.html">重新选择房间</a></div>'; return; }
    document.querySelectorAll('[data-room-name]').forEach(el => el.textContent = room.name);
    $('[data-room-location]').textContent = room.location;
    $('[data-room-opening]').textContent = `${String(room.openingHours[0]).padStart(2,'0')}:00–${room.openingHours[1]}:00`;
    $('[data-room-capacity]').textContent = room.capacity + ' 座';
    $('[data-room-art-location]').textContent = `${room.building} · ${room.floor}`;
    $('[data-room-art-floor]').textContent = `${room.building} · ${room.floor}`;
    const c = conditions(draft?.roomId === roomId ? draft : null), holder = document.createElement('div'); holder.innerHTML = fields(c);
    $('#query-date').innerHTML = $('#query-date', holder).innerHTML;
    $('#query-start').value = c.start; $('#query-end').value = c.end;
    let selectedId = draft?.roomId === roomId ? draft.seatId : null;
    const seats = d.seats.filter(s => s.roomId === roomId), zones = [...new Set(seats.map(s => s.zoneId))];
    let zone = seats.find(s => s.id === selectedId)?.zoneId || zones[0];
    const saveConditions = () => { selectedId = null; S.saveDraft({ roomId, seatId: null, ...readConditions(), submitToken: S.uid() }); render(); };
    const dateClass = 'date-chip h-[55px] rounded-[14px] border border-[#E2E8F0] bg-white flex flex-col items-center justify-center gap-1';
    const slotClass = 'slot-chip h-[48px] rounded-[14px] border border-[#E2E8F0] bg-white flex flex-col items-center justify-center';
    const render = () => {
      const query = readConditions(), data = S.reconcileExpiredReservations(); let valid = true;
      try { conditionsValid(data, roomId, query); $('#ss-message').style.display = 'none'; } catch (e) { valid = false; message(e); }
      const all = S.listAvailableSeats(roomId, query.startAt, query.endAt);
      if (!valid || !all.some(s => s.id === selectedId && s.available)) selectedId = null;
      const today = S.dateKey(S.getNow());
      $('#dateRow').innerHTML = Array.from({ length: data.rules.maxAdvanceDays + 1 }, (_, i) => {
        const day = S.addDays(today,i), weekday = i === 0 ? '今天' : i === 1 ? '明天' : S.format(S.atTime(day,'12:00')).match(/周./)[0];
        return `<button type="button" class="${dateClass} ${day === $('#query-date').value ? 'is-active' : ''}" data-day="${day}"><span class="date-weekday text-[8px] text-[#64748B]">${weekday}</span><span class="text-[14px] font-semibold leading-none">${Number(day.slice(-2))}</span></button>`;
      }).join('');
      document.querySelectorAll('[data-day]').forEach(b => b.onclick = safe(() => { $('#query-date').value = b.dataset.day; saveConditions(); }));
      const slots = [['08:00','10:00'],['14:00','18:00'],['13:00','15:00'],['15:00','17:00'],['18:00','20:00'],['20:00','22:00']];
      $('#slotGrid').innerHTML = slots.map(([start,end],i) => {
        const q = { startAt: S.atTime($('#query-date').value,start), endAt: S.atTime($('#query-date').value,end) }; let available = true, reason = '';
        try { conditionsValid(data, roomId, q); } catch(e) { available = false; reason = e.message; }
        const count = available ? S.listAvailableSeats(roomId,q.startAt,q.endAt).filter(s => s.available).length : 0;
        return `<button type="button" class="${slotClass} ${$('#query-start').value === start && $('#query-end').value === end ? 'is-active' : ''}" data-slot="${i}" ${available ? '' : 'disabled'} title="${esc(reason)}"><span class="text-[11px] font-semibold">${start}–${end}</span><span class="slot-count text-[8px] text-[#64748B] mt-0.5">${available ? count ? '余 ' + count : '已满' : '不可预约'}</span></button>`;
      }).join('');
      document.querySelectorAll('[data-slot]').forEach(b => b.onclick = safe(() => { const slot = slots[Number(b.dataset.slot)]; $('#query-start').value = slot[0]; $('#query-end').value = slot[1]; saveConditions(); }));
      $('#zoneTabs').style.gridTemplateColumns = `repeat(${zones.length}, minmax(0,1fr))`;
      $('#zoneTabs').innerHTML = zones.map(z => `<button type="button" class="zone-tab ${zone === z ? 'is-active' : ''} h-8 rounded-[11px] text-[10px] font-semibold text-[#64748B]" data-zone="${z}">${z} 区</button>`).join('');
      document.querySelectorAll('[data-zone]').forEach(b => b.onclick = safe(() => { zone = b.dataset.zone; render(); }));
      const visible = all.filter(s => s.zoneId === zone), free = valid ? all.filter(s => s.available).length : 0;
      $('[data-room-available]').textContent = free + ' 座';
      $('#zoneCount').textContent = `${zone} 区余 ${valid ? visible.filter(s => s.available).length : 0} / ${visible.length}`;
      $('#seatGrid').innerHTML = visible.map(s => {
        const state = !valid || !s.enabled ? 'occupied' : !s.available ? 'booked' : selectedId === s.id ? 'selected' : 'available';
        const label = !s.enabled ? '停用' : !valid ? '时段无效' : !s.available ? '已预约' : selectedId === s.id ? '已选' : '可选';
        return `<button type="button" class="seat ${state}" data-seat="${s.id}" aria-pressed="${s.id === selectedId}" ${valid && s.available ? '' : 'disabled'}>${s.label}<small>${label}</small></button>`;
      }).join('');
      let empty = $('#no-seats'); if (!empty) { empty = document.createElement('p'); empty.id = 'no-seats'; empty.className = 'ss-small mt-3'; $('#seatGrid').after(empty); }
      empty.textContent = free ? '' : '当前条件没有可用座位，请调整日期或时段；查询条件已保留。';
      $('#selectedSeatText').textContent = selectedId ? `${all.find(s => s.id === selectedId).label} 座` : '还未选择座位';
      $('#zoneBadge').textContent = zone + ' 区'; $('#zoneBadge').classList.toggle('hidden', !selectedId);
      $('#selectedTimeText').textContent = `${Number($('#query-date').value.slice(5,7))}月${Number($('#query-date').value.slice(-2))}日 · ${$('#query-start').value}–${$('#query-end').value}`;
      $('#checkoutBtn').setAttribute('aria-disabled', String(!selectedId || !valid));
      $('#checkoutBtn').style.backgroundColor = selectedId && valid ? '#2563eb' : '#cbd5e1';
      document.querySelectorAll('[data-seat]').forEach(b => b.onclick = safe(() => { selectedId = b.dataset.seat; S.saveDraft({ roomId, seatId: selectedId, ...query, submitToken: S.uid() }); render(); }));
    };
    bindConditions(saveConditions);
    window.handleCheckout = safe(e => { e.preventDefault(); if (!selectedId) { window.showToast('请先选择可用座位'); return; } const query = readConditions(); S.validateSelection(S.loadData(), { roomId, seatId: selectedId, ...query }, S.getNow()); const previous = S.getDraft(); S.saveDraft({ roomId, seatId: selectedId, ...query, submitToken: previous?.seatId === selectedId ? previous.submitToken : S.uid() }); navigate('confirm.html'); });
    window.toggleFavorite = () => { $('#favoriteBtn').classList.toggle('text-brand-600'); window.showToast('收藏为演示展示'); };
    window.shareRoom = () => window.showToast('演示链接：room.html?roomId=' + roomId);
    render(); window.ssRefresh = render;
  }
  function confirmPage() {
    bindIdentity();
    const draft = S.getDraft(), d = S.reconcileExpiredReservations(), root = $('#ss-main');
    const invalid = description => { root.innerHTML = `<div class="ss-card ss-empty"><h2>请先选择座位</h2><p>${esc(description)}</p><a class="ss-btn primary" href="room.html">重新查座</a></div>`; $('footer').remove(); };
    if (!draft?.seatId || !draft?.submitToken) { invalid('没有有效的选择草稿，不能提交默认预约。'); return; }
    const room = d.rooms.find(r => r.id === draft.roomId), seat = d.seats.find(s => s.id === draft.seatId && s.roomId === draft.roomId);
    if (!room || !seat) { invalid('选择数据已失效，请重新选座。'); return; }
    const existing = d.reservations.find(r => r.studentId === S.getSession().id && r.submitToken === draft.submitToken);
    try { if (!existing) S.validateSelection(d,draft,S.getNow()); } catch(e) { invalid(e.message); return; }
    const rule = existing?.ruleSnapshot || d.rules;
    document.querySelectorAll('[data-confirm-room]').forEach(el => el.textContent = room.name);
    $('#bookingLocation').textContent = room.location;
    $('#bookingZone').textContent = seat.zoneId + ' 区';
    $('#bookingDate').textContent = S.dateKey(draft.startAt).replaceAll('-','/');
    const date = S.dateKey(draft.startAt), today = S.dateKey(S.getNow()), tag = date === today ? '今天' : date === S.addDays(today,1) ? '明天' : '';
    $('#bookingWeekday').textContent = S.format(draft.startAt).match(/周./)[0] + (tag ? ' · ' + tag : '');
    $('#bookingTime').textContent = `${S.format(draft.startAt,true).slice(0,5)}–${S.format(draft.endAt,true).slice(0,5)}`;
    $('#bookingTime').nextElementSibling.textContent = (draft.endAt - draft.startAt)/3600000 + ' 小时';
    $('#bookingSeat').textContent = seat.label;
    $('[data-confirm-floor]').textContent = `${room.floor} · ${seat.zoneId}`;
    $('[data-confirm-user]').textContent = `公开演示账号 · ${S.getSession().username}`;
    const windowText = r => `${S.format(r.startAt - r.ruleSnapshot.checkInEarlyMinutes*60000)} — ${S.format(r.startAt + r.ruleSnapshot.checkInLateMinutes*60000,true)}`;
    $('[data-confirm-window]').textContent = '签到窗口：' + windowText({ ...draft, ruleSnapshot: rule });
    $('#ss-back').href = 'room.html?roomId=' + room.id;
    window.closeSuccess = () => $('#successOverlay').classList.add('hidden');
    window.updateAgreement = () => { const checked = $('#agreement').checked; $('#confirmBtn').disabled = !checked; $('#confirmBtn').style.backgroundColor = checked ? '#2563eb' : '#cbd5e1'; };
    window.toggleReminder = () => { const b=$('#reminderToggle'),on=b.dataset.on==='true';b.dataset.on=String(!on);b.classList.toggle('bg-brand-600',!on);b.classList.toggle('bg-[#E2E8F0]',on);$('span',b).classList.toggle('translate-x-[17px]',!on);window.showToast('提醒开关为演示展示，未接入推送'); };
    let busy = false;
    window.confirmBooking = () => {
      if (busy || !$('#agreement').checked) return;
      busy = true; $('#confirmBtn').disabled = true;
      setTimeout(() => {
        try {
          const r = S.createReservation(draft,draft.submitToken);
          $('#modalCode').textContent = r.code; $('#modalDate').textContent = S.format(r.startAt).split(' ')[0]; $('#modalTime').textContent = `${S.format(r.startAt,true).slice(0,5)}–${S.format(r.endAt,true).slice(0,5)}`; $('#modalSeat').textContent = seat.label + ' 座';
          $('[data-receipt-window]').textContent = '签到窗口：' + windowText(r);
          $('#successOverlay h2').textContent = r.status === 'PENDING_CHECKIN' ? '预约成功' : '此草稿已提交';
          $('#successOverlay h2').nextElementSibling.textContent = `${S.STATUS[r.status]} · ${S.ACTIVE.includes(r.status) ? '请按允许窗口签到' : '原预约已进入历史记录，再次预约请重新选座'}`;
          $('#successOverlay').classList.remove('hidden');
        } catch(e) { message(e); $('#conflict-actions').innerHTML = `<div class="ss-actions"><a class="ss-btn" href="room.html?roomId=${room.id}">重新选座（保留条件）</a>${e.type==='SELF_CONFLICT'?'<a class="ss-btn" href="bookings.html">查看已有预约</a>':''}</div>`; }
        finally { busy=false;window.updateAgreement(); }
      },30);
    };
    window.updateAgreement();
  }
  function bookingsPage(preserve = false) {
    const reservations = S.listMyReservations(), d = S.loadData(), now = S.getNow(), root = $('#ss-main'), scroll = root.scrollTop;
    const open = preserve ? [...document.querySelectorAll('details[open]')].map(el=>el.dataset.timeline) : [];
    const tabs = [['ALL','全部'],...Object.entries(S.STATUS)];
    $('#bookingTabs').innerHTML = tabs.map(([status,title])=>`<button type="button" class="booking-tab ${filter===status?'is-active':''} h-9 rounded-[11px] flex items-center justify-center gap-1 text-[10px] font-semibold text-[#64748B]" data-filter="${status}">${title}<span class="tab-count min-w-[16px] h-[16px] px-1 rounded-full bg-[#E2E8F0] text-[8px] flex items-center justify-center text-[#94A3B8]">${reservations.filter(r=>status==='ALL'||r.status===status).length}</span></button>`).join('');
    document.querySelectorAll('#bookingTabs [data-filter]').forEach(b=>b.onclick=safe(()=>{filter=b.dataset.filter;bookingsPage(true);}));
    $('#listCaption').textContent = `${filter==='ALL'?'全部预约':S.STATUS[filter]} · 共 ${reservations.filter(r=>filter==='ALL'||r.status===filter).length} 条`;
    const dateLabel = $('header p'); if(dateLabel) textWithIcon(dateLabel, S.format(now).split(' ')[0] + ' · 北京时间');
    const list = $('#bookingList'); list.replaceChildren();
    const original = $('#booking-card-template').content.firstElementChild;
    const actionButton = (action,title,primary=false) => {
      const b = original.querySelector(`[data-role="actions"] button:${primary?'last':'first'}-child`).cloneNode(true);
      b.type='button'; b.dataset.action=action; b.classList.add('ss-record-action'); textWithIcon(b,title); return b;
    };
    for(const r of reservations.filter(r=>filter==='ALL'||r.status===filter).sort((a,b)=>a.startAt-b.startAt)) {
      const card=original.cloneNode(true),room=d.rooms.find(x=>x.id===r.roomId),seat=d.seats.find(x=>x.id===r.seatId);
      card.dataset.reservation=r.id;card.dataset.state=r.status;
      const badge=$('[data-role="status"]',card);badge.classList.add('ss-status-label',r.status);badge.innerHTML=`<span class="w-1.5 h-1.5 rounded-full" style="background:currentColor"></span>${S.STATUS[r.status]}`;
      $('h2',card).textContent=room.name;
      const location=$('[data-original-id="currentZone"]',card).parentElement;textWithIcon(location,room.location);
      const code=$('[data-original-id="currentCode"]',card);code.textContent=r.code;code.classList.add('ss-record-code');
      $('[data-role="time"]',card).textContent=`${S.format(r.startAt,true).slice(0,5)}–${S.format(r.endAt,true).slice(0,5)}`;
      $('[data-role="time"]',card).previousElementSibling.textContent=S.format(r.startAt).split(' ')[0];
      $('[data-role="seat"]',card).textContent=seat.label+' 座';
      const opening=r.startAt-r.ruleSnapshot.checkInEarlyMinutes*60000;
      const countdownEl=$('[data-role="countdown"]',card);
      if(r.status==='ON_LEAVE')countdownEl.innerHTML=`暂离剩余 <b data-deadline="${r.leaveDeadline}">${countdown(r.leaveDeadline-now)}</b>`;
      else textWithIcon(countdownEl,r.status==='PENDING_CHECKIN'?(now<opening?'签到未开放':'签到窗口内'):S.STATUS[r.status]);
      const hint=$('[data-role="actions"]',card).previousElementSibling.previousElementSibling.querySelector('p');
      hint.setAttribute('data-checkin-hint','');
      hint.textContent=r.status==='PENDING_CHECKIN'?(now<opening?'签到尚未开放，开放时间：'+S.format(opening):'签到窗口已开放，请确认本人到场。'):r.status==='ON_LEAVE'?'暂离截止 '+S.format(r.leaveDeadline):'状态与考勤已保存，可展开查看时间线。';
      const reason=$('[data-role="cancel-note"]',card);reason.textContent=r.reason;reason.classList.toggle('hidden',!r.reason);
      const actionRoot=$('[data-role="actions"]',card);actionRoot.classList.add('ss-record-actions');actionRoot.replaceChildren();
      if(r.status==='PENDING_CHECKIN') {actionRoot.append(actionButton('CANCEL','取消预约'),actionButton('CHECKIN','模拟签到',true));$('[data-action="CHECKIN"]',card).disabled=now<opening;}
      else if(r.status==='IN_USE')actionRoot.append(actionButton('LEAVE','暂离'),actionButton('COMPLETE','结束使用',true));
      else if(r.status==='ON_LEAVE')actionRoot.append(actionButton('COMPLETE','结束使用'),actionButton('RETURN','返回座位',true));
      else {const a=document.createElement('a');a.className='ss-btn';a.href='room.html?roomId='+room.id;a.textContent='重新发起查座';actionRoot.append(a);}
      if(r.checkedInAt!==null) {const used=document.createElement('p');used.className='ss-duration';used.dataset.usedStart=r.checkedInAt;used.dataset.usedEnd=r.completedAt??r.expiredAt??'';used.textContent='实际使用 '+Math.floor(Math.max(0,(r.completedAt??r.expiredAt??now)-r.checkedInAt)/60000)+' 分钟（含暂离）';actionRoot.after(used);}
      const timeline=document.createElement('details');timeline.dataset.timeline=r.id;timeline.open=open.includes(r.id);timeline.innerHTML=`<summary class="ss-timeline-toggle">查看时间线 · 规则 ${esc(r.ruleSnapshot.version)}</summary><ol class="ss-timeline">${d.events.filter(e=>e.reservationId===r.id).map(e=>`<li>${actions[e.action]||esc(e.action)}${e.reason?' · '+esc(e.reason):''}<time>生效 ${S.format(e.at)}${e.processedAt!==e.at?'<br>补处理 '+S.format(e.processedAt):''}</time></li>`).join('')}</ol>`;
      $('.p-4',card).append(timeline);list.append(card);
    }
    $('#emptyBookings').classList.toggle('hidden',list.childElementCount!==0);
    window.closeCheckin = () => { $('#checkinModal').classList.add('hidden'); pendingAction = null; };
    window.closeCancel = () => { $('#cancelModal').classList.add('hidden'); pendingAction = null; };
    window.completeCheckin = safe(() => { if(!pendingAction || pendingAction.action !== 'CHECKIN') return; S.act(pendingAction.id,'CHECKIN'); window.closeCheckin(); bookingsPage(true); });
    window.confirmCancel = safe(() => { if(!pendingAction || !['CANCEL','COMPLETE'].includes(pendingAction.action)) return; S.act(pendingAction.id,pendingAction.action); window.closeCancel(); bookingsPage(true); });
    const openCheckin = id => {
      const r = reservations.find(r=>r.id===id),room=d.rooms.find(x=>x.id===r.roomId),seat=d.seats.find(x=>x.id===r.seatId);
      pendingAction={id,action:'CHECKIN'}; $('#checkinModal-message')?.remove();
      $('#checkinModal h2').nextElementSibling.textContent='请确认本人已到达 '+room.location;
      $('#checkinSeatText').textContent=room.name+' · '+seat.label+' 座';
      if(!$('#qrGrid').childElementCount){const pattern=['11100000111','10101101101','11110010111','00010110000','10110101010','01010110101','11010110101','10101001100','11101100101','10110101110','11101011001'];$('#qrGrid').innerHTML=pattern.flatMap(row=>[...row].map(cell=>`<span class="qr-cell ${cell==='1'?'on':'off'}"></span>`)).join('');}
      $('#checkinModal').dataset.reservation=id; $('#checkinModal').classList.remove('hidden');
    };
    const openCancellation = (id,action) => {
      pendingAction={id,action}; $('#cancelModal-message')?.remove();
      const completing=action==='COMPLETE'; $('#cancelModal h2').textContent=completing?'结束这次使用？':'取消这次预约？';
      $('#cancelModal h2').nextElementSibling.textContent=completing?'确认后释放未来剩余时段，签到与考勤记录保留。':'取消后释放未来剩余时段，预约历史与取消原因保留。仅待签到预约可以取消。';
      $('#cancelModal [onclick="confirmCancel()"]').textContent=completing?'确认结束':'确认取消'; $('#cancelModal').classList.remove('hidden');
    };
    document.querySelectorAll('[data-action]').forEach(b=>b.onclick=safe(()=>{
      const id=b.closest('[data-reservation]').dataset.reservation,action=b.dataset.action;
      if(action==='CHECKIN')openCheckin(id);
      else if(['CANCEL','COMPLETE'].includes(action))openCancellation(id,action);
      else { S.act(id,action);bookingsPage(true); }
    }));
    if(preserve)root.scrollTop=scroll;
  }
  function profilePage() {
    bindIdentity();
    $('[data-profile-account]').textContent='公开演示账号 · '+S.getSession().username;
    const own=S.listMyReservations(),badge=$('main>section:nth-child(2) a[href="bookings.html"] .absolute');if(badge)badge.textContent=own.filter(r=>S.ACTIVE.includes(r.status)).length;
    window.openEditProfile=()=>window.openInfoModal('个人资料','本地模拟账号',`<div class="rounded-2xl border border-[#E2E8F0] bg-white p-4 text-[11px]"><p>${esc(S.getSession().name)}</p><p class="mt-2 text-[#64748B]">${S.getSession().username}</p><p class="mt-3 text-[#64748B]">公开演示信息；未接入学校统一身份认证。</p></div>`);
    if(S.loadData().legacyPreview){$('#legacy-archive-slot').innerHTML=button('查看旧版只读档案','legacy-archive');$('#legacy-archive').onclick=()=>modal('旧版只读档案',`<p>缺失年份未作推定；此档案不参与预约和统计。</p><pre>${esc(JSON.stringify(S.loadData().legacyPreview,null,2))}</pre>`);}
  }

  function demoTools() {
    const records = S.getSession().role === 'student' ? S.listMyReservations() : [];
    modal('演示工具 · 仅供原型演示', `<p>北京时间：${S.format(S.getNow())}。正常访问默认使用真实时钟；演示时钟随实际秒数前进，并跨页保存。</p><label class="ss-field">指定演示时间（北京时间）<input id="demo-time" type="datetime-local" step="1" value="${new Date(S.getNow() + 8 * 3600000).toISOString().slice(0, 19)}"></label><div class="ss-actions">${button('使用演示时间', 'apply-time', 'primary')}${button('切回真实时钟', 'real-time')}</div><label class="ss-field" style="margin-top:16px">选择本人的预约<select id="demo-reservation"><option value="">请选择预约</option>${records.map(r => `<option value="${r.id}">${esc(r.code)} · ${S.STATUS[r.status]}</option>`).join('')}</select></label><div class="ss-actions">${button('签到开放前 1 秒', 'before-window')}${button('签到窗口内', 'in-window')}${button('签到关闭后 1 秒', 'after-window')}${button('暂离期限后 1 秒', 'after-leave')}</div><p class="ss-small">推进使用相同业务函数处理到期；时间倒退不会恢复终态。</p><hr><p>初始化场景：2026-10-26 13:40；学生 B 占用 B203 的 A01，14:00–16:00。将替换本项目现有模拟记录。</p><div class="ss-actions">${button('初始化可重复演示场景', 'seed-demo')}${button('重置本项目演示数据', 'reset-demo', 'danger')}</div>`);
    const done = () => { $('#ss-modal').close(); location.reload(); };
    $('#apply-time').onclick = safe(() => { S.setDemoTime(Date.parse($('#demo-time').value + '+08:00')); done(); });
    $('#real-time').onclick = safe(() => { S.setDemoTime(null); done(); });
    for (const [id, calc] of [['before-window', r => r.startAt - r.ruleSnapshot.checkInEarlyMinutes * 60000 - 1000], ['in-window', r => r.startAt], ['after-window', r => r.startAt + r.ruleSnapshot.checkInLateMinutes * 60000 + 1000], ['after-leave', r => { if (!r.leaveDeadline) throw new Error('请先选择一条已暂离的预约。'); return r.leaveDeadline + 1000; }]]) {
      $('#' + id).onclick = safe(() => { const r = records.find(x => x.id === $('#demo-reservation').value); if (!r) throw new Error('请先选择预约。'); S.setDemoTime(calc(r)); done(); });
    }
    $('#seed-demo').onclick = () => confirmAction('初始化演示场景', '清除本项目预约、考勤、草稿和时钟，并建立学生 B 的演示占用；其他项目数据保留。', () => { S.initializeDemoData(); navigate(S.getSession().role === 'student' ? 'home.html' : 'rules.html'); });
    $('#reset-demo').onclick = () => confirmAction('重置本项目演示数据', '清除本项目预约、考勤、草稿、登录错误次数、时钟和旧数据；保留当前演示会话。不会清除其他项目数据。', () => { S.resetDemoData(); location.reload(); });
  }
  function adminPage() {
    document.querySelectorAll('.phone button,.phone input,.phone select,.phone .switch,.phone .backbtn,.phone .chip,.phone .tabs span').forEach(el => {
      if (el.closest('.ss-tools')) return;
      if (el.classList.contains('backbtn')) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.onclick = () => { navigate('rules.html'); }; el.onkeydown = e => { if (e.key === 'Enter') el.click(); }; return; }
      el.setAttribute('data-demo-placeholder', 'true'); el.title = '演示展示，待后续补充';
      if (['INPUT', 'SELECT'].includes(el.tagName)) el.disabled = true;
      else { if (el.tagName !== 'BUTTON') { el.tabIndex = 0; el.setAttribute('role', 'button'); } el.onclick = () => modal('管理功能待后续补充', '<p>本页为静态展示，尚未实现保存、资源关闭、查询或导出，不会修改模拟预约数据。</p>'); el.onkeydown = e => { if (e.key === 'Enter') el.click(); }; }
    });
  }
  function renderPage() { if (page === 'home.html') homePage(); else if (page === 'room.html') roomPage(); else if (page === 'confirm.html') confirmPage(); else if (page === 'bookings.html') bookingsPage(); else if (page === 'profile.html') profilePage(); else adminPage(); }
  if (!window.showToast) window.showToast = message => { const toast = $('#toast'); if (!toast) return; toast.textContent = message; toast.classList.remove('hidden'); clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200); };
  try {
    if (page === 'login.html') { loginPage(); return; }
    const session = S.getSession();
    if (!session) { navigate('login.html?next=' + (allowed.includes(page) ? page : 'home.html'), true); return; }
    if (adminPages.includes(page) && session.role !== 'admin') { ($('#app') || $('.phone')).innerHTML = '<div class="ss-recovery"><h1>无权限</h1><p>该入口仅供管理员演示账号访问。</p><a class="ss-btn primary" href="home.html">返回学生首页</a></div>'; return; }
    if (!adminPages.includes(page) && session.role === 'admin') { navigate('rules.html', true); return; }
    S.reconcileExpiredReservations(); toolbar(session); renderPage(); legacyPrompt();
    const refresh = safe(() => { const d = S.reconcileExpiredReservations(); const state = JSON.stringify([d.reservations, d.rules]); updateClock(); if (state !== refreshed) { refreshed = state; if (page === 'bookings.html') bookingsPage(true); else window.ssRefresh?.(); } });
    refreshed = JSON.stringify([S.loadData().reservations, S.loadData().rules]);
    setInterval(safe(() => { if (document.hidden) return; const now = S.getNow(); document.querySelectorAll('[data-deadline]').forEach(el => el.textContent = countdown(Number(el.dataset.deadline) - now)); document.querySelectorAll('[data-used-start]').forEach(el => { el.textContent = '实际使用 ' + Math.floor(Math.max(0, (el.dataset.usedEnd ? Number(el.dataset.usedEnd) : now) - Number(el.dataset.usedStart)) / 60000) + ' 分钟（含暂离）'; }); if (now - lastClockRender >= 1000 || now < lastClockRender) { lastClockRender = now; refresh(); if (page === 'bookings.html') { document.querySelectorAll('[data-action="CHECKIN"]').forEach(b => { const r = S.loadData().reservations.find(r => r.id === b.closest('[data-reservation]').dataset.reservation); const opening = r.startAt - r.ruleSnapshot.checkInEarlyMinutes * 60000; b.disabled = now < opening; b.title = b.disabled ? '签到尚未开放' : '页面模拟确认到场'; const hint = b.closest('[data-reservation]').querySelector('[data-checkin-hint]'); if (hint) hint.textContent = b.disabled ? '签到尚未开放，开放时间：' + S.format(opening) : '签到窗口已开放，请确认本人到场。'; }); } } }), 1000);
    document.addEventListener('keydown', e => { if(e.key==='Escape'){window.closeCheckin?.();window.closeCancel?.();window.closeSuccess?.();} });
    window.addEventListener('storage', refresh); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); window.addEventListener('pageshow', refresh);
  } catch (e) { recovery(e); }
})();
