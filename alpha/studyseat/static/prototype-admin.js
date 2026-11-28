const fields = {
  max_duration_minutes: ['单次预约最长时长（分钟）', 1, 1440, 240],
  max_advance_days: ['最多提前预约天数', 1, 30, 7],
  check_in_early_minutes: ['签到提前时间（分钟）', 0, 240, 10],
  check_in_late_minutes: ['签到截止时间（分钟）', 0, 240, 15],
  leave_limit_minutes: ['暂离最长时间（分钟）', 1, 240, 30],
};
const eventNames = {
  LOGIN: '登录', RULES_UPDATED: '更新规则', ROOM_HOURS_UPDATED: '更新每日开放时间',
  ROOM_WEEKLY_HOURS_UPDATED: '更新每周开放安排', RESOURCE_CLOSED: '关闭资源',
  RESOURCE_REOPENED: '重新开放', RESERVATION_CANCELLED_BY_CLOSURE: '资源关闭取消预约',
  RESERVATION_CREATED: '创建预约', RESERVATION_CANCELLED: '取消预约', CHECKED_IN: '签到',
  LEFT_SEAT: '暂离', RETURNED: '返回座位', RESERVATION_FINISHED: '结束使用',
  CHECKIN_EXPIRED: '未签到超时', LEAVE_EXPIRED: '暂离超时', RESERVATION_COMPLETED: '自然结束',
  PERSISTENCE_NOTE_CREATED: '工程验证文本保存',
};
const week = '一二三四五六日';
const tabTitles = {
  rules: '预约规则配置', resources: '资源与关闭安排', records: '共享预约与操作日志',
};

export function createAdmin(context) {
  const {
    api, write, view, html, badge, disabled, pressed, on, byId, date, stamp, clockNow, iso,
    localDay, hoursText, minutes, minuteLabel, showSheet, closeSheet, message, perform, errorText,
    labels, user, active,
  } = context;
  let section = 'rules';
  let rulesTab = 'rules';
  let recordsTab = 'bookings';
  let adminVersion = 0;
  let previewVersion = 0;
  let draftVersion = 0;
  let readError = '';
  let reading = false;
  let currentRules = null;
  let rooms = null;
  let resources = null;
  let reservations = null;
  let events = null;
  let ruleDraft = null;
  let ruleBase = null;
  let openDraft = null;
  let closeDraft = null;
  let recordFilter = {};
  let recordPage = 1;
  let returnClosure = '';
  let openModal = null;
  let writeInProgress = false;

  const safeId = value => encodeURIComponent(value);
  const roomById = id => rooms?.find(room => room.id === id);
  const roomName = id => roomById(id)?.name || id;
  const findClosure = id => resources?.closures.find(record => record.id === id);
  const button = (id, label, style = 'secondary', off = false) =>
    `<button id="${id}" class="${style}" type="button"${disabled(off)}>${html(label)}</button>`;
  const option = (value, name, current) => `<option value="${html(value)}"${value === current ? ' selected' : ''}>${html(name)}</option>`;
  const roomOptions = (selected, all = false) =>
    (all ? option('', '全部自习室', selected) : '') + rooms.map(room => option(room.id, room.name, selected)).join('');
  const timeInput = (id, label, value, type = 'time', extra = '') =>
    `<label class="field">${label}<input id="${id}" type="${type}" value="${html(value)}" required ${extra}></label>`;
  const validTime = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;
  const title = name => `<div class="heading"><h1>${name}</h1></div>`;
  const notice = (value, error = false) => `<p class="notice${error ? ' error' : ''}" role="status">${html(value)}</p>`;

  function dirty() {
    return Boolean(writeInProgress || ruleDraft || openDraft?.changed || closeDraft?.changed);
  }

  function guard(run, clear = () => {
    ruleDraft = ruleBase = null;
    openDraft = closeDraft = null;
    ++previewVersion;
  }) {
    if (writeInProgress) {
      message('请等待本次保存返回。');
      return;
    }
    showSheet({
      title: '有未保存内容', cancel: '继续编辑', confirm: '放弃修改',
      content: '<p>离开前可以继续编辑，或放弃当前未保存的内容。</p>',
      submit: () => {
        clear();
        closeSheet();
        run();
      },
    });
  }

  function render(next) {
    section = next;
    openModal = null;
    ++previewVersion;
    readError = '';
    reading = true;
    paint();
    void load();
  }

  async function load() {
    const version = ++adminVersion;
    const target = section;
    const current = () => active() && version === adminVersion;
    reading = true;
    readError = '';
    updateReadStatus();
    try {
      const paths = target === 'rules' ? ['/rules', '/rooms']
        : target === 'resources' ? ['/rooms', '/admin/resources']
          : ['/rooms', '/admin/reservations?include=student', '/admin/audit-events'];
      const data = await Promise.all(paths.map(path => api(path, undefined, current)));
      if (target === 'rules') [currentRules, rooms] = data;
      else if (target === 'resources') [rooms, resources] = data;
      else [rooms, reservations, events] = data;
      if (current() && !openModal && !writeInProgress) paint();
    } catch (error) {
      if (current()) readError = errorText(error);
    } finally {
      if (current()) {
        reading = false;
        updateReadStatus();
      }
    }
  }

  function updateReadStatus() {
    if (!active()) return;
    const state = byId('admin-read-state');
    if (!state) return;
    state.textContent = reading ? '正在读取管理数据…' : readError;
    state.hidden = !state.textContent;
    state.classList.toggle('error', Boolean(readError));
  }

  function tabs(items, active) {
    return `<div class="tabs">${items.map(([key, name]) =>
      `<button data-admin-tab="${key}" type="button"${pressed(active === key)}>${name}</button>`).join('')}</div>`;
  }

  function paint() {
    if (!active()) return;
    const available = section === 'rules' ? currentRules && rooms
      : section === 'resources' ? resources && rooms : reservations && events && rooms;
    const body = !available ? '' : ({
      rules: () => tabs([['rules', '预约规则'], ['opening', '开放时段']], rulesTab)
        + (rulesTab === 'rules' ? ruleView() : openingView()),
      resources: resourceView,
      records: () => tabs([['bookings', '预约记录'], ['logs', '操作日志']], recordsTab)
        + (recordsTab === 'logs' ? logView() : recordView()),
    })[section]();
    view.innerHTML = `${title(tabTitles[section])}<p class="muted">${html(user.username)} · ${html(user.display_name)}</p>
      <div class="actions">${button('admin-reload', '刷新管理数据')}</div><p id="admin-read-state" class="notice" role="status" hidden></p>${body}`;
    updateReadStatus();
    on('admin-reload', 'click', event => {
      if (writeInProgress) message('请等待本次保存返回。');
      else void perform(event.currentTarget, load);
    });
    view.querySelectorAll('[data-admin-tab]').forEach(item => item.onclick = () => {
      const target = item.dataset.adminTab;
      if (section === 'rules' && rulesTab !== target) {
        const change = () => { rulesTab = target; paint(); };
        if (dirty()) guard(change);
        else change();
      } else if (section === 'records' && recordsTab !== target) {
        recordsTab = target;
        paint();
      }
    });
    if (!available) return;
    if (section === 'rules') {
      if (rulesTab === 'rules') bindRules();
      else bindOpening();
    } else if (section === 'resources') bindResources();
    else if (recordsTab === 'bookings') bindRecords();
    else bindLogs();
  }

  function ruleView() {
    return `<p id="current-rule-version">当前规则 ${badge('V' + currentRules.version)}</p>
      ${notice('新规则用于新提交的预约，已有预约继续使用创建时的规则。')}
      <form id="rules-form"><div class="card">${Object.entries(fields).map(([key, [label, min, max]]) =>
        `<label class="rulerow"><strong>${label}</strong><input required type="number" data-rule="${key}" min="${min}" max="${max}" value="${html((ruleDraft || currentRules.settings)[key])}"></label>`).join('')}</div>
      <div class="actions">${button('rule-defaults', '恢复默认值')}${button('rule-reset', '放弃修改', 'secondary', !ruleDraft)}
      <button id="rule-save" type="submit" class="primary"${disabled(writeInProgress)}>保存修改</button></div></form>`;
  }

  function bindRules() {
    view.querySelectorAll('[data-rule]').forEach(input => input.oninput = () => {
      ruleDraft ??= { ...currentRules.settings };
      ruleBase ??= currentRules.version;
      ruleDraft[input.dataset.rule] = input.value;
      ++draftVersion;
      byId('rule-reset').disabled = false;
    });
    on('rule-defaults', 'click', () => {
      ruleDraft = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field[3]]));
      ruleBase ??= currentRules.version;
      ++draftVersion;
      paint();
      message('已填入默认值，请保存后生效。');
    });
    on('rule-reset', 'click', () => guard(() => {
      paint();
      message('已放弃草稿。');
    }));
    on('rules-form', 'submit', event => {
      event.preventDefault();
      const settings = Object.fromEntries(Array.from(view.querySelectorAll('[data-rule]'),
        input => [input.dataset.rule, Number(input.value)]));
      const generation = draftVersion;
      const base = ruleBase ?? currentRules.version;
      showSheet({
        title: '确认保存预约规则', cancel: '继续编辑', confirm: '确认保存',
        content: '<p>保存后，新预约使用更新后的规则。</p>' +
          Object.entries(settings).map(([key, value]) => `<p>${fields[key][0]} · ${value}</p>`).join(''),
        submit: async () => {
          if (writeInProgress) return;
          ++adminVersion;
          writeInProgress = true;
          closeSheet();
          byId('rule-save').disabled = true;
          message('正在保存规则，仍可编辑当前草稿。');
          try {
            const saved = await write('/admin/rules', { settings, base_version: base });
            if (!active()) return;
            currentRules = saved;
            if (generation === draftVersion) ruleDraft = ruleBase = null;
            else if (ruleBase === base) ruleBase = saved.version;
            message(`已保存规则 V${saved.version}。${ruleDraft ? '新编辑的草稿仍待保存。' : ''}`);
          } catch (error) {
            if (!active()) return;
            if (error.code === 'RULE_VERSION_CONFLICT') {
              await load();
              message('规则版本已更新。草稿仍保留，请核对后放弃旧草稿并重新编辑。', true);
            } else {
              const text = errorText(error);
              if (text) message(text, true);
            }
          } finally {
            writeInProgress = false;
            reading = false;
            if (active()) {
              if (generation === draftVersion) paint();
              else {
                byId('rule-save').disabled = false;
                byId('current-rule-version').innerHTML = '当前规则 ' + badge('V' + currentRules.version);
                updateReadStatus();
              }
            }
          }
        },
      });
    });
  }

  function newOpening(room) {
    const days = [(new Date(localDay() + 'T00:00:00Z').getUTCDay() + 6) % 7];
    const [opens, closes] = room.weekly_hours[days[0]];
    openDraft = {
      room: room.id, days, mode: opens === null ? 'closed' : opens === 0 && closes === 1440 ? 'all_day' : 'custom',
      start: opens === null ? '' : minuteLabel(opens), end: closes === null ? '' : minuteLabel(closes),
      base: room.weekly_version, changed: false,
    };
  }

  function openingView() {
    if (!rooms.length) return '<p class="empty">暂无可配置的自习室。</p>';
    if (!openDraft || !roomById(openDraft.room)) newOpening(rooms[0]);
    else if (!openDraft.changed && openDraft.base !== roomById(openDraft.room).weekly_version) {
      newOpening(roomById(openDraft.room));
    }
    const room = roomById(openDraft.room);
    const draft = openDraft;
    const modes = [['custom', '指定时段'], ['all_day', '全天开放'], ['closed', '不开放']];
    return `<form class="card" id="opening-form">
      <label class="field">自习室<select id="open-room">${roomOptions(room.id)}</select></label>
      <h2>适用星期</h2><div class="days">${Array.from(week, (day, index) => `<button type="button" data-weekday="${index}"${pressed(draft.days.includes(index))}>周${day}</button>`).join('')}</div>
      <label class="field">开放模式<select id="open-mode">${modes.map(([key, label]) => option(key, label, draft.mode)).join('')}</select></label>
      ${draft.mode === 'custom' ? `<div class="columns">${timeInput('open-start', '开放时间', draft.start)}
      ${timeInput('open-end', '关闭时间（可填 24:00）', draft.end, 'text', 'placeholder="22:00"')}</div>` : ''}
      <div class="actions"><button id="open-save" class="primary" type="submit"${disabled(!draft.days.length)}>保存开放安排</button>
      ${button('reset-opening', '放弃修改', 'secondary', !draft.changed)}</div>
      ${draft.days.length ? '' : '<p class="muted">至少选择一个星期。</p>'}</form>
      <section class="card"><h2>已保存安排 · V${room.weekly_version}</h2>
      ${room.weekly_hours.map((pair, index) => `<p>周${week[index]} · ${hoursText(pair)}</p>`).join('')}</section>`;
  }

  function bindOpening() {
    const draft = openDraft;
    on('open-room', 'change', event => {
      const input = event.target;
      const chosen = roomById(input.value);
      const change = () => { newOpening(chosen); paint(); };
      if (draft.changed) {
        input.value = draft.room;
        guard(change, () => { openDraft = null; });
      } else change();
    });
    view.querySelectorAll('[data-weekday]').forEach(item => item.onclick = () => {
      const day = Number(item.dataset.weekday);
      draft.days = draft.days.includes(day) ? draft.days.filter(value => value !== day) : [...draft.days, day].sort();
      draft.changed = true;
      byId('reset-opening').disabled = false;
      item.setAttribute('aria-pressed', String(draft.days.includes(day)));
      byId('open-save').disabled = !draft.days.length;
      const status = byId('opening-form').querySelector('p');
      if (status) status.hidden = Boolean(draft.days.length);
      else if (!draft.days.length) byId('opening-form').insertAdjacentHTML('beforeend', '<p class="muted">至少选择一个星期。</p>');
    });
    on('open-mode', 'change', event => {
      draft.mode = event.target.value;
      draft.changed = true;
      paint();
      byId('open-mode').focus();
    });
    for (const [id, key] of [['open-start', 'start'], ['open-end', 'end']]) {
      on(id, 'input', event => {
        draft[key] = event.target.value;
        draft.changed = true;
        byId('reset-opening').disabled = false;
      });
    }
    on('reset-opening', 'click', () => guard(() => {
      newOpening(roomById(draft.room));
      paint();
      message('已放弃开放安排草稿。');
    }, () => { openDraft = null; }));
    on('opening-form', 'submit', event => {
      event.preventDefault();
      const custom = draft.mode === 'custom';
      if (custom && (!validTime.test(draft.end) || minutes(draft.start) >= minutes(draft.end))) {
        message('开放时间必须早于关闭时间。结束可填 24:00。', true);
        return;
      }
      const payload = {
        mode: draft.mode, weekdays: draft.days, base_version: draft.base,
        ...(custom ? { opens_minute: minutes(draft.start), closes_minute: minutes(draft.end) } : {}),
      };
      const pair = custom ? [payload.opens_minute, payload.closes_minute] : draft.mode === 'closed' ? [null, null] : [0, 1440];
      showSheet({
        title: '确认调整开放时段', cancel: '返回修改', confirm: '确认保存',
        content: `<p>${html(roomName(draft.room))}</p><p>${draft.days.map(day => '周' + week[day]).join('、')} · ${hoursText(pair)}</p>`,
        submit: async () => {
          ++adminVersion;
          writeInProgress = true;
          try {
            const saved = await write(`/admin/rooms/${safeId(draft.room)}/weekly-hours`, payload);
            if (!active()) return;
            const room = roomById(draft.room);
            room.weekly_version = saved.version;
            room.weekly_hours = saved.weekly_hours;
            newOpening(room);
            closeSheet();
            paint();
            message(`已保存周开放安排 V${saved.version}。`);
          } catch (error) {
            if (error.code === 'RESOURCE_CHANGED') {
              closeSheet();
              await load();
              message('安排已被其他操作更新。请核对新的已保存安排，再切换房间或放弃旧草稿。', true);
              return;
            }
            throw error;
          } finally {
            writeInProgress = false;
            reading = false;
            updateReadStatus();
          }
        },
      });
    });
  }

  function scopeName(closure) {
    if (closure.room_id) return `${roomName(closure.room_id)} · 整间`;
    const seat = resources.seats.find(item => item.id === closure.seat_id);
    return seat ? `${roomName(seat.room_id)} · ${seat.label} 座` : closure.seat_id;
  }

  function closureStatus(closure) {
    if (closure.reopened_at) return '已重新开放';
    if (closure.end_at && Date.parse(closure.end_at) <= clockNow()) return '时段已结束';
    if (closure.start_at && Date.parse(closure.start_at) > clockNow()) return '待生效';
    return '限制生效中';
  }

  function windowName(closure) {
    return closure.start_at ? `${stamp(closure.start_at)} 至 ${stamp(closure.end_at)}` : '即时关闭，直到重新开放';
  }

  function resourceView() {
    return `<div class="heading"><h2>自习室</h2>${button('new-closure', '＋ 新增关闭', 'primary', !rooms.length)}</div>` + rooms.map(room => {
      const scoped = resources.closures.filter(closure => {
        const scope = closure.room_id || resources.seats.find(seat => seat.id === closure.seat_id)?.room_id;
        return scope === room.id && !closure.reopened_at && (!closure.end_at || Date.parse(closure.end_at) > clockNow());
      });
      return `<article class="card"><h3>${html(room.name)}</h3><p class="muted">${room.seat_count} 座 · ${html(room.location)}</p>
        ${scoped.length ? scoped.map(closure => `<p>${badge(closureStatus(closure))} ${html(windowName(closure))}</p>`).join('') : '<p class="muted">无临时关闭限制</p>'}</article>`;
    }).join('') + '<h2>关闭记录</h2>' + (resources.closures.length ? resources.closures.map(closure =>
      `<article class="card"><div class="heading"><h3>${html(scopeName(closure))}</h3>${badge(closureStatus(closure))}</div>
        <p>${html(windowName(closure))}</p><p class="muted">${html(closure.reason)}</p>
        <button class="secondary full" type="button" data-closure="${html(closure.id)}">查看关闭详情</button></article>`).join('')
      : '<p class="empty">暂无关闭记录。</p>');
  }

  function bindResources() {
    on('new-closure', 'click', () => {
      const room = rooms[0];
      const day = localDay(1);
      closeDraft = { room: room.id, scope: 'room', seat: '', start: day + 'T09:00', end: day + 'T10:00', reason: '', changed: false };
      editClosure();
    });
    view.querySelectorAll('[data-closure]').forEach(item => item.onclick = () => closureDetail(item.dataset.closure));
  }

  function endModal() {
    openModal = null;
    closeSheet();
  }

  function editClosure(failure = '') {
    openModal = 'closure-edit';
    const draft = closeDraft;
    const seats = resources.seats.filter(seat => seat.room_id === draft.room);
    if (!seats.some(seat => seat.id === draft.seat)) draft.seat = seats[0]?.id || '';
    const fields = `<form id="closure-fields"><label class="field">自习室<select id="close-room">${roomOptions(draft.room)}</select></label>
      <label class="field">关闭范围<select id="close-scope">${option('seat', '指定一个座位', draft.scope)}${option('room', '整间自习室', draft.scope)}</select></label>
      ${draft.scope === 'seat' ? `<label class="field">座位号<select id="close-seat" required>${seats.map(seat => option(seat.id, seat.label, draft.seat)).join('')}</select></label>` : ''}
      ${timeInput('close-start', '关闭开始（北京时间）', draft.start, 'datetime-local')}
      ${timeInput('close-end', '关闭结束（北京时间）', draft.end, 'datetime-local')}
      <label class="field">关闭原因<textarea id="close-reason" maxlength="200" required>${html(draft.reason)}</textarea></label>
      ${failure ? notice(failure, true) : ''}</form>`;
    const discard = () => { ++previewVersion; closeDraft = null; endModal(); };
    showSheet({
      title: '新增资源关闭', content: fields, cancel: '取消', onCancel: discard, confirm: '预览影响',
      submit: async () => {
        if (!byId('closure-fields').reportValidity()) {
          throw new Error('请完整填写关闭范围、时段和原因。');
        }
        const closeTime = value => iso(...value.split('T'));
        const payload = {
          reason: draft.reason.trim(), start_at: closeTime(draft.start), end_at: closeTime(draft.end),
          ...(draft.scope === 'room' ? { room_id: draft.room } : { seat_id: draft.seat }),
        };
        if (!payload.reason || payload.start_at >= payload.end_at) throw new Error('结束时间必须晚于开始，且需要关闭原因。');
        const version = ++previewVersion;
        const preview = await api('/admin/closures/preview', payload, () => version === previewVersion);
        previewClosure(preview);
      },
    });
    for (const [id, key] of [['close-room', 'room'], ['close-scope', 'scope'], ['close-seat', 'seat'], ['close-start', 'start'], ['close-end', 'end'], ['close-reason', 'reason']]) {
      on(id, 'input', event => {
        draft[key] = event.target.value;
        draft.changed = true;
        ++previewVersion;
      });
      if (key === 'room' || key === 'scope') on(id, 'change', () => { editClosure(); byId(id).focus(); });
    }
    on('closure-fields', 'submit', event => {
      event.preventDefault();
      byId('sheet-confirm').click();
    });
  }

  function previewClosure(preview) {
    openModal = 'closure-preview';
    const blockers = preview.blockers.length > 0;
    const list = [...preview.affected, ...preview.blockers];
    showSheet({
      title: blockers ? '无法关闭 · 需要现场处理' : '确认关闭资源',
      content: `<h3>${html(scopeName(preview.target))}</h3><p>${html(windowName(preview.target))}</p>
        <p>${html(preview.target.reason)}</p><p><strong>${list.length}</strong> 条受影响的有效预约</p>
        ${list.map(record => `<article class="card"><p>${html(record.seat_label)} 座 · ${labels[record.status]}</p><small>${html(record.id)}</small></article>`).join('')}
        ${notice(blockers ? '有使用中或暂离中预约，请先处理再预览。' : '确认后将取消时段内受影响的待签到预约。')}`,
      cancel: '返回修改', onCancel: () => { ++previewVersion; editClosure(); }, confirm: blockers ? undefined : '确认关闭',
      submit: async () => {
        ++adminVersion;
        writeInProgress = true;
        try {
          const result = await write('/admin/closures', { preview_token: preview.preview_token });
          if (!active()) return;
          closeDraft = null;
          endModal();
          await load();
          if (!active()) return;
          paint();
          if (findClosure(result.id)) closureDetail(result.id);
          message(`资源关闭已保存，取消 ${preview.affected.length} 条待签到预约。`);
        } catch (error) {
          if (error.code === 'PREVIEW_STALE') { ++previewVersion; editClosure(error.message); return; }
          throw error;
        } finally {
          writeInProgress = false;
          reading = false;
          updateReadStatus();
        }
      },
    });
  }

  function closureDetail(id) {
    const closure = findClosure(id);
    if (!closure) { message('未找到关闭记录，请刷新数据。', true); return; }
    openModal = 'closure-detail';
    const ids = closure.affected_reservation_ids;
    const canReopen = !closure.reopened_at && (!closure.end_at || Date.parse(closure.end_at) > clockNow());
    showSheet({
      title: '关闭记录详情', onCancel: endModal,
      content: `<h3>${html(scopeName(closure))} ${badge(closureStatus(closure))}</h3>
        <p>${html(windowName(closure))}</p><p>原因 · ${html(closure.reason)}</p>
        <p>操作人 · ${html(closure.actor_name)}（${html(closure.created_by)}）</p><p>记录时间 · ${stamp(closure.created_at)}</p>
        <p>取消预约 · ${ids.length} 条</p>
        ${closure.reopened_at ? `<p>重新开放 · ${stamp(closure.reopened_at)}</p>` : ''}
        <div class="actions">${button('see-affected', '查看受影响预约')}${button('notice-preview', '查看通知预览')}
        ${canReopen ? button('reopen-closure', '重新开放', 'primary') : ''}</div>`,
    });
    on('notice-preview', 'click', () => showSheet({
      title: '关闭通知内容预览', cancel: '返回关闭详情', onCancel: () => closureDetail(id),
      content: notice('此处仅供管理端查看内容，系统没有发送通知。') + (ids.length ? ids.map(value =>
        `<p>预约 ${html(value)} 因 ${html(closure.reason)} 已取消。</p>`).join('') : '<p>没有受影响的预约。</p>'),
    }));
    on('see-affected', 'click', () => {
      returnClosure = id;
      recordFilter = { closure: id, ids };
      recordPage = 1;
      recordsTab = 'bookings';
      endModal();
      document.querySelector('[data-nav="records"]').click();
    });
    on('reopen-closure', 'click', () => showSheet({
      title: '确认重新开放', cancel: '返回关闭详情', onCancel: () => closureDetail(id), confirm: '确认重新开放',
      content: notice('解除本条关闭记录的剩余限制，已取消预约保留原状态。'),
      submit: async () => {
        ++adminVersion;
        writeInProgress = true;
        try {
          await write(`/admin/closures/${safeId(id)}/reopen`, {});
          if (!active()) return;
          endModal();
          await load();
          if (!active()) return;
          paint();
          closureDetail(id);
          message('已重新开放。');
        } finally {
          writeInProgress = false;
          reading = false;
          updateReadStatus();
        }
      },
    }));
  }

  function recordView() {
    const form = recordFilter;
    const rows = reservations.filter(record => {
      const day = date(record.start_at);
      const searchable = `${record.student_username} ${record.student_id} ${record.seat_label} ${record.id}`.toLowerCase();
      return (!form.from || form.from <= day) && (!form.to || form.to >= day)
        && (!form.status || form.status === record.status) && (!form.room || form.room === record.room_id)
        && (!form.key || searchable.includes(form.key.toLowerCase()))
        && (!form.ids || form.ids.includes(record.id));
    });
    const pages = Math.max(1, Math.ceil(rows.length / 5));
    recordPage = Math.min(pages, recordPage);
    return `<details class="card" open><summary>筛选预约记录</summary><form id="admin-filter">
      <div class="columns"><label class="field">开始日期<input id="filter-from" type="date" value="${html(form.from)}"></label>
      <label class="field">结束日期<input id="filter-to" type="date" value="${html(form.to)}"></label></div>
      <label class="field">自习室<select id="filter-room">${roomOptions(form.room || '', true)}</select></label>
      <label class="field">预约状态<select id="filter-status">${option('', '全部状态', form.status || '')}
        ${Object.entries(labels).map(([key, label]) => option(key, label, form.status)).join('')}</select></label>
      <label class="field">学号、座位号或预约编号<input id="filter-key" value="${html(form.key)}" type="search"></label>
      <div class="actions">${button('reset-filters', '重置筛选')}<button class="primary" id="run-filters" type="submit">查询</button></div>
      </form></details>
      ${form.closure ? `<div class="notice"><p>关联关闭记录 ${html(form.closure)}</p><div class="actions">
      ${button('return-to-closure', '返回关闭详情')}${button('clear-association', '清除关联条件')}</div></div>` : ''}
      <div class="heading"><h2>查询结果</h2><small>共 ${rows.length} 条</small></div>
      ${rows.length ? rows.slice((recordPage - 1) * 5, recordPage * 5).map(row =>
        `<article class="card booking"><div class="heading"><h3>${html(row.student_name)}</h3>${badge(labels[row.status])}</div>
        <p>${html(row.room_name)} · ${html(row.seat_label)} 座</p><p class="muted">${stamp(row.start_at)} 至 ${stamp(row.end_at)}</p>
        <button class="secondary full" type="button" data-admin-booking="${html(row.id)}">查看预约详情</button></article>`).join('')
        : '<p class="empty">未找到符合条件的预约。</p>'}
      <div class="actions">${button('previous-records', '上一页', 'secondary', recordPage <= 1)}<span>${recordPage} / ${pages}</span>
      ${button('next-records', '下一页', 'secondary', recordPage >= pages)}</div>`;
  }

  function bindRecords() {
    on('admin-filter', 'submit', event => {
      event.preventDefault();
      const next = Object.fromEntries(['from', 'to', 'room', 'status', 'key'].map(key => [key, byId('filter-' + key).value.trim()]));
      if (next.from && next.to && next.from > next.to) {
        message('开始日期必须早于或等于结束日期。', true);
        return;
      }
      recordFilter = { ...recordFilter, ...next };
      recordPage = 1;
      paint();
      message('筛选已更新。');
    });
    on('reset-filters', 'click', () => {
      recordFilter = recordFilter.closure ? { closure: recordFilter.closure, ids: recordFilter.ids } : {};
      recordPage = 1;
      paint();
      message('已重置筛选。');
    });
    on('clear-association', 'click', () => {
      delete recordFilter.closure;
      delete recordFilter.ids;
      returnClosure = '';
      recordPage = 1;
      paint();
      message('已清除关闭关联。');
    });
    on('return-to-closure', 'click', () => {
      const id = returnClosure;
      document.querySelector('[data-nav="resources"]').click();
      closureDetail(id);
    });
    on('next-records', 'click', () => { recordPage++; paint(); });
    on('previous-records', 'click', () => { recordPage--; paint(); });
    view.querySelectorAll('[data-admin-booking]').forEach(item => item.onclick = () => showRecord(item.dataset.adminBooking));
  }

  function showRecord(id, back = endModal) {
    const row = reservations.find(item => item.id === id);
    if (!row) { message('未找到关联预约。', true); return; }
    openModal = 'booking';
    const related = events.filter(event => event.reservation_id === id);
    showSheet({
      title: '预约详情', onCancel: back,
      content: `<p>${html(row.student_name)} · ${html(row.student_username)}</p><p>${html(row.room_name)} · ${html(row.seat_label)} 座</p>
      <p>${stamp(row.start_at)} 至 ${stamp(row.end_at)} ${badge(labels[row.status])}</p><small>${html(row.id)}</small>
      <section class="card"><h3>创建时规则 V${row.rule_version_id}</h3>
      ${Object.entries(fields).map(([key, [label]]) => `<p>${label} · ${html(row.rule_snapshot[key])}</p>`).join('')}</section>
      <section class="card"><h3>状态与考勤时间线</h3><p>创建 · ${stamp(row.created_at)}</p>
      ${[['签到', row.checked_in_at], ['暂离', row.leave_started_at], ['结束', row.ended_at]].filter(([, value]) => value)
        .map(([label, value]) => `<p>${label} · ${stamp(value)}</p>`).join('')}</section>
      <h3>关联日志</h3>${related.length ? related.map(event => `<p>${html(eventNames[event.action] || event.action)} · ${stamp(event.occurred_at)}</p>`).join('') : '<p>最近日志中没有关联记录。</p>'}`,
    });
  }

  function logView() {
    return `<h2>管理操作记录</h2><p class="muted">最近 ${events.length} 条 · 只读</p>` + (events.length ? events.map(event =>
      `<article class="card"><h3>${html(eventNames[event.action] || event.action)} · #${event.id}</h3>
      <p>${html(event.actor_id || '系统任务')} · ${stamp(event.occurred_at)}</p>
      <button class="secondary" type="button" data-log="${event.id}">查看日志详情</button></article>`).join('')
      : '<p class="empty">暂无操作日志。</p>');
  }

  function bindLogs() {
    view.querySelectorAll('[data-log]').forEach(item => item.onclick = () => showLog(Number(item.dataset.log)));
  }

  function showLog(id) {
    const event = events.find(item => item.id === id);
    const detail = JSON.parse(event.details_json || '{}');
    const associated = event.reservation_id ? [event.reservation_id] : detail.reservation_ids || [];
    openModal = 'log';
    showSheet({
      title: `操作日志 #${id}`, onCancel: endModal,
      content: `<h3>${html(eventNames[event.action] || event.action)}</h3>
        <p>${html(event.actor_id || '系统任务')} · ${stamp(event.occurred_at)}</p>
        <p>${html(event.target_id || '—')}</p>${detail.reason ? `<p>原因 · ${html(detail.reason)}</p>` : ''}
        <h3>关联预约</h3>${associated.length ? associated.map(id =>
          `<p><button class="secondary" type="button" data-log-booking="${html(id)}">${html(id)}</button></p>`).join('')
          : '<p>本次操作无关联预约。</p>'}`,
    });
    byId('sheet-content').querySelectorAll('[data-log-booking]').forEach(item =>
      item.onclick = () => showRecord(item.dataset.logBooking, () => showLog(id)));
  }

  return { render, dirty, guard };
}
