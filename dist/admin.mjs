const paths = {
  overview: ['运营概览', '掌握账户、任务与服务的运行情况。', 'grid'],
  users: ['用户管理', '查看注册账户、联系方式验证与使用情况。', 'users'],
  jobs: ['任务管理', '追踪任务状态，处理排队中或执行中的任务。', 'task'],
  results: ['成果记录', '查看服务端成果的归属、类型与创建记录。', 'file'],
  feedback: ['用户反馈', '记录处理进度，让每一条反馈都有回应。', 'message'],
  orders: ['订单记录', '查看已有订单与商品信息。', 'order'],
  usage: ['用量记录', '查看模型调用及实际返回的 Token 用量。', 'chart'],
  settings: ['系统设置', '管理模型配置，查看平台服务的连接状态。', 'settings'],
  payments: ['支付配置', '配置收款渠道与可售商品，管理网站的支付入口。', 'order'],
  audit: ['操作日志', '追溯管理员执行的关键操作。', 'shield']
};
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6m-6 5h6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8m-8 4h5"/>',
  message: '<path d="M21 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3zM8 8h9m-9 5h6"/>',
  order: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 7h6m-6 4h6m-6 4h3"/>',
  chart: '<path d="M4 3v18h17M8 16v-4m5 4V6m5 10V9"/>',
  settings: '<path d="m9 3-.6 2.3-2 .9-2-.7-2 3.5L4 10.5v2.6L2.4 15l2 3.5 2-.6 2 1L9 21h4l.6-2.2 2-1 2 .7 2-3.5-1.4-1.7v-2.6L20 9l-2-3.5-2 .7-2-.9L13 3z"/><circle cx="11" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
  ai: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-10v1"/>',
  empty: '<path d="M3 8h7l2 3h9v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 8V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const count = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
const orderAmount = cents => Number.isSafeInteger(cents) && cents > 0 ? `¥${Math.floor(cents / 100).toLocaleString('zh-CN')}.${String(cents % 100).padStart(2, '0')}` : '—';
const date = value => !value || Number.isNaN(new Date(value).getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const bytes = value => { if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'; let size = Number(value), unit = 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; } return `${size.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${units[unit]}`; };
const typeNames = { parse: '正文解析', polish: '学术润色', review: '意见修改', compare: '材料比对', agent: '科研智能助手' };
const statuses = { queued: ['排队中', 'amber'], running: ['执行中', 'blue'], failed: ['失败', 'red'], completed: ['已完成', 'green'], cancelled: ['已取消', ''], open: ['待处理', 'amber'], processing: ['处理中', 'blue'], resolved: ['已解决', 'green'], pending: ['待支付', 'amber'], paid: ['已支付', 'green'], closed: ['已关闭', ''], expired: ['已过期', ''], refunded: ['已退款', ''], admin: ['管理员', 'purple'], user: ['普通用户', ''], billable: ['已标记计费', 'blue'], unbilled: ['未标记计费', ''] };
const badge = value => { const [label, color] = Object.hasOwn(statuses, value) ? statuses[value] : [value || '未知', '']; return `<span class="badge ${color}">${esc(label)}</span>`; };
const filters = { users: ['user', 'admin'], jobs: ['queued', 'running', 'completed', 'failed', 'cancelled'], feedback: ['open', 'processing', 'resolved'], orders: ['pending', 'paid', 'closed', 'expired', 'cancelled', 'refunded', 'failed'], usage: ['billable', 'unbilled'] };
const searchHints = { users: '搜索昵称、邮箱、手机号或用户 ID', jobs: '搜索任务 ID、类型或用户', results: '搜索成果名称、类型或用户', feedback: '搜索反馈内容、分类或用户', orders: '搜索订单、商品或用户', usage: '搜索模型、任务或用户', audit: '搜索操作、目标或管理员' };
const headers = { users: ['用户', '联系方式', '身份', '项目 / 任务', '注册时间', '操作'], jobs: ['任务', '所属用户', '状态', '阶段 / 次数', '创建时间', '操作'], results: ['成果名称', '所属用户', '类型', '关联任务', '创建时间'], feedback: ['反馈内容', '提交用户', '分类', '处理状态', '提交时间', '操作'], orders: ['订单', '所属用户', '商品', '订单金额', '支付渠道', '商户订单号', '平台交易号', '订单状态', '创建 / 支付时间'], usage: ['模型与服务', '所属用户', '输入 / 输出 Token', '计费标记', '调用时间', '关联任务'], audit: ['操作', '管理员', '目标', '操作时间', '详情'] };
const auditNames = { 'owner.verified': '管理员身份验证', 'job.cancel': '取消任务', 'feedback.update': '更新反馈', 'model.update': '修改模型配置', 'payment.config.update': '修改支付配置', 'payment.product.update': '修改可售商品' };
const paymentProviders = {
  wechat: { title: '微信支付', short: '微', note: '微信 API v3 Native 扫码支付；需商户开通对应产品。', fields: [['appId', '应用 AppID', '微信商户绑定的应用 ID'], ['merchantId', '商户号', '微信支付商户号'], ['merchantSerial', '商户 API 证书序列号', '用于签名请求的证书序列号'], ['platformPublicKeyId', '微信支付公钥 ID', 'PUB_KEY_ID_…']], secrets: [['privateKey', '商户 API 私钥', 'PEM 格式私钥'], ['apiV3Key', 'API v3 密钥', '32 位 API v3 密钥'], ['platformPublicKey', '微信支付公钥', 'PEM 格式公钥']] },
  alipay: { title: '支付宝', short: '支', note: '支付宝当面付扫码支付，使用应用对应的 RSA2 签名配置。', fields: [['appId', '应用 AppID', '支付宝开放平台应用 ID'], ['sellerId', '收款卖家 PID', '支付宝商家收款账户 PID']], secrets: [['privateKey', '应用私钥', 'PEM 格式 RSA 私钥'], ['alipayPublicKey', '支付宝公钥', '支付宝提供的验签公钥']] }
};
const priceText = cents => Number.isSafeInteger(cents) && cents > 0 ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` : '';
const priceCents = value => { const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(value); if (!match) return null; const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')); return Number.isSafeInteger(amount) && amount > 0 ? amount : null; };

export function createAdminPage(doc, { navigate, requestTimeoutMs = 30_000, pollIntervalMs = 30_000 } = {}) {
  const win = doc.defaultView, $ = selector => doc.querySelector(selector);
  const go = navigate || (url => win.location.replace(url));
  const loginUrl = '/auth.html?mode=login&next=%2Fadmin.html';
  let authorized = false, user = null, currentView = 'overview', generation = 0, currentData = null, loadedAt = '', polling, toastTimer, previousFocus, dialogGeneration = 0;
  const paymentBaselines = new Map(), pendingPayments = new Set();
  const queries = Object.fromEntries(Object.keys(headers).map(key => [key, { page: 1, pageSize: 20, q: '', status: '' }]));
  const route = () => Object.hasOwn(paths, win.location.hash.slice(1)) ? win.location.hash.slice(1) : 'overview';

  function toast(message) {
    if (!authorized) return;
    $('#admin-toast').textContent = message; $('#admin-toast').hidden = false;
    win.clearTimeout(toastTimer); toastTimer = win.setTimeout(() => { $('#admin-toast').hidden = true; }, 5000);
  }
  function closeMenu() { $('#admin-app').classList.remove('nav-open'); $('#sidebar-backdrop').hidden = true; $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
  function closeDialog() { dialogGeneration++; if ($('#admin-dialog').open) $('#admin-dialog').close(); $('#dialog-body').replaceChildren(); $('#dialog-title').textContent = ''; previousFocus?.focus(); }
  function deny(status, message) {
    authorized = false; user = null; currentData = null; generation++;
    win.clearInterval(polling); win.clearTimeout(toastTimer);
    closeDialog(); closeMenu();
    $('#admin-content').replaceChildren(); $('#admin-navigation').replaceChildren(); $('#admin-name').textContent = ''; $('#admin-avatar').textContent = ''; $('#admin-toast').textContent = ''; $('#admin-toast').hidden = true;
    $('#admin-app').hidden = true; $('#access-gate').hidden = false;
    $('#access-title').textContent = status === 401 ? '请先登录管理员账户' : '当前账户没有管理权限';
    $('#access-message').textContent = message || (status === 401 ? '登录后将返回管理后台。' : '管理后台仅对管理员开放，你可以继续使用研究工作台。');
    $('#access-actions').innerHTML = `<a class="button primary" href="/workspace.html#home">返回工作台</a>${status === 401 ? `<a class="button" href="${loginUrl}">前往登录</a>` : ''}`;
    if (status === 401) go(loginUrl);
  }
  async function request(path, body) {
    if (path.startsWith('/admin/') && !authorized) throw new Error('需要管理员权限');
    const Controller = win.AbortController || globalThis.AbortController, controller = new Controller();
    let timedOut = false;
    const timer = win.setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    try {
      let response;
      try { response = await win.fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: controller.signal, headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch { throw new Error(timedOut ? '请求超时，请稍后重试。' : '暂时无法连接服务，请检查网络后重试。'); }
      if (response.status === 401 || response.status === 403) { deny(response.status); const error = new Error(response.status === 401 ? '登录状态已失效。' : '管理权限已失效。'); error.status = response.status; throw error; }
      let value;
      try { value = await response.json(); } catch { throw new Error(timedOut ? '请求超时，请稍后重试。' : '服务暂时不可用，请稍后重试。'); }
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : '操作未完成，请稍后重试。');
      return value;
    } finally { win.clearTimeout(timer); }
  }
  function navigation() {
    $('#admin-navigation').innerHTML = Object.entries(paths).map(([key, [title, , glyph]], index) => `${index === 0 ? '<div class="nav-section-label">运营工作台</div>' : key === 'settings' ? '<div class="nav-section-label">平台管理</div>' : ''}<a href="#${key}" class="admin-nav-link" data-view="${key}" ${key === currentView ? 'aria-current="page"' : ''}>${icon(glyph)}${title}</a>`).join('');
    $('#breadcrumb').textContent = paths[currentView][0];
    doc.title = `${paths[currentView][0]} · PaperKnow 管理后台`;
  }
  function heading(view) { return `<div class="page-heading"><div><h1>${paths[view][0]}</h1><p>${paths[view][1]}</p></div><div class="page-heading-actions">${loadedAt ? `<span class="update-time">更新于 ${esc(loadedAt)}</span>` : ''}<button class="button" id="refresh-view">${icon('refresh')}刷新</button></div></div>`; }
  function loading() { return '<div class="panel"><div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>正在读取服务数据…</div></div>'; }
  function empty(title, detail, retry = false) { return `<div class="empty-state"><span class="empty-icon">${icon('empty')}</span><h2>${esc(title)}</h2><p>${esc(detail)}</p>${retry ? '<button class="button" id="retry-view">重新加载</button>' : ''}</div>`; }
  function person(row, own = false) { return `<div class="cell-title">${esc(own ? row.name || '未填写昵称' : row.user_name || '未填写昵称')}</div><div class="cell-contact">${esc(own ? row.email || row.phone || '未填写联系方式' : row.user_email || row.user_phone || '未填写联系方式')}</div>`; }
  function idText(value) { return `<span class="cell-id" title="${esc(value)}">${esc(value ? String(value).slice(0, 12) : '—')}</span>`; }
  function transactionText(value) { return typeof value === 'string' && value ? `<span class="cell-id" style="user-select:all" title="${esc(value)}">${esc(value)}</span>` : '—'; }
  function rowMarkup(view, row) {
    const id = esc(row.id);
    if (view === 'users') return `<td><div class="cell-title">${esc(row.name || '未填写昵称')}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${row.email ? `<div class="cell-contact">${esc(row.email)}</div><div class="cell-secondary">邮箱${row.email_verified_at ? '已验证' : '未验证'}</div>` : ''}${row.phone ? `<div class="cell-contact">${esc(row.phone)}</div><div class="cell-secondary">手机${row.phone_verified_at ? '已验证' : '未验证'}</div>` : ''}${!row.email && !row.phone ? '—' : ''}</td><td>${badge(row.role)}</td><td class="cell-number">${count(row.project_count)} / ${count(row.job_count)}</td><td>${date(row.created_at)}</td><td><button class="text-button" data-detail="${id}">查看详情</button></td>`;
    if (view === 'jobs') return `<td><div class="cell-title">${esc(typeNames[row.type] || row.type || '未知任务')}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${person(row)}</td><td>${badge(row.status)}</td><td><div>${esc(row.stage || '—')}</div><div class="cell-secondary">执行 ${count(row.attempt)} 次</div></td><td>${date(row.created_at)}</td><td><div class="row-actions"><button class="text-button" data-detail="${id}">详情</button>${['queued', 'running'].includes(row.status) ? `<button class="text-button cancel" data-cancel="${id}">取消任务</button>` : ''}</div></td>`;
    if (view === 'results') return `<td><div class="cell-title">${esc(row.title || '未命名成果')}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${person(row)}</td><td>${esc(typeNames[row.type] || row.type || '—')}</td><td>${idText(row.job_id)}</td><td>${date(row.created_at)}</td>`;
    if (view === 'feedback') return `<td><div class="cell-content clamp">${esc(row.body)}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${person(row)}</td><td>${esc(row.category || '未分类')}</td><td>${badge(row.status || 'open')}</td><td>${date(row.created_at)}</td><td><button class="text-button" data-feedback="${id}">处理反馈</button></td>`;
    if (view === 'orders') return `<td>${idText(row.id)}</td><td>${person(row)}</td><td><div class="cell-title">${esc(row.product_title || row.product_id || '—')}</div></td><td class="cell-number">${orderAmount(row.amount_cents)}</td><td>${row.provider === 'wechat' ? '微信支付' : row.provider === 'alipay' ? '支付宝' : '—'}</td><td>${transactionText(row.out_trade_no)}</td><td>${transactionText(row.provider_trade_no)}</td><td>${badge(row.status)}</td><td><div>${date(row.created_at)}</div><div class="cell-secondary">支付 ${date(row.paid_at)}</div></td>`;
    if (view === 'usage') return `<td><div class="cell-title">${esc(row.model || '—')}</div><div class="cell-secondary">${esc(row.provider || '—')}</div></td><td>${person(row)}</td><td class="cell-number">${count(row.input_tokens)} / ${count(row.output_tokens)}</td><td>${badge(row.billable ? 'billable' : 'unbilled')}</td><td>${date(row.created_at)}</td><td>${idText(row.job_id)}</td>`;
    return `<td><div class="cell-title">${esc(auditNames[row.action] || row.action || '未知操作')}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${person(row)}</td><td><div>${esc(row.target_type || '—')}</div>${idText(row.target_id)}</td><td>${date(row.created_at)}</td><td><button class="text-button" data-detail="${id}">查看记录</button></td>`;
  }
  function table(view, items) { return `<div class="table-scroll"><table class="data-table"><caption class="visually-hidden">${paths[view][0]}</caption><thead><tr>${headers[view].map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${items.map(row => `<tr>${rowMarkup(view, row)}</tr>`).join('')}</tbody></table></div>`; }
  function listPage(view, data) {
    const query = queries[view], total = Number(data.total) || 0, pages = Math.max(1, Math.ceil(total / query.pageSize));
    const notice = view === 'orders' ? '订单金额以服务端记录为准，未支付订单不计入收入。' : view === 'usage' ? 'Token 来自模型实际返回的数据，缺失项显示「—」。计费标记不等于第三方账单或平台已收取费用。' : view === 'results' ? '这里展示成果元信息；正文与原件仍由所属用户在工作台管理。' : '';
    return `${notice ? `<div class="page-notice">${icon('info')}<span>${notice}</span></div>` : ''}<section class="panel"><div class="table-toolbar"><form id="search-form" class="search-form" role="search"><div class="search-box">${icon('search')}<input id="admin-search" aria-label="搜索${paths[view][0]}" placeholder="${searchHints[view]}" maxlength="200" value="${esc(query.q)}"></div>${filters[view] ? `<select id="status-filter" class="filter-select" aria-label="${view === 'users' ? '用户身份' : '状态'}筛选"><option value="">${view === 'users' ? '全部身份' : '全部状态'}</option>${filters[view].map(status => `<option value="${status}" ${query.status === status ? 'selected' : ''}>${statuses[status][0]}</option>`).join('')}</select>` : ''}<button class="button primary" type="submit">查询</button>${query.q || query.status ? '<button class="button" id="reset-search" type="button">重置</button>' : ''}</form><span class="table-summary">共 <b>${count(total)}</b> 条记录</span></div>${data.items.length ? table(view, data.items) : empty(query.q || query.status ? '没有找到匹配记录' : '暂无记录', query.q || query.status ? '试试其他关键词，或重置筛选条件。' : { users: '新注册账户将在这里显示。', jobs: '用户提交任务后，可在这里查看执行进度。', results: '任务完成并产生结果后，将显示成果记录。', feedback: '用户提交的反馈将在这里统一处理。', orders: '用户提交购买订单后，将在这里显示记录。', usage: '模型产生实际调用后，将显示用量记录。', audit: '管理员执行关键操作后，将留下操作记录。' }[view])}<div class="pagination"><span>每页 ${query.pageSize} 条${total ? ` · 第 ${(query.page - 1) * query.pageSize + 1}–${Math.min(query.page * query.pageSize, total)} 条` : ''}</span><div class="pagination-buttons"><button class="button compact" id="previous-page" ${query.page <= 1 ? 'disabled' : ''}>上一页</button><span>${query.page} / ${pages}</span><button class="button compact" id="next-page" ${query.page >= pages ? 'disabled' : ''}>下一页</button></div></div></section>`;
  }
  function serviceRow(label, name, enabled, enabledLabel = '已配置') { return `<div class="service-status-row"><span class="service-name">${icon(name)}${label}</span><span class="service-status ${enabled ? '' : 'off'}">${enabled ? enabledLabel : '未开放'}</span></div>`; }
  function overviewPage(data) {
    const m = data.metrics || {}, services = data.services || {}, days = Array.isArray(data.daily) ? data.daily : [], recent = Array.isArray(data.recentJobs) ? data.recentJobs.slice(0, 6) : [];
    const max = Math.max(1, ...days.flatMap(day => [Number(day.users) || 0, Number(day.jobs) || 0]));
    const cards = [['累计用户', m.users, `研究项目 ${count(m.projects)} 个`, 'users', 'users', ''], ['处理任务', m.jobs, `已完成 ${count(m.completed)} 个`, 'task', 'jobs', 'mint'], ['研究成果', m.results, `已上传原件 ${count(m.files)} 份`, 'file', 'results', 'lavender'], ['待完成反馈', m.feedbackOpen, '待处理与处理中', 'message', 'feedback', 'amber']];
    return `<div class="metrics-grid">${cards.map(([label, value, foot, glyph, view, color]) => `<article class="metric-card ${color}"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon(glyph)}</span></div><strong class="metric-number">${count(value)}</strong><div class="metric-foot"><span>${foot}</span><a href="#${view}" data-view="${view}" aria-label="查看${paths[view][0]}">查看 →</a></div></article>`).join('')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>近 7 天活动</h2><p>新增用户与新建任务，按日统计</p></div><div class="chart-legend"><span><i></i>用户</span><span><i class="mint"></i>任务</span></div></div><div class="trend-chart" role="img" aria-label="${esc(days.map(day => `${day.date}：新增用户 ${count(day.users)}，任务 ${count(day.jobs)}`).join('；') || '暂无趋势数据')}"><div class="trend-columns">${days.map(day => `<div class="trend-day" title="${esc(day.date)} · 用户 ${count(day.users)} · 任务 ${count(day.jobs)}"><i class="trend-bar" style="height:${Math.max(0, Number(day.users) || 0) / max * 92}%"></i><i class="trend-bar mint" style="height:${Math.max(0, Number(day.jobs) || 0) / max * 92}%"></i></div>`).join('')}</div><div class="trend-labels">${days.map(day => `<span>${esc(String(day.date).slice(5).replace('-', '/'))}</span>`).join('')}</div>${!days.some(day => Number(day.users) || Number(day.jobs)) ? '<div class="trend-empty">这段时间还没有新增活动</div>' : ''}</div><div class="queue-strip"><span>排队中 <b>${count(m.queued)}</b></span><span>执行中 <b>${count(m.running)}</b></span><span>失败 <b>${count(m.failed)}</b></span></div></section><section class="panel"><div class="panel-heading"><h2>服务状态</h2><a href="#settings" data-view="settings" class="text-button">查看设置 →</a></div><div class="service-status-list">${serviceRow('AI 模型', 'ai', services.ai, '可用')}${serviceRow('邮箱验证码', 'mail', services.email)}${serviceRow('短信验证码', 'phone', services.sms)}${serviceRow('在线支付', 'order', services.payment, '已开放')}</div><div class="storage-strip"><span>原件存储 <b>${storageName(services.storage)}</b></span><span>${bytes(m.storageBytes)}</span></div></section></div><section class="panel"><div class="panel-heading"><div><h2>最近任务</h2><p>最新提交的服务任务</p></div><a href="#jobs" data-view="jobs" class="text-button">全部任务 →</a></div>${recent.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">任务</th><th scope="col">所属用户</th><th scope="col">状态</th><th scope="col">提交时间</th></tr></thead><tbody>${recent.map(row => `<tr><td><div class="cell-title">${esc(typeNames[row.type] || row.type)}</div><div class="cell-secondary">${idText(row.id)}</div></td><td>${person(row)}</td><td>${badge(row.status)}</td><td>${date(row.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('还没有提交任务', '真实任务开始执行后，将在这里展示状态。')}</section>`;
  }
  function storageName(provider) { return provider === 'aliyun_oss' ? '阿里云 OSS' : provider === 'local_server_sqlite' ? '服务端存储' : esc(provider || '未配置'); }
  function settingsPage(data) {
    const ai = data.ai || {}, auth = data.auth || {};
    return `<div class="settings-grid"><section class="panel"><div class="panel-heading"><div><h2>AI 模型配置</h2><p>模型变更对后续任务生效</p></div><span class="service-status ${ai.ready ? '' : 'off'}">${ai.ready ? '可用' : '未就绪'}</span></div><form id="model-form" class="settings-body"><div class="settings-meta"><div><span>模型服务</span><b>${esc(ai.provider || '未配置')}</b></div><div><span>连接配置</span><b>${ai.configured ? '已配置' : '未配置'}</b></div></div><label for="model-name">模型名称</label><input id="model-name" type="text" maxlength="100" required value="${esc(ai.model || '')}" placeholder="填写当前服务可用的模型名称" autocomplete="off"><p class="settings-note">请填写当前模型服务已开通的模型名称。</p><label class="toggle-row" for="model-enabled"><span><b>启用 AI 服务</b><p>暂停后，用户无法提交新的 AI 任务。</p></span><input id="model-enabled" type="checkbox" ${ai.enabled ? 'checked' : ''}></label>${!ai.configured ? '<div class="page-notice">连接信息尚未配置。仅开启此开关不会使模型服务可用。</div>' : ''}<div class="form-error" id="model-error" role="alert" hidden></div><div class="settings-actions"><button class="button primary" id="save-model" type="submit">保存配置</button><span class="settings-note">保存操作会写入操作日志</span></div></form></section><section class="panel"><div class="panel-heading"><h2>平台服务</h2></div><div class="service-status-list">${serviceRow('邮箱验证码', 'mail', auth.emailCode)}${serviceRow('短信验证码', 'phone', auth.phoneCode)}${serviceRow('在线支付', 'order', data.payment, '已开放')}</div><div class="settings-body"><div class="settings-meta"><div><span>文件存储</span><b>${storageName(data.storage?.provider)}</b></div></div><p class="settings-note">短信、邮件和文件存储使用服务端连接配置。此页面展示当前服务状态。支付参数与可售商品可在支付配置中管理。</p><a class="button payment-settings-link" href="#payments" data-view="payments">${icon('order')}管理支付配置 →</a></div></section></div>`;
  }
  function paymentChannel(provider, data = {}, encryptionReady = false) {
    const spec = paymentProviders[provider], fields = data.fields || {}, flags = data.secretFields || {};
    const checks = Array.isArray(data.validation) ? data.validation : [];
    const fieldLabels = Object.fromEntries([...spec.fields, ...spec.secrets].map(([key, label]) => [key, label]));
    const commonLabels = { encryption: '服务端加密', configuration: '渠道配置', provider: '支付渠道' };
    const validationText = check => {
      if (typeof check === 'string') return check;
      const field = check?.field, label = Object.hasOwn(fieldLabels, field) ? fieldLabels[field] : Object.hasOwn(commonLabels, field) ? commonLabels[field] : '';
      return `${label ? label + '：' : ''}${check?.message || '请检查渠道配置'}`;
    };
    const hasSaved = Object.keys(fields).some(key => fields[key]) || Object.values(flags).some(Boolean);
    const state = data.configured ? (data.enabled && data.ready ? ['已启用', 'green'] : ['已配置 · 已停用', '']) : hasSaved ? ['配置待完善', 'amber'] : ['未开通', ''];
    return `<section class="panel payment-channel" data-provider="${provider}"><div class="payment-channel-heading"><span class="payment-provider-mark ${provider}" aria-hidden="true">${spec.short}</span><div><h2>${spec.title}</h2><p>${spec.note}</p></div><span class="badge ${state[1]}">${state[0]}</span></div><form class="payment-form" id="payment-${provider}" data-payment-provider="${provider}" autocomplete="off"><div class="payment-field-grid">${spec.fields.map(([key, label, placeholder]) => `<div class="payment-field"><label for="${provider}-${key}">${label}</label><input type="text" id="${provider}-${key}" name="${key}" value="${esc(fields[key])}" maxlength="200" placeholder="${placeholder}" spellcheck="false" autocomplete="off"></div>`).join('')}</div><div class="payment-secret-section"><h3>${icon('shield')}签名与验签配置</h3><p class="settings-note">保存后不回显密钥。留空保留现有值，填写新内容后替换。</p>${spec.secrets.map(([key, label, placeholder]) => `<div class="payment-field payment-secret"><div class="payment-field-label"><label for="${provider}-${key}">${label}</label><span class="payment-secret-state ${flags[key] ? 'configured' : ''}">${flags[key] ? '已保存' : '未配置'}</span></div>${key === 'apiV3Key' ? `<input type="password" id="${provider}-${key}" name="${key}" value="" maxlength="256" placeholder="${flags[key] ? '留空保留已保存密钥' : placeholder}" autocomplete="new-password" spellcheck="false">` : `<textarea id="${provider}-${key}" name="${key}" rows="3" maxlength="20000" placeholder="${flags[key] ? '留空保留已保存内容' : placeholder}" autocomplete="off" spellcheck="false"></textarea>`}${flags[key] ? `<label class="payment-clear-secret"><input type="checkbox" name="clear-${key}">移除已保存的${label}</label>` : ''}</div>`).join('')}</div><div class="payment-field payment-notify"><label for="${provider}-notify">异步通知地址</label><input id="${provider}-notify" type="text" readonly value="${esc(data.notifyUrl || `https://paperknow.cn/api/payments/notify/${provider}`)}"><p class="settings-note">用于支付平台返回交易结果。请在对应商户平台核对应用与回调配置。</p></div><label class="toggle-row payment-enable" for="${provider}-enabled"><span><b>启用${spec.title}</b><p>关闭后不接受该渠道的新订单，已有订单仍以交易记录为准。</p></span><input id="${provider}-enabled" name="enabled" type="checkbox" ${data.enabled ? 'checked' : ''}></label><div class="payment-validation" id="${provider}-validation" ${checks.length ? '' : 'hidden'}><strong>待完善的配置</strong><ul>${checks.map(check => `<li>${esc(validationText(check))}</li>`).join('')}</ul></div><p class="payment-check-result" id="${provider}-check-result" role="status" hidden></p><p class="form-error" id="${provider}-error" role="alert" hidden></p><div class="payment-form-actions"><button class="button primary" type="submit" ${encryptionReady ? '' : 'disabled'}>保存渠道配置</button><button class="button" type="button" data-payment-check="${provider}">检查已保存配置</button><span class="settings-note payment-dirty" hidden>有修改尚未保存</span></div></form></section>`;
  }
  function paymentProduct(item) {
    const id = esc(item.id), active = item.status === 'active';
    return `<form class="payment-product" data-payment-product="${id}" autocomplete="off"><div class="payment-product-heading"><h3>${esc(item.title || item.id)}</h3><span class="badge ${active ? 'green' : ''}">${active ? '已上架' : '未上架'}</span></div><div class="payment-field-grid"><div class="payment-field"><label for="product-${id}-title">商品名称</label><input id="product-${id}-title" name="title" type="text" maxlength="100" value="${esc(item.title || '')}" required></div><div class="payment-field"><label for="product-${id}-status">销售状态</label><select id="product-${id}-status" name="status"><option value="preview" ${active ? '' : 'selected'}>未上架</option><option value="active" ${active ? 'selected' : ''}>上架销售</option></select></div><div class="payment-field"><label for="product-${id}-price">售价（元）</label><input id="product-${id}-price" name="price" type="text" inputmode="decimal" value="${priceText(item.priceCents)}" placeholder="填写实际售价，如 29.90" maxlength="10"></div><div class="payment-field"><label for="product-${id}-days">会员有效期（天）</label><input id="product-${id}-days" name="durationDays" type="text" inputmode="numeric" value="${Number.isSafeInteger(item.durationDays) && item.durationDays > 0 ? item.durationDays : ''}" placeholder="填写 1–366 天" maxlength="3"></div></div><div class="payment-field"><label for="product-${id}-description">可交付权益说明</label><textarea id="product-${id}-description" name="description" rows="3" maxlength="2000" placeholder="说明当前确实能够交付的会员权益">${esc(item.description || '')}</textarea></div><p class="form-error" role="alert" hidden></p><div class="payment-form-actions"><button class="button" type="submit">保存商品</button><span class="settings-note payment-dirty" hidden>有修改尚未保存</span></div></form>`;
  }
  function paymentsPage(data = {}) {
    const channels = Array.isArray(data.channels) ? data.channels : [], catalog = Array.isArray(data.catalog) ? data.catalog : [];
    return `<div class="payment-intro"><div>${icon('shield')}<span><strong>支付参数仅供管理员管理</strong><br>配置完整与真实收款是两个状态。检查仅验证本地配置，不会创建支付、扣款或证明渠道已通过商户审核。</span></div><a class="text-button" href="#orders" data-view="orders">查看订单记录 →</a></div>${data.encryptionReady === true ? '' : '<div class="page-notice payment-encryption-warning" role="status">服务端尚未准备好支付配置加密，暂不能保存渠道参数。请先完成服务端加密配置。</div>'}<div class="payment-channels">${Object.keys(paymentProviders).map(provider => paymentChannel(provider, channels.find(channel => channel.provider === provider), data.encryptionReady === true)).join('')}</div><section class="panel payment-catalog"><div class="panel-heading"><div><h2>可售商品</h2><p>只有确认可交付权益并上架商品后，用户才能购买。未上架商品不接受支付。</p></div><span class="badge">会员权益</span></div><p class="payment-catalog-note">付款成功后按订单记录会员有效期。请写明实际权益，不要将尚未开放的 AI 额度或服务列入收费承诺。</p>${catalog.length ? `<div class="payment-products">${catalog.map(paymentProduct).join('')}</div>` : '<div class="payment-catalog-empty">暂无可配置的商品，未开放商品购买。</div>'}</section><section class="payment-help"><h2>配置与上线说明</h2><ol><li>在微信支付、支付宝的商户平台申请并开通对应的网站支付能力。</li><li>填写当前应用的签名与验签参数，保存后检查配置，再启用渠道。</li><li>确认商品价格、会员有效期和可交付权益后，再上架商品。</li><li>正式开放前完成一笔受控真实交易，核对支付平台记录、通知结果及网站订单状态。</li></ol><p>密钥仅提交到本站服务端。不要放入反馈、截图或聊天记录中。</p><div class="payment-help-links"><a href="https://pay.weixin.qq.com/" target="_blank" rel="noopener noreferrer">微信支付商户平台 ↗</a><a href="https://open.alipay.com/" target="_blank" rel="noopener noreferrer">支付宝开放平台 ↗</a></div></section>`;
  }
  const paymentForms = () => [...doc.querySelectorAll('#admin-content form[data-payment-provider], #admin-content form[data-payment-product]')];
  const paymentFormKey = form => form.dataset.paymentProvider || 'product:' + form.dataset.paymentProduct;
  function paymentFingerprint(form) { return JSON.stringify([...form.querySelectorAll('[name]')].map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value])); }
  function rememberPaymentForms() { paymentBaselines.clear(); for (const form of paymentForms()) paymentBaselines.set(paymentFormKey(form), paymentFingerprint(form)); }
  function formIsDirty(form) { return paymentBaselines.get(paymentFormKey(form)) !== paymentFingerprint(form); }
  function paymentsHaveWork() { return authorized && currentView === 'payments' && (pendingPayments.size > 0 || paymentForms().some(formIsDirty)); }
  function refreshPaymentDirty(form) { const dirty = formIsDirty(form); const note = form.querySelector('.payment-dirty'); if (note) note.hidden = !dirty; const check = form.querySelector('[data-payment-check]'); if (check) check.disabled = dirty || pendingPayments.has(paymentFormKey(form)); }
  function guardPayments(action) {
    if (!paymentsHaveWork()) { action(); return; }
    if (pendingPayments.size) { toast('正在保存支付配置，请等待完成后再离开。'); return; }
    openDialog('支付配置尚未保存', '<p class="dialog-copy">离开将丢弃当前未保存的渠道或商品修改。已保存的配置不受影响。</p><div class="dialog-actions"><button class="button" data-dialog-close>继续编辑</button><button class="button danger-solid" id="discard-payment-changes">放弃修改并离开</button></div>');
    $('#discard-payment-changes').onclick = () => { paymentBaselines.clear(); closeDialog(); action(); };
  }
  async function loadView(view = currentView, { quiet = false } = {}) {
    if (!authorized) return;
    currentView = view; const ticket = ++generation;
    navigation();
    if (!quiet) { currentData = null; loadedAt = ''; $('#admin-content').innerHTML = heading(view) + loading(); }
    try {
      const query = queries[view];
      const suffix = query ? '?' + new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), ...(query.q ? { q: query.q } : {}), ...(query.status ? { status: query.status } : {}) }) : '';
      const data = await request('/admin/' + view + suffix);
      if (!authorized || ticket !== generation) return;
      if (query && !Array.isArray(data.items)) throw new Error('返回的数据格式不正确，请重试。');
      if (quiet && (doc.activeElement?.closest('#search-form, #model-form') || $('#admin-dialog').open || paymentsHaveWork())) return;
      if (query && Number.isInteger(data.page) && data.page > 0) query.page = data.page;
      if (query && query.page > Math.max(1, Math.ceil((Number(data.total) || 0) / query.pageSize))) { query.page = Math.max(1, Math.ceil((Number(data.total) || 0) / query.pageSize)); await loadView(view); return; }
      currentData = data; loadedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      $('#admin-content').innerHTML = heading(view) + (view === 'overview' ? overviewPage(data) : view === 'settings' ? settingsPage(data) : view === 'payments' ? paymentsPage(data) : listPage(view, data));
      if (view === 'payments') rememberPaymentForms();
    } catch (error) {
      if (!authorized || ticket !== generation) return;
      if (quiet) { toast(error.message); return; }
      currentData = null;
      $('#admin-content').innerHTML = heading(view) + `<section class="panel">${empty('数据暂时无法加载', error.message, true)}</section>`;
    }
  }
  function navigateView(view) {
    if (!authorized || !Object.hasOwn(paths, view)) return;
    guardPayments(() => { closeDialog(); closeMenu(); win.history.pushState(null, '', '#' + view); loadView(view); });
  }
  function openDialog(title, body) {
    if (!authorized) return;
    previousFocus = doc.activeElement;
    dialogGeneration++;
    $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body;
    if (!$('#admin-dialog').open) $('#admin-dialog').showModal();
    return dialogGeneration;
  }
  const details = pairs => `<dl class="detail-grid">${pairs.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value ?? '—')}</dd>`).join('')}</dl>`;
  function findRow(id) { return currentData?.items?.find(row => String(row.id) === id); }
  function showDetail(id) {
    const row = findRow(id); if (!row) return;
    if (currentView === 'users') openDialog('用户资料', details([['用户 ID', row.id], ['昵称', row.name], ['邮箱', row.email || '未填写'], ['邮箱验证', row.email_verified_at ? date(row.email_verified_at) : '未验证'], ['手机号', row.phone || '未填写'], ['手机验证', row.phone_verified_at ? date(row.phone_verified_at) : '未验证'], ['身份', statuses[row.role]?.[0] || row.role], ['注册时间', date(row.created_at)], ['项目 / 任务', `${count(row.project_count)} / ${count(row.job_count)}`]]));
    else if (currentView === 'jobs') openDialog('任务详情', details([['任务 ID', row.id], ['任务类型', typeNames[row.type] || row.type], ['所属用户', row.user_name], ['联系方式', row.user_email || row.user_phone || '未填写'], ['状态', statuses[row.status]?.[0] || row.status], ['阶段', row.stage], ['执行次数', count(row.attempt)], ['创建时间', date(row.created_at)], ['更新时间', date(row.updated_at)], ['关联成果', row.result_id || '尚无成果']]) + (row.error ? `<div class="detail-block">${esc(row.error)}</div>` : ''));
    else if (currentView === 'audit') openDialog('操作日志详情', details([['操作 ID', row.id], ['管理员', row.user_name], ['联系方式', row.user_email || row.user_phone || '未填写'], ['操作', auditNames[row.action] || row.action], ['目标类型', row.target_type], ['目标 ID', row.target_id], ['操作时间', date(row.created_at)]]) + `<pre class="detail-block">${esc(JSON.stringify(row.detail || {}, null, 2))}</pre>`);
  }
  function confirmCancel(id) {
    const row = findRow(id); if (!row || !['queued', 'running'].includes(row.status)) return;
    const token = openDialog('确认取消任务', `<p class="dialog-copy">取消后将停止该任务，已发生的模型调用仍可能产生第三方费用。</p>${details([['任务', typeNames[row.type] || row.type], ['任务 ID', row.id], ['所属用户', row.user_name]])}<p class="form-error" id="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button class="button" data-dialog-close>继续执行</button><button class="button danger-solid" id="confirm-cancel">确认取消</button></div>`);
    $('#confirm-cancel').onclick = async () => {
      const button = $('#confirm-cancel'), ticket = generation; button.disabled = true; button.textContent = '正在取消…';
      try {
        await request('/admin/jobs/' + encodeURIComponent(row.id) + '/cancel', {});
        if (!authorized || token !== dialogGeneration) return;
        closeDialog(); toast('任务已取消。'); if (ticket === generation) await loadView();
      } catch (error) { if (authorized && token === dialogGeneration) { $('#dialog-error').hidden = false; $('#dialog-error').textContent = error.message; } }
      finally { if (authorized && token === dialogGeneration) { button.disabled = false; button.textContent = '确认取消'; } }
    };
  }
  function editFeedback(id) {
    const row = findRow(id); if (!row) return;
    const token = openDialog('处理用户反馈', details([['提交用户', row.user_name], ['联系方式', row.user_email || row.user_phone || '未填写'], ['反馈分类', row.category], ['提交时间', date(row.created_at)]]) + `<div class="detail-block">${esc(row.body)}</div><form id="feedback-form"><div class="dialog-field"><label for="feedback-status">处理状态</label><select id="feedback-status">${filters.feedback.map(status => `<option value="${status}" ${status === (row.status || 'open') ? 'selected' : ''}>${statuses[status][0]}</option>`).join('')}</select></div><div class="dialog-field"><label for="feedback-note">处理备注</label><textarea id="feedback-note" maxlength="2000" rows="4" placeholder="记录处理进展或解决方式">${esc(row.note || '')}</textarea></div><p class="settings-note">备注仅用于管理记录，不会自动发送邮件或短信。</p><p class="form-error" id="feedback-error" role="alert" hidden></p><div class="dialog-actions"><button class="button" type="button" data-dialog-close>返回</button><button class="button primary" id="save-feedback" type="submit">保存处理</button></div></form>`);
    $('#feedback-form').onsubmit = async event => {
      event.preventDefault(); const button = $('#save-feedback'), ticket = generation;
      if (button.disabled) return;
      button.disabled = true; button.textContent = '正在保存…'; $('#feedback-error').hidden = true;
      const payload = { status: $('#feedback-status').value, note: $('#feedback-note').value.trim() };
      try {
        await request('/admin/feedback/' + encodeURIComponent(row.id), payload);
        if (!authorized || token !== dialogGeneration) return;
        closeDialog(); toast('反馈处理状态已保存。'); if (ticket === generation) await loadView();
      } catch (error) { if (authorized && token === dialogGeneration) { $('#feedback-error').hidden = false; $('#feedback-error').textContent = error.message; } }
      finally { if (authorized && token === dialogGeneration) { button.disabled = false; button.textContent = '保存处理'; } }
    };
  }
  async function saveSettings(event) {
    event.preventDefault(); if (!authorized || currentView !== 'settings' || !currentData) return;
    const model = $('#model-name').value.trim(), button = $('#save-model'), errorNode = $('#model-error'), ticket = generation;
    if (button.disabled) return;
    errorNode.hidden = true;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model)) { errorNode.textContent = '请输入有效的模型名称。'; errorNode.hidden = false; $('#model-name').focus(); return; }
    button.disabled = true; button.textContent = '正在保存…';
    try {
      await request('/admin/model', { model, enabled: $('#model-enabled').checked });
      if (!authorized || ticket !== generation) return;
      toast('模型配置已保存。'); await loadView('settings');
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { if (authorized && ticket === generation) { button.disabled = false; button.textContent = '保存配置'; } }
  }
  function updatePaymentChannel(provider, channel) {
    if (!Array.isArray(currentData.channels)) currentData.channels = [];
    const index = currentData.channels.findIndex(item => item.provider === provider);
    if (index >= 0) currentData.channels[index] = channel; else currentData.channels.push(channel);
    const panel = doc.querySelector(`.payment-channel[data-provider="${provider}"]`);
    panel.outerHTML = paymentChannel(provider, channel, currentData.encryptionReady === true);
    const form = $(`#payment-${provider}`);
    paymentBaselines.set(provider, paymentFingerprint(form));
  }
  async function savePaymentChannel(event) {
    event.preventDefault(); const form = event.target, provider = form.dataset.paymentProvider;
    if (!authorized || currentView !== 'payments' || !paymentProviders[provider] || !currentData || pendingPayments.has(provider)) return;
    const errorNode = $(`#${provider}-error`), button = form.querySelector('[type="submit"]'), ticket = generation;
    errorNode.hidden = true;
    if (currentData.encryptionReady !== true) { errorNode.textContent = '服务端尚未准备好支付配置加密，暂不能保存。'; errorNode.hidden = false; return; }
    const payload = { enabled: form.elements.enabled.checked }, clears = [];
    for (const [key] of paymentProviders[provider].fields) payload[key] = form.elements[key].value.trim();
    for (const [key] of paymentProviders[provider].secrets) {
      if (form.elements['clear-' + key]?.checked) clears.push(key);
      else if (form.elements[key].value.trim()) payload[key] = form.elements[key].value.trim();
    }
    if (clears.length) payload.clearSecrets = clears;
    pendingPayments.add(provider); for (const field of form.elements) field.disabled = true; button.textContent = '正在保存…'; refreshPaymentDirty(form);
    try {
      const result = await request('/admin/payments/' + provider, payload);
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      updatePaymentChannel(provider, { ...result, provider }); toast('渠道配置已保存。可检查配置完整性后核对真实交易。');
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(provider); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; button.textContent = '保存渠道配置'; const live = $(`#payment-${provider}`); if (live) refreshPaymentDirty(live); } }
  }
  async function checkPaymentChannel(provider) {
    const form = $(`#payment-${provider}`);
    if (!authorized || currentView !== 'payments' || !form || pendingPayments.has(provider)) return;
    if (formIsDirty(form)) { toast('请先保存修改，再检查已保存的配置。'); return; }
    const button = form.querySelector('[data-payment-check]'), errorNode = $(`#${provider}-error`), ticket = generation;
    pendingPayments.add(provider); for (const field of form.elements) field.disabled = true; button.textContent = '正在检查…'; errorNode.hidden = true;
    try {
      const result = await request('/admin/payments/' + provider + '/check', {});
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      const previous = currentData.channels?.find(channel => channel.provider === provider) || {};
      updatePaymentChannel(provider, { ...previous, ...result, provider });
      const node = $(`#${provider}-check-result`); node.hidden = false; node.classList.toggle('passed', result.ok === true); node.textContent = result.ok === true ? '本地配置检查通过，尚未进行真实支付验证。' : '本地配置检查未通过，请按提示完善后重新保存。';
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(provider); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; const live = $(`#payment-${provider}`); if (live) refreshPaymentDirty(live); button.textContent = '检查已保存配置'; } }
  }
  async function savePaymentProduct(event) {
    event.preventDefault(); const form = event.target, id = form.dataset.paymentProduct, key = 'product:' + id, ticket = generation;
    if (!authorized || currentView !== 'payments' || !currentData || pendingPayments.has(key)) return;
    const errorNode = form.querySelector('.form-error'), button = form.querySelector('[type="submit"]'); errorNode.hidden = true;
    const rawPrice = form.elements.price.value.trim(), rawDays = form.elements.durationDays.value.trim(), amount = rawPrice ? priceCents(rawPrice) : null, days = /^[1-9]\d{0,2}$/.test(rawDays) && Number(rawDays) <= 366 ? Number(rawDays) : null;
    const payload = { title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), status: form.elements.status.value, priceCents: amount, durationDays: days };
    const invalid = !payload.title ? '请填写商品名称。' : rawPrice && amount === null ? '请输入大于 0 的售价，最多保留两位小数。' : rawDays && days === null ? '会员有效期需为 1–366 的整数天。' : payload.status === 'active' && (!amount || !days || !payload.description) ? '上架前请填写售价、会员有效期和实际可交付权益。' : '';
    if (invalid) { errorNode.textContent = invalid; errorNode.hidden = false; return; }
    pendingPayments.add(key); for (const field of form.elements) field.disabled = true; button.textContent = '正在保存…';
    try {
      const result = await request('/admin/payments/products/' + encodeURIComponent(id), payload);
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      const item = result.item;
      if (!item || item.id !== id) throw new Error('商品返回数据不完整，请刷新后核对保存结果。');
      const index = currentData.catalog.findIndex(product => product.id === id); if (index >= 0) currentData.catalog[index] = item;
      const holder = doc.createElement('div'); holder.innerHTML = paymentProduct(item); const replacement = holder.firstElementChild; form.replaceWith(replacement); paymentBaselines.set(key, paymentFingerprint(replacement)); toast(item.status === 'active' ? '商品已保存并上架，请核对交付权益。' : '商品已保存，当前未上架。');
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(key); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; button.textContent = '保存商品'; } }
  }
  $('#admin-app').addEventListener('click', event => {
    const link = event.target.closest('[data-view]');
    if (link) { event.preventDefault(); navigateView(link.dataset.view); return; }
    if (!authorized) return;
    if (event.target.closest('#refresh-view, #retry-view')) { guardPayments(() => loadView()); return; }
    const paymentCheck = event.target.closest('[data-payment-check]'); if (paymentCheck) { checkPaymentChannel(paymentCheck.dataset.paymentCheck); return; }
    const query = queries[currentView];
    if (event.target.closest('#reset-search') && query) { Object.assign(query, { q: '', status: '', page: 1 }); loadView(); }
    if (event.target.closest('#previous-page') && query && query.page > 1) { query.page--; loadView(); }
    if (event.target.closest('#next-page') && query && query.page * query.pageSize < Number(currentData?.total)) { query.page++; loadView(); }
    const detail = event.target.closest('[data-detail]'); if (detail) showDetail(detail.dataset.detail);
    const cancel = event.target.closest('[data-cancel]'); if (cancel) confirmCancel(cancel.dataset.cancel);
    const feedback = event.target.closest('[data-feedback]'); if (feedback) editFeedback(feedback.dataset.feedback);
  });
  $('#admin-content').addEventListener('submit', event => {
    if (!authorized) return;
    if (event.target.id === 'search-form') { event.preventDefault(); Object.assign(queries[currentView], { q: $('#admin-search').value.trim(), status: $('#status-filter')?.value || '', page: 1 }); loadView(); }
    if (event.target.id === 'model-form') saveSettings(event);
    if (event.target.matches('form[data-payment-provider]')) savePaymentChannel(event);
    if (event.target.matches('form[data-payment-product]')) savePaymentProduct(event);
  });
  for (const name of ['input', 'change']) $('#admin-content').addEventListener(name, event => { const form = event.target.closest('form[data-payment-provider], form[data-payment-product]'); if (form) refreshPaymentDirty(form); });
  $('#menu-toggle').onclick = () => { const open = $('#admin-app').classList.toggle('nav-open'); $('#sidebar-backdrop').hidden = !open; $('#menu-toggle').setAttribute('aria-expanded', String(open)); };
  $('#sidebar-backdrop').onclick = closeMenu;
  $('#dialog-close').onclick = closeDialog;
  $('#admin-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  $('#dialog-body').addEventListener('click', event => { if (event.target.closest('[data-dialog-close]')) closeDialog(); });
  $('#logout').onclick = () => { if (!authorized) return; guardPayments(async () => { $('#logout').disabled = true; try { await request('/auth/logout', {}); deny(401, '你已退出登录。'); } catch (error) { if (authorized) toast(error.message); } finally { $('#logout').disabled = false; } }); };
  function historyNavigation() { if (!authorized || currentView === route()) return; const target = route(); if (paymentsHaveWork()) win.history.replaceState(null, '', '#' + currentView); guardPayments(() => { closeDialog(); closeMenu(); win.history.replaceState(null, '', '#' + target); loadView(target); }); }
  win.addEventListener('popstate', historyNavigation);
  win.addEventListener('hashchange', historyNavigation);
  win.addEventListener('beforeunload', event => { if (paymentsHaveWork()) { event.preventDefault(); event.returnValue = ''; } });
  $('#admin-app').addEventListener('click', event => { const link = event.target.closest('a[href]'); if (!link || link.hasAttribute('data-view') || link.target === '_blank' || link.getAttribute('href').startsWith('#') || !paymentsHaveWork()) return; event.preventDefault(); guardPayments(() => go(link.href)); });
  async function initialize() {
    $('#access-title').textContent = '正在验证管理权限'; $('#access-message').textContent = '请稍候，正在确认你的账户身份。'; $('#access-actions').replaceChildren();
    try {
      const account = await request('/auth/me');
      if (account.user?.role !== 'admin') { deny(403); return; }
      authorized = true; user = account.user;
      $('#admin-name').textContent = user.name || user.email || user.phone || '管理员'; $('#admin-avatar').textContent = (user.name || 'P').slice(0, 1).toUpperCase();
      $('#access-gate').hidden = true; $('#admin-app').hidden = false; currentView = route();
      await loadView(currentView);
      win.clearInterval(polling);
      if (authorized) polling = win.setInterval(() => { if (authorized && !doc.hidden && ['overview', 'jobs'].includes(currentView) && !$('#admin-dialog').open && !doc.activeElement?.closest('#search-form')) loadView(currentView, { quiet: true }); }, pollIntervalMs);
    } catch (error) {
      if (error.status === 401 || error.status === 403) return;
      $('#access-title').textContent = '暂时无法验证账户'; $('#access-message').textContent = error.message;
      $('#access-actions').innerHTML = '<button class="button primary" id="retry-access">重新验证</button><a class="button" href="/workspace.html#home">返回工作台</a>';
      $('#retry-access').onclick = initialize;
    }
  }
  const ready = initialize();
  const destroy = () => { generation++; authorized = false; currentData = null; win.clearInterval(polling); win.clearTimeout(toastTimer); };
  win.addEventListener('pagehide', destroy, { once: true });
  return { ready, destroy };
}

if (typeof document !== 'undefined') createAdminPage(document);
