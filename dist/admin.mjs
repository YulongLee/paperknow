import {toolBillingServiceTypes,toolBillingModes,toolBillingPage,toolBillingRulesValid,toolBillingPayload} from './admin-tool-billing.mjs';
import {monitoringPage,monitoringSettingsPayload} from './admin-monitoring.mjs';
const paths = {
  overview: ['运营概览', '掌握账户、任务与服务的运行情况。', 'grid'],
  users: ['用户管理', '查看注册账户、联系方式验证与使用情况。', 'users'],
  jobs: ['任务管理', '追踪任务状态，处理排队中或执行中的任务。', 'task'],
  results: ['成果记录', '查看服务端成果的归属、类型与创建记录。', 'file'],
  feedback: ['用户反馈', '记录处理进度，让每一条反馈都有回应。', 'message'],
  orders: ['订单记录', '查看已有订单与商品信息。', 'order'],
  usage: ['用量记录', '查看模型调用及实际返回的 Token 用量。', 'chart'],
  monitoring: ['运行监控', '监控容量、任务、支付与对象存储，提前发现运行风险。', 'chart'],
  settings: ['系统设置', '管理模型配置，查看平台服务的连接状态。', 'settings'],
  payments: ['商品与计费', '管理服务计价、可交付权益与收款渠道。', 'order'],
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
const auditNames = { 'owner.verified': '管理员身份验证', 'job.cancel': '取消任务', 'feedback.update': '更新反馈', 'model.update': '修改模型配置', 'payment.config.update': '修改支付配置', 'payment.product.update': '修改可售商品', 'payment.channel.update': '切换或更新支付渠道', 'billing.rules.update': '修改服务计价', 'billing.tools.update': '修改科研工具计价' };
const billableServices = [{ key: 'polish', title: '学术润色' }, { key: 'review', title: '意见修改' }, { key: 'agent', title: '科研智能助手' }];
const billingModes = { free: '免费', paid: '按权益计费', disabled: '暂停' };
const paymentProviders = {
  wechat: { title: '微信支付', short: '微', note: '微信 API v3 Native 扫码支付；需商户开通对应产品。', fields: [['appId', '应用 AppID', '微信商户绑定的应用 ID'], ['merchantId', '商户号', '微信支付商户号'], ['merchantSerial', '商户 API 证书序列号', '用于签名请求的证书序列号'], ['platformPublicKeyId', '微信支付公钥 ID', 'PUB_KEY_ID_…']], secrets: [['privateKey', '商户 API 私钥', 'PEM 格式私钥'], ['apiV3Key', 'API v3 密钥', '32 位 API v3 密钥'], ['platformPublicKey', '微信支付公钥', 'PEM 格式公钥']] },
  alipay: { title: '支付宝', short: '支', note: '支付宝电脑网站支付，跳转官方收银台；需当前应用开通对应产品，使用 RSA2 签名配置。', fields: [['appId', '应用 AppID', '支付宝开放平台应用 ID'], ['sellerId', '收款卖家 PID', '支付宝商家收款账户 PID']], secrets: [['privateKey', '应用私钥', 'PEM 格式 RSA 私钥'], ['alipayPublicKey', '支付宝公钥', '支付宝提供的验签公钥']] }
};
const priceText = cents => Number.isSafeInteger(cents) && cents > 0 ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` : '';
const priceCents = value => { const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(value); if (!match) return null; const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')); return Number.isSafeInteger(amount) && amount > 0 ? amount : null; };

export function createAdminPage(doc, { navigate, requestTimeoutMs = 30_000, pollIntervalMs = 30_000 } = {}) {
  const win = doc.defaultView, $ = selector => doc.querySelector(selector);
  if(!doc.querySelector('link[data-tool-billing-style]')){const style=doc.createElement('link');style.rel='stylesheet';style.href='/admin-tool-billing.css';style.dataset.toolBillingStyle='';doc.head.append(style);}
  const allBillableServices=()=>[...billableServices,...(toolBillingRulesValid(currentData?.toolBilling)?toolBillingServiceTypes:[])];
  const billingRule=key=>currentData?.billing?.services?.find(item=>item.key===key)||((item)=>item?{...item,mode:item.effectiveMode,creditCost:item.effectiveCreditCost}:null)(currentData?.toolBilling?.services?.find(item=>item.key===key));
  const go = navigate || (url => win.location.replace(url));
  const loginUrl = '/auth.html?mode=login&next=%2Fadmin.html';
  let authorized = false, user = null, currentView = 'overview', generation = 0, currentData = null, loadedAt = '', polling, toastTimer, previousFocus, dialogGeneration = 0;
  const paymentBaselines = new Map(), pendingPayments = new Set();
  let agentBaseline = '', agentPending = false;
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
  function paymentChannelControl(provider, data = {}, encryptionReady = false) {
    const spec = paymentProviders[provider], enabled = data.enabled === true, configured = data.configured === true;
    const state = enabled && data.ready === true ? ['已启用', 'green'] : configured && !enabled ? ['未启用', ''] : ['配置待完善', 'amber'];
    const disabled = !encryptionReady || (!enabled && !configured) || pendingPayments.has(provider);
    return `<article class="payment-channel-control ${provider}" data-channel-control="${provider}"><div class="payment-channel-control-top"><span class="payment-provider-mark ${provider}" aria-hidden="true">${spec.short}</span><div><h3 id="${provider}-switch-title">${spec.title}</h3><span class="badge ${state[1]}">${state[0]}</span></div><label class="payment-channel-switch"><span class="sr-only">启用${spec.title}</span><input id="${provider}-enabled" type="checkbox" role="switch" data-payment-toggle="${provider}" aria-labelledby="${provider}-switch-title" aria-describedby="${provider}-switch-description" ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span aria-hidden="true"></span></label></div><p id="${provider}-switch-description">${enabled && data.ready === true ? '收银台展示此支付方式，可用于所有已上架商品。' : configured ? '商户配置已保存；开启后，收银台才会展示此支付方式。' : '请先完善并保存下方商户参数，配置完整后才可启用。'}</p><div class="payment-channel-control-foot"><span>${enabled ? '关闭保留参数与密钥，已有订单仍可核对。' : '开关立即保存，关闭不会删除参数或密钥。'}</span><button type="button" class="text-button" data-payment-configure="${provider}">${configured ? '管理参数' : '完善配置'} ↓</button></div><p id="${provider}-switch-message" class="payment-switch-message" role="status" hidden></p></article>`;
  }
  function paymentChannelControls(data) {
    return `<section class="payment-channel-controls" aria-labelledby="payment-channel-controls-title"><div class="payment-channel-controls-heading"><h2 id="payment-channel-controls-title">选择收银台展示的支付方式</h2><p>会员、积分、套餐共用以下渠道。分别开启微信支付或支付宝，用户只看到已启用且配置完整的支付方式。</p></div><div class="payment-channel-control-grid">${Object.keys(paymentProviders).map(provider => paymentChannelControl(provider, data.channels?.find(channel => channel.provider === provider), data.encryptionReady === true)).join('')}</div></section>`;
  }
  function settingsPage(data) {
    const ai = data.ai || {}, auth = data.auth || {};
    return `<div class="settings-grid"><section class="panel"><div class="panel-heading"><div><h2>AI 模型配置</h2><p>模型变更对后续任务生效</p></div><span class="service-status ${ai.ready ? '' : 'off'}">${ai.ready ? '可用' : '未就绪'}</span></div><form id="model-form" class="settings-body"><div class="settings-meta"><div><span>模型服务</span><b>${esc(ai.provider || '未配置')}</b></div><div><span>连接配置</span><b>${ai.configured ? '已配置' : '未配置'}</b></div></div><label for="model-name">模型名称</label><input id="model-name" type="text" maxlength="100" required value="${esc(ai.model || '')}" placeholder="填写当前服务可用的模型名称" autocomplete="off"><p class="settings-note">请填写当前模型服务已开通的模型名称。</p><label class="toggle-row" for="model-enabled"><span><b>启用 AI 服务</b><p>暂停后，用户无法提交新的 AI 任务。</p></span><input id="model-enabled" type="checkbox" ${ai.enabled ? 'checked' : ''}></label>${!ai.configured ? '<div class="page-notice">连接信息尚未配置。仅开启此开关不会使模型服务可用。</div>' : ''}<div class="form-error" id="model-error" role="alert" hidden></div><div class="settings-actions"><button class="button primary" id="save-model" type="submit">保存配置</button><span class="settings-note">保存操作会写入操作日志</span></div></form></section><section class="panel"><div class="panel-heading"><h2>平台服务</h2></div><div class="service-status-list">${serviceRow('邮箱验证码', 'mail', auth.emailCode)}${serviceRow('短信验证码', 'phone', auth.phoneCode)}${serviceRow('在线支付', 'order', data.payment, '已开放')}</div><div class="settings-body"><div class="settings-meta"><div><span>文件存储</span><b>${storageName(data.storage?.provider)}</b></div></div><p class="settings-note">短信、邮件和文件存储使用服务端连接配置。此页面展示当前服务状态。支付参数与可售商品可在支付配置中管理。</p><a class="button payment-settings-link" href="#payments" data-view="payments">${icon('order')}管理支付配置 →</a></div></section></div>`;
  }
  function agentSettingsPanel(agent) {
    if (!agent) return '';
    const numberField = (key, label, min, max, step = 1) => `<div class="payment-field"><label for="agent-${key}">${label}</label><input name="${key}" id="agent-${key}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(agent[key])}" required></div>`;
    return `<section class="panel" id="agent-settings-panel"><div class="panel-heading"><div><h2>公共 Agent 执行配置</h2><p>供论文章节等功能共用；模型变更仅影响新任务，关闭后暂停未开始及后续章节</p></div><span class="service-status ${agent.ready ? '' : 'off'}">${agent.ready ? '已启用 · 待业务验收' : '未启用或配置未完整'}</span></div><form id="agent-settings-form" class="settings-body" autocomplete="off"><div class="settings-meta"><div><span>执行引擎</span><b>Claude Agent SDK</b></div><div><span>配置版本</span><b>${agent.version ? esc(agent.version.slice(0, 8)) : '尚未保存'}</b></div></div><p class="settings-note">仅支持 Anthropic Messages 兼容接口，不代表任意模型均兼容。密钥只保存在服务器，留空保留已有密钥；当前${agent.credentialConfigured ? '已配置密钥' : '未配置密钥'}。</p><div class="payment-field-grid"><div class="payment-field"><label for="agent-baseURL">Anthropic Base URL</label><input id="agent-baseURL" name="baseURL" type="url" value="${esc(agent.baseURL)}" placeholder="https://dashscope.aliyuncs.com/apps/anthropic" maxlength="500"></div><div class="payment-field"><label for="agent-model">模型名称</label><input id="agent-model" name="model" value="${esc(agent.model)}" maxlength="120" autocomplete="off"></div><div class="payment-field"><label for="agent-apiKey">API 密钥（留空保留）</label><input id="agent-apiKey" name="apiKey" type="password" value="" maxlength="4096" autocomplete="new-password" placeholder="${agent.credentialConfigured ? '已配置，留空保留' : '填写当前渠道的 API 密钥'}"></div>${numberField('maxTurns', '最多模型回合', 1, 12)}${numberField('timeoutMs', '执行时限（毫秒）', 5000, 300000)}${numberField('maxOutputTokens', '每回合输出 Token 上限', 32, 16384)}${numberField('maxCostUsd', 'SDK 估算预算（美元）', 0.01, 5, 0.01)}</div><label class="toggle-row" for="agent-enabled"><span><b>启用公共 Agent</b><p>关闭后不开始新的章节；已完成内容保留，重新开启并确认续跑时使用原配置版本。</p></span><input id="agent-enabled" name="enabled" type="checkbox" ${agent.enabled ? 'checked' : ''}></label><p class="settings-note">执行仅开放当前授权材料与注册技能，禁止通用命令、文件和网页工具。SDK 美元预算属于估算保护，自有模型的实际费用以渠道账单为准。</p>${!agent.encryptionReady ? '<p class="page-notice">服务器配置加密密钥未就绪，暂不能保存。</p>' : ''}${agent.configurationError ? `<p class="page-notice">${esc(agent.configurationError)}</p>` : ''}<p class="form-error" id="agent-error" role="alert" hidden></p><p class="settings-note" id="agent-test-result" role="status" hidden></p><div class="settings-actions"><button class="button primary" type="submit" ${agent.encryptionReady ? '' : 'disabled'}>保存 Agent 配置</button><button class="button" id="test-agent-connection" type="button" ${agent.version && agent.configured ? '' : 'disabled'}>基础连接测试</button></div><p class="settings-note">测试仅向已保存渠道发送一次最多 32 Token 的短请求，会产生少量 API 用量；通过不代表 Agent 多轮、工具调用或论文效果已验收。</p><span class="settings-note" data-agent-dirty hidden>有修改尚未保存；请先保存后再测试。</span></form></section>`;
  }
  function agentFingerprint() { const form = $('#agent-settings-form'); return form ? JSON.stringify([...form.querySelectorAll('[name]')].map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value])) : ''; }
  function agentHasWork() { return authorized && currentView === 'settings' && Boolean($('#agent-settings-form')) && (agentPending || agentFingerprint() !== agentBaseline); }
  async function saveAgentSettings(event) {
    event.preventDefault(); if (!authorized || currentView !== 'settings' || agentPending || !currentData?.agent) return;
    const form = event.target, ticket = generation, errorNode = $('#agent-error'), payload = { version: currentData.agent.version, engine: 'claude-agent-sdk', enabled: $('#agent-enabled').checked };
    for (const key of ['baseURL', 'model', 'apiKey']) payload[key] = form.elements.namedItem(key).value.trim();
    for (const key of ['maxTurns', 'timeoutMs', 'maxOutputTokens', 'maxCostUsd']) payload[key] = Number(form.elements.namedItem(key).value);
    agentPending = true; errorNode.hidden = true; for (const input of form.querySelectorAll('input')) input.disabled = true; for (const button of form.querySelectorAll('button')) button.disabled = true;
    try { const result = await request('/admin/agent-settings', payload); if (!authorized || ticket !== generation) return; currentData.agent = result.agent; $('#agent-apiKey').value = ''; agentBaseline = agentFingerprint(); toast('Agent 配置已保存；新任务使用此版本，开关控制后续章节执行。'); agentPending = false; await loadView('settings'); }
    catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { agentPending = false; if (authorized && ticket === generation && form.isConnected) { for (const input of form.querySelectorAll('input')) input.disabled = false; form.querySelector('[type="submit"]').disabled = currentData.agent.encryptionReady !== true; $('#test-agent-connection').disabled = !currentData.agent.version || !currentData.agent.configured || agentHasWork(); } }
  }
  async function testAgentSettings() {
    if (!authorized || currentView !== 'settings' || agentPending || !currentData?.agent?.version || agentHasWork()) return;
    const button = $('#test-agent-connection'), output = $('#agent-test-result'), errorNode = $('#agent-error'), ticket = generation;
    agentPending = true; button.disabled = true; errorNode.hidden = true; output.hidden = false; output.textContent = '正在检查已保存渠道的基础连接…';
    try { const result = await request('/admin/agent-settings/test', { version: currentData.agent.version }); if (authorized && ticket === generation) output.textContent = result.ok === true ? '基础连接已通过；Agent 工具执行兼容性仍需单独验收。' : '基础连接未通过，请检查渠道配置。'; }
    catch (error) { if (authorized && ticket === generation) { output.hidden = true; errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { agentPending = false; if (authorized && ticket === generation) button.disabled = agentHasWork(); }
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
    return `<section class="panel payment-channel" data-provider="${provider}"><div class="payment-channel-heading"><span class="payment-provider-mark ${provider}" aria-hidden="true">${spec.short}</span><div><h2>${spec.title}</h2><p>${spec.note}</p></div><span class="badge ${state[1]}">${state[0]}</span></div><form class="payment-form" id="payment-${provider}" data-payment-provider="${provider}" autocomplete="off"><div class="payment-field-grid">${spec.fields.map(([key, label, placeholder]) => `<div class="payment-field"><label for="${provider}-${key}">${label}</label><input type="text" id="${provider}-${key}" name="${key}" value="${esc(fields[key])}" maxlength="200" placeholder="${placeholder}" spellcheck="false" autocomplete="off"></div>`).join('')}</div><div class="payment-secret-section"><h3>${icon('shield')}签名与验签配置</h3><p class="settings-note">保存后不回显密钥。留空保留现有值，填写新内容后替换。</p>${spec.secrets.map(([key, label, placeholder]) => `<div class="payment-field payment-secret"><div class="payment-field-label"><label for="${provider}-${key}">${label}</label><span class="payment-secret-state ${flags[key] ? 'configured' : ''}">${flags[key] ? '已保存' : '未配置'}</span></div>${key === 'apiV3Key' ? `<input type="password" id="${provider}-${key}" name="${key}" value="" maxlength="256" placeholder="${flags[key] ? '留空保留已保存密钥' : placeholder}" autocomplete="new-password" spellcheck="false">` : `<textarea id="${provider}-${key}" name="${key}" rows="3" maxlength="20000" placeholder="${flags[key] ? '留空保留已保存内容' : placeholder}" autocomplete="off" spellcheck="false"></textarea>`}${flags[key] ? `<label class="payment-clear-secret"><input type="checkbox" name="clear-${key}">移除已保存的${label}</label>` : ''}</div>`).join('')}</div><div class="payment-field payment-notify"><label for="${provider}-notify">异步通知地址</label><input id="${provider}-notify" type="text" readonly value="${esc(data.notifyUrl || `https://paperknow.cn/api/payments/notify/${provider}`)}"><p class="settings-note">用于支付平台返回交易结果。请在对应商户平台核对应用与回调配置。</p></div><p class="payment-channel-enable-note">收银台是否显示${spec.title}，由页面顶部的独立开关控制。保存参数会保留当前启用状态。</p><div class="payment-validation" id="${provider}-validation" ${checks.length ? '' : 'hidden'}><strong>待完善的配置</strong><ul>${checks.map(check => `<li>${esc(validationText(check))}</li>`).join('')}</ul></div><p class="payment-check-result" id="${provider}-check-result" role="status" hidden></p><p class="form-error" id="${provider}-error" role="alert" hidden></p><div class="payment-form-actions"><button class="button primary" type="submit" ${encryptionReady ? '' : 'disabled'}>保存渠道配置</button><button class="button" type="button" data-payment-check="${provider}">检查已保存配置</button><span class="settings-note payment-dirty" hidden>有修改尚未保存</span></div></form></section>`;
  }
  const productType = item => item?.entitlementType || item?.entitlement?.type || 'membership';
  function serviceItemRow(id, index, item = {}, membership = false) {
    const prefix = membership ? 'membership' : 'bundle', rowId = `product-${esc(id)}-${prefix}-${index}`;
    const known = allBillableServices().some(service => service.key === item.key);
    return `<div class="payment-bundle-item" data-${prefix}-row="${index}"><div class="payment-field"><label for="${rowId}-title">权益名称</label><input id="${rowId}-title" name="${prefix}Title" type="text" maxlength="80" value="${esc(item.title || '')}" placeholder="填写权益名称"></div><div class="payment-field"><label for="${rowId}-key">可交付服务</label><select id="${rowId}-key" name="${prefix}Key"><option value="">选择已接通服务</option>${!known && item.key ? `<option value="${esc(item.key)}" selected>${esc(item.title || item.key)} · 待接通</option>` : ''}${allBillableServices().map(service => { const saved = billingRule(service.key); return `<option value="${service.key}" ${item.key === service.key ? 'selected' : ''}>${service.title}${saved?.mode === 'paid' && saved.available ? '' : ' · 暂未开放计费'}</option>`; }).join('')}</select></div><div class="payment-field"><label for="${rowId}-quantity">总次数</label><input id="${rowId}-quantity" name="${prefix}Quantity" type="text" inputmode="numeric" maxlength="6" value="${Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : ''}" placeholder="1–100000"></div><button class="payment-bundle-remove" type="button" data-${prefix}-remove aria-label="删除服务项 ${index + 1}">×</button></div>`;
  }
  function billingPage(billing) {
    const valid = billing && billing.version !== undefined && billing.version !== null && billableServices.every(service => billing.services?.some(entry => entry.key === service.key && Object.hasOwn(billingModes, entry.mode)));
    return `<section class="panel billing-panel" aria-labelledby="billing-title"><div class="panel-heading"><div><h2 id="billing-title">服务计价与交付</h2><p>先定义可交付服务，再配置会员、积分与套餐</p></div><span class="badge blue">服务端统一计费</span></div><form id="billing-form" data-billing-form class="billing-form"><p class="billing-flow">付费任务按 <b>会员额度 → 套餐次数 → 科研积分</b> 的顺序预占；成功后扣减，失败或取消后返还。免费任务不消耗权益。</p>${valid ? `<div class="billing-service-grid">${billableServices.map(service => { const item = billing.services.find(entry => entry.key === service.key); return `<article class="billing-service" data-billing-service="${service.key}"><div class="billing-service-heading"><h3>${service.title}</h3><span class="service-status ${item.available ? '' : 'off'}">${item.available ? '服务已接通' : '服务未接通'}</span></div><label for="billing-${service.key}-mode">使用方式</label><select id="billing-${service.key}-mode" name="${service.key}Mode" data-billing-mode="${service.key}">${Object.entries(billingModes).map(([mode, title]) => `<option value="${mode}" ${item.mode === mode ? 'selected' : ''}>${title}</option>`).join('')}</select><label for="billing-${service.key}-cost">每次所需积分</label><div class="billing-cost"><input id="billing-${service.key}-cost" name="${service.key}Cost" type="text" inputmode="numeric" maxlength="6" placeholder="1–100000" value="${Number.isSafeInteger(item.creditCost) && item.creditCost > 0 ? item.creditCost : ''}" ${item.mode === 'paid' ? '' : 'disabled'}><span>积分 / 次</span></div><p>${item.available ? '实际提交前显示费用，由用户确认后使用。' : '连接未就绪时不能交付；设置价格不会自动接通服务。'}</p></article>`; }).join('')}</div>` : '<div class="billing-unavailable" role="status">服务计价信息暂未取得，当前不能保存收费配置。请刷新后重试。</div>'}<div class="billing-save-bar"><p>修改仅对后续新任务生效，不改动已提交任务与已购订单快照。</p><button class="button primary" type="submit" ${valid ? '' : 'disabled'}>保存服务计价</button></div><p class="form-error" role="alert" hidden></p><span class="settings-note payment-dirty" hidden>有服务计价修改尚未保存</span></form></section>`;
  }
  function paymentProduct(item) {
    const id = esc(item.id), active = item.status === 'active', type = productType(item), credits = type === 'credits', bundle = type === 'bundle';
    const label = credits ? '积分购买' : bundle ? '套餐购买' : '会员订阅';
    const quantity = credits ? `<div class="payment-field"><label for="product-${id}-credits">积分数量</label><input id="product-${id}-credits" name="creditAmount" type="text" inputmode="numeric" value="${Number.isSafeInteger(item.creditAmount) && item.creditAmount > 0 ? item.creditAmount : ''}" placeholder="填写 1–1000000 的整数" maxlength="7"></div>` : `<div class="payment-field"><label for="product-${id}-days">${bundle ? '套餐' : '会员'}有效期（天）</label><input id="product-${id}-days" name="durationDays" type="text" inputmode="numeric" value="${Number.isSafeInteger(item.durationDays) && item.durationDays > 0 ? item.durationDays : ''}" placeholder="填写 1–366 天" maxlength="3"></div>`;
    const items = Array.isArray(bundle ? item.bundleItems : item.membershipItems) ? (bundle ? item.bundleItems : item.membershipItems) : [];
    const prefix = bundle ? 'bundle' : 'membership';
    const bundleEditor = !credits ? `<div class="payment-bundle-editor"><div class="payment-bundle-editor-heading"><h4>${bundle ? '套餐服务次数' : '本次会员有效期总额度'}</h4><span>最多 20 项</span></div><p class="settings-note">${bundle ? '选择已接通且开启按权益计费的服务，每种服务只能添加一次。旧服务保留为待接通，不能直接上架。' : '按这次购买的有效期发放总次数，不按日或按月重置；仅可选择已接通且开启按权益计费的服务。'}</p><div class="payment-bundle-items">${items.map((entry, index) => serviceItemRow(item.id, index, entry, !bundle)).join('')}</div><button class="button payment-bundle-add" type="button" data-${prefix}-add ${items.length >= 20 ? 'disabled' : ''}>＋ 添加服务项</button></div>` : '';
    return `<form class="payment-product ${credits ? 'credit-product' : bundle ? 'bundle-product' : 'membership-product'}" data-payment-product="${id}" autocomplete="off"><div class="payment-product-heading"><div><span class="payment-product-type">${label}</span><h3>${esc(item.title || item.id)}</h3></div><span class="badge ${active ? 'green' : ''}">${active ? item.purchasable === false ? '暂不可售' : '已上架' : '未上架'}</span></div>${item.purchasable === false && item.unavailableReason ? `<p class="payment-product-blocked">${icon('info')}${esc(item.unavailableReason)}</p>` : ''}<div class="payment-field-grid"><div class="payment-field"><label for="product-${id}-title">商品名称</label><input id="product-${id}-title" name="title" type="text" maxlength="80" value="${esc(item.title || '')}" required></div><div class="payment-field"><label for="product-${id}-status">销售状态</label><select id="product-${id}-status" name="status"><option value="preview" ${active ? '' : 'selected'}>未上架</option><option value="active" ${active ? 'selected' : ''}>上架销售</option></select></div><div class="payment-field"><label for="product-${id}-price">售价（元）</label><input id="product-${id}-price" name="price" type="text" inputmode="decimal" value="${priceText(item.priceCents)}" placeholder="填写实际售价，如 29.90" maxlength="10"></div>${quantity}</div><div class="payment-field"><label for="product-${id}-description">可交付权益说明</label><textarea id="product-${id}-description" name="description" rows="3" maxlength="1000" placeholder="${credits ? '说明积分到账数量和实际可用范围' : bundle ? '说明套餐服务范围、次数、有效期及实际交付方式' : '说明当前确实能够交付的会员权益'}">${esc(item.description || '')}</textarea></div>${bundleEditor}<p class="payment-product-delivery">${credits ? '按支付订单中的积分数量入账，不增加会员天数。' : bundle ? '付款后发放本次套餐总次数；付费任务成功才扣减，失败或取消返还预占。' : '单次购买，不自动续费。按订单发放本次有效期内的总次数，不增加充值积分。'}</p><p class="form-error" role="alert" hidden></p><div class="payment-form-actions"><button class="button" type="submit">保存商品</button><span class="settings-note payment-dirty" hidden>有修改尚未保存</span></div></form>`;
  }
  function paymentCatalog(catalog) {
    if (!catalog.length) return '<div class="payment-catalog-empty">暂无可配置的商品，未开放商品购买。</div>';
    const groups = [
      ['membership', '会员订阅', '单次购买会员有效期及本期总额度，不自动续费、不按日重置。'],
      ['credits', '积分购买', '初始档位：200 积分 ¥20、500 积分 ¥50、1000 积分 ¥100。积分入账与会员续期分别记录。'],
      ['bundle', '套餐购买', '按订单记录服务组合、次数与有效期，交付范围和方式以商品说明为准。']
    ];
    return groups.map(([type, title, description]) => {
      const items = catalog.filter(item => productType(item) === type);
      return items.length ? `<div class="payment-catalog-group" data-product-group="${type}"><div class="payment-catalog-group-heading"><h3>${title}</h3><p>${description}</p><span class="payment-product-channels">微信支付 · 支付宝 · 以已启用渠道为准</span></div><div class="payment-products">${items.map(paymentProduct).join('')}</div></div>` : '';
    }).join('');
  }
  function paymentSalesStatus(data = {}) {
    const channels = (data.channels || []).filter(item => item.ready === true);
    const paid = [...(data.billing?.services||[]),...(data.toolBilling?.services||[]).map(item=>({...item,mode:item.effectiveMode}))].filter(item=>item.mode==='paid');
    const products = (data.catalog || []).filter(item => item.status === 'active' && item.purchasable !== false);
    const ready = channels.length > 0 && products.length > 0;
    const title = !channels.length ? '收款渠道尚未启用' : !paid.some(item => item.available) ? '积分充值尚未开放' : !products.length ? '尚无可售商品' : '已满足新订单创建条件';
    const detail = !channels.length ? '请完善并启用至少一个支付渠道。渠道开关、服务计价和商品上架分别控制收款条件。' : !paid.length ? '支付渠道已启用，但服务均为免费或暂停。请在下方为已接通的服务设置按权益计费及每次积分，保存后积分商品会重新核对可售状态；无需重复填写商户密钥。' : !paid.some(item => item.available) ? '已设置收费的服务尚未接通或已暂停，当前不能交付。请先恢复服务，再开放对应商品。' : !products.length ? '服务计价已准备好，请在下方配置实际可交付权益并上架商品。' : `${channels.length} 个支付渠道、${products.length} 个商品满足创建条件。商户真实收款、支付通知和权益到账仍需通过实际交易验证。`;
    return `<section id="payment-sale-status" class="panel payment-sales-status" aria-live="polite"><div><span class="badge ${ready ? 'green' : 'amber'}">${ready ? '可创建订单' : '暂不收款'}</span><h2>${title}</h2></div><p>${detail}</p></section>`;
  }
  function syncPaymentAvailability(catalog) {
    if (Array.isArray(catalog)) {
      currentData.catalog = catalog;
      for (const item of catalog) {
        const form = paymentForms().find(node => node.dataset.paymentProduct === item.id);
        if (!form) continue;
        const badge = form.querySelector('.payment-product-heading .badge');
        badge.textContent = item.status === 'active' ? item.purchasable === false ? '暂不可售' : '已上架' : '未上架';
        badge.className = 'badge ' + (item.status === 'active' && item.purchasable !== false ? 'green' : '');
        form.querySelector('.payment-product-blocked')?.remove();
        if (item.purchasable === false && item.unavailableReason) {
          const note = doc.createElement('p'); note.className = 'payment-product-blocked'; note.textContent = item.unavailableReason;
          form.querySelector('.payment-product-heading').after(note);
        }
        for (const option of form.querySelectorAll('select[name="membershipKey"] option, select[name="bundleKey"] option')) {
          const service = allBillableServices().find(entry => entry.key === option.value);
          if (!service) continue;
          const rule = billingRule(service.key);
          option.textContent = service.title + (rule?.mode === 'paid' && rule.available ? '' : ' · 暂未开放计费');
        }
      }
    }
    const status = $('#payment-sale-status');
    if (status) status.outerHTML = paymentSalesStatus(currentData);
  }
  function paymentsPage(data = {}) {
    const channels = Array.isArray(data.channels) ? data.channels : [], catalog = Array.isArray(data.catalog) ? data.catalog : [];
    return `<div class="payment-intro"><div>${icon('shield')}<span><strong>支付参数仅供管理员管理</strong><br>配置完整与真实收款是两个状态。检查仅验证本地配置，不会创建支付、扣款或证明渠道已通过商户审核。</span></div><a class="text-button" href="#orders" data-view="orders">查看订单记录 →</a></div>${paymentSalesStatus(data)}${billingPage(data.billing)}${toolBillingPage(data.toolBilling)}${data.encryptionReady === true ? '' : '<div class="page-notice payment-encryption-warning" role="status">服务端尚未准备好支付配置加密，暂不能保存渠道参数。请先完成服务端加密配置。</div>'}${paymentChannelControls({ ...data, channels })}<div class="payment-channels">${Object.keys(paymentProviders).map(provider => paymentChannel(provider, channels.find(channel => channel.provider === provider), data.encryptionReady === true)).join('')}</div><section class="panel payment-catalog"><div class="panel-heading"><div><h2>可售商品</h2><p>只有确认可交付权益并上架商品后，用户才能购买。未上架商品不接受支付。</p></div><span class="badge">会员 · 积分 · 套餐</span></div><p class="payment-catalog-note">会员、积分和套餐均为单次购买，不自动扣费。上架前须确认服务已接通且开启按权益计费；会员与套餐按本次有效期发放总次数。付款成功按订单快照发放，商品修改不影响已创建订单。</p>${paymentCatalog(catalog)}</section><section class="payment-help"><h2>配置与上线说明</h2><ol><li>在微信支付、支付宝的商户平台申请并开通对应的网站支付能力。</li><li>填写当前应用的签名与验签参数，保存后检查配置，再启用渠道。</li><li>确认售价、会员或套餐有效期、积分数量或套餐服务项及可交付权益后，再上架商品。</li><li>正式开放前完成一笔受控真实交易，核对支付平台记录、通知结果及网站订单状态。</li></ol><p>密钥仅提交到本站服务端。不要放入反馈、截图或聊天记录中。</p><div class="payment-help-links"><a href="https://pay.weixin.qq.com/" target="_blank" rel="noopener noreferrer">微信支付商户平台 ↗</a><a href="https://open.alipay.com/" target="_blank" rel="noopener noreferrer">支付宝开放平台 ↗</a></div></section>`;
  }
  const paymentForms = () => [...doc.querySelectorAll('#admin-content form[data-payment-provider], #admin-content form[data-payment-product], #admin-content form[data-billing-form], #admin-content form[data-tool-billing-form]')];
  const paymentFormKey = form => form.hasAttribute('data-tool-billing-form')?'tool-billing':form.hasAttribute('data-billing-form') ? 'billing' : form.dataset.paymentProvider || 'product:' + form.dataset.paymentProduct;
  function paymentFingerprint(form) { return JSON.stringify([...form.querySelectorAll('[name]')].map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value])); }
  function rememberPaymentForms() { paymentBaselines.clear(); for (const form of paymentForms()) paymentBaselines.set(paymentFormKey(form), paymentFingerprint(form)); }
  function formIsDirty(form) { return paymentBaselines.get(paymentFormKey(form)) !== paymentFingerprint(form); }
  function paymentsHaveWork() { return authorized && currentView === 'payments' && (pendingPayments.size > 0 || paymentForms().some(formIsDirty)); }
  function refreshPaymentDirty(form) { const dirty = formIsDirty(form); const note = form.querySelector('.payment-dirty'); if (note) note.hidden = !dirty; const check = form.querySelector('[data-payment-check]'); if (check) check.disabled = dirty || pendingPayments.has(paymentFormKey(form)); }
  function guardPayments(action) {
    if (agentHasWork()) { if (agentPending) { toast('Agent 配置正在保存或测试，请等待完成。'); return; } openDialog('Agent 配置尚未保存', '<p class="dialog-copy">离开将丢弃未保存的 Agent 配置。</p><div class="dialog-actions"><button class="button" data-dialog-close>继续编辑</button><button class="button danger-solid" id="discard-agent-changes">放弃修改并离开</button></div>'); $('#discard-agent-changes').onclick = () => { agentBaseline = agentFingerprint(); closeDialog(); action(); }; return; }
    if (!paymentsHaveWork()) { action(); return; }
    if (pendingPayments.size) { toast('正在保存支付配置，请等待完成后再离开。'); return; }
    openDialog('支付配置尚未保存', '<p class="dialog-copy">离开将丢弃当前未保存的服务计价、渠道或商品修改。已保存的配置不受影响。</p><div class="dialog-actions"><button class="button" data-dialog-close>继续编辑</button><button class="button danger-solid" id="discard-payment-changes">放弃修改并离开</button></div>');
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
      if (quiet && (doc.activeElement?.closest('#search-form, #model-form, #monitoring-form') || $('#monitoring-form')?.dataset.dirty === 'true' || $('#admin-dialog').open || paymentsHaveWork())) return;
      if (query && Number.isInteger(data.page) && data.page > 0) query.page = data.page;
      if (query && query.page > Math.max(1, Math.ceil((Number(data.total) || 0) / query.pageSize))) { query.page = Math.max(1, Math.ceil((Number(data.total) || 0) / query.pageSize)); await loadView(view); return; }
      currentData = data; loadedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      $('#admin-content').innerHTML = heading(view) + (view === 'overview' ? overviewPage(data) : view === 'monitoring' ? monitoringPage(data) : view === 'settings' ? settingsPage(data) + agentSettingsPanel(data.agent) : view === 'payments' ? paymentsPage(data) : listPage(view, data));
      if (view === 'payments') rememberPaymentForms();
      if (view === 'settings') agentBaseline = agentFingerprint();
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
    if (agentHasWork()) { guardPayments(() => saveSettings(event)); return; }
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
    const control = doc.querySelector(`[data-channel-control="${provider}"]`);
    if (control) control.outerHTML = paymentChannelControl(provider, channel, currentData.encryptionReady === true);
    const form = $(`#payment-${provider}`);
    paymentBaselines.set(provider, paymentFingerprint(form));
    syncPaymentAvailability();
  }
  function syncPaymentChannelControl(provider) {
    const input = $(`#${provider}-enabled`), channel = currentData?.channels?.find(item => item.provider === provider) || {};
    if (input) input.disabled = currentData?.encryptionReady !== true || (!channel.enabled && channel.configured !== true) || pendingPayments.has(provider);
  }
  async function togglePaymentChannel(input) {
    const provider = input.dataset.paymentToggle, desired = input.checked, channel = currentData?.channels?.find(item => item.provider === provider) || {}, previous = channel.enabled === true;
    const form = $(`#payment-${provider}`), message = $(`#${provider}-switch-message`), ticket = generation;
    if (!authorized || currentView !== 'payments' || !paymentProviders[provider] || !currentData || !form || pendingPayments.has(provider)) { input.checked = previous; return; }
    const block = currentData.encryptionReady !== true ? '服务端加密配置尚未就绪，暂不能切换渠道。' : formIsDirty(form) ? '此渠道有未保存的参数，请先保存下方修改，再切换支付开关。' : desired && channel.configured !== true ? '请先完善并保存商户参数，配置完整后才可启用。' : '';
    if (block) { input.checked = previous; message.textContent = block; message.classList.add('is-error'); message.hidden = false; toast(block); return; }
    if (desired === previous) return;
    pendingPayments.add(provider); syncPaymentChannelControl(provider); for (const field of form.elements) field.disabled = true;
    message.textContent = '正在保存支付开关…'; message.classList.remove('is-error'); message.hidden = false;
    try {
      const result = await request('/admin/payments/' + provider, { enabled: desired });
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      if (!result || result.enabled !== desired) throw new Error('渠道返回状态不完整，请刷新后核对启用结果。');
      updatePaymentChannel(provider, { ...channel, ...result, provider });
      const liveMessage = $(`#${provider}-switch-message`); liveMessage.textContent = desired ? `${paymentProviders[provider].title}已启用，收银台将按配置状态展示。` : `${paymentProviders[provider].title}已关闭，商户参数与密钥已保留。`; liveMessage.hidden = false;
      toast(desired ? '支付渠道已启用。' : '支付渠道已关闭，参数与密钥已保留。');
    } catch (error) {
      if (authorized && ticket === generation && currentView === 'payments') { input.checked = previous; message.textContent = error.message; message.classList.add('is-error'); message.hidden = false; }
    } finally {
      pendingPayments.delete(provider);
      if (authorized && ticket === generation && currentView === 'payments') { for (const field of form.elements) field.disabled = false; syncPaymentChannelControl(provider); const live = $(`#payment-${provider}`); if (live) refreshPaymentDirty(live); }
    }
  }
  async function savePaymentChannel(event) {
    event.preventDefault(); const form = event.target, provider = form.dataset.paymentProvider;
    if (!authorized || currentView !== 'payments' || !paymentProviders[provider] || !currentData || pendingPayments.has(provider)) return;
    const errorNode = $(`#${provider}-error`), button = form.querySelector('[type="submit"]'), ticket = generation;
    errorNode.hidden = true;
    if (currentData.encryptionReady !== true) { errorNode.textContent = '服务端尚未准备好支付配置加密，暂不能保存。'; errorNode.hidden = false; return; }
    const payload = { enabled: currentData.channels?.find(channel => channel.provider === provider)?.enabled === true }, clears = [];
    for (const [key] of paymentProviders[provider].fields) payload[key] = form.elements[key].value.trim();
    for (const [key] of paymentProviders[provider].secrets) {
      if (form.elements['clear-' + key]?.checked) clears.push(key);
      else if (form.elements[key].value.trim()) payload[key] = form.elements[key].value.trim();
    }
    if (clears.length) payload.clearSecrets = clears;
    pendingPayments.add(provider); syncPaymentChannelControl(provider); for (const field of form.elements) field.disabled = true; button.textContent = '正在保存…'; refreshPaymentDirty(form);
    try {
      const result = await request('/admin/payments/' + provider, payload);
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      updatePaymentChannel(provider, { ...result, provider }); toast('渠道配置已保存。可检查配置完整性后核对真实交易。');
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(provider); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; syncPaymentChannelControl(provider); button.textContent = '保存渠道配置'; const live = $(`#payment-${provider}`); if (live) refreshPaymentDirty(live); } }
  }
  async function checkPaymentChannel(provider) {
    const form = $(`#payment-${provider}`);
    if (!authorized || currentView !== 'payments' || !form || pendingPayments.has(provider)) return;
    if (formIsDirty(form)) { toast('请先保存修改，再检查已保存的配置。'); return; }
    const button = form.querySelector('[data-payment-check]'), errorNode = $(`#${provider}-error`), ticket = generation;
    pendingPayments.add(provider); syncPaymentChannelControl(provider); for (const field of form.elements) field.disabled = true; button.textContent = '正在检查…'; errorNode.hidden = true;
    try {
      const result = await request('/admin/payments/' + provider + '/check', {});
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      const previous = currentData.channels?.find(channel => channel.provider === provider) || {};
      updatePaymentChannel(provider, { ...previous, ...result, provider });
      const node = $(`#${provider}-check-result`); node.hidden = false; node.classList.toggle('passed', result.ok === true); node.textContent = result.ok === true ? '本地配置检查通过，尚未进行真实支付验证。' : '本地配置检查未通过，请按提示完善后重新保存。';
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(provider); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; syncPaymentChannelControl(provider); const live = $(`#payment-${provider}`); if (live) refreshPaymentDirty(live); button.textContent = '检查已保存配置'; } }
  }
  async function savePaymentProduct(event) {
    event.preventDefault(); const form = event.target, id = form.dataset.paymentProduct, key = 'product:' + id, ticket = generation;
    if (!authorized || currentView !== 'payments' || !currentData || pendingPayments.has(key)) return;
    const errorNode = form.querySelector('.form-error'), button = form.querySelector('[type="submit"]'); errorNode.hidden = true;
    const product = currentData.catalog.find(item => item.id === id), type = productType(product), credits = type === 'credits', bundle = type === 'bundle';
    const rawPrice = form.elements.price.value.trim(), amount = rawPrice ? priceCents(rawPrice) : null;
    const rawQuantity = (credits ? form.elements.creditAmount : form.elements.durationDays)?.value.trim() || '';
    const quantity = /^[1-9]\d{0,6}$/.test(rawQuantity) && Number(rawQuantity) <= (credits ? 1_000_000 : 366) ? Number(rawQuantity) : null;
    const prefix = bundle ? 'bundle' : 'membership';
    const entries = !credits ? [...form.querySelectorAll(`[data-${prefix}-row]`)].map(row => ({ key: row.querySelector(`[name="${prefix}Key"]`).value.trim(), title: row.querySelector(`[name="${prefix}Title"]`).value.trim(), rawQuantity: row.querySelector(`[name="${prefix}Quantity"]`).value.trim() })).filter(entry => entry.key || entry.title || entry.rawQuantity) : [];
    const serviceItems = entries.map(entry => ({ key: entry.key, title: entry.title, quantity: /^[1-9]\d{0,5}$/.test(entry.rawQuantity) ? Number(entry.rawQuantity) : null }));
    const invalidItems = !credits && (entries.length > 20 ? '最多包含 20 个服务项。' : serviceItems.some(entry => !/^[a-z][a-z0-9-]{0,63}$/.test(entry.key)) ? '请选择有效的可交付服务。' : new Set(serviceItems.map(entry => entry.key)).size !== serviceItems.length ? '服务标识不能重复。' : serviceItems.some(entry => !entry.title || entry.title.length > 80) ? '每个服务项需填写 1–80 个字符的名称。' : serviceItems.some(entry => !entry.quantity || entry.quantity > 100000) ? '服务次数需为 1–100000 的整数。' : '');
    const payload = { title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), status: form.elements.status.value, priceCents: amount, durationDays: credits ? null : quantity, ...(credits ? { entitlementType: 'credits', creditAmount: quantity } : bundle ? { entitlementType: 'bundle', bundleItems: serviceItems } : { membershipItems: serviceItems }) };
    const deliverable = key => {const entry=billingRule(key);return entry?.mode==='paid'&&entry.available===true;};
    const periodLabel = credits ? '积分数量' : bundle ? '套餐有效期' : '会员有效期';
    const invalid = !product ? '商品信息已失效，请刷新后重试。' : !payload.title ? '请填写商品名称。' : payload.title.length > 80 || payload.description.length > 1000 ? '商品名称最多 80 个字符，权益说明最多 1000 个字符。' : rawPrice && amount === null ? '请输入大于 0 的售价，最多保留两位小数。' : rawQuantity && quantity === null ? (credits ? '积分数量需为 1–1000000 的整数。' : `${periodLabel}需为 1–366 的整数天。`) : invalidItems || (payload.status === 'active' && (!amount || !quantity || !payload.description) ? `上架前请填写售价、${periodLabel}和实际可交付权益。` : payload.status === 'active' && !credits && !serviceItems.length ? '上架前请至少配置一个可交付服务项。' : payload.status === 'active' && (credits ? !allBillableServices().some(entry => deliverable(entry.key)) : serviceItems.some(entry => !deliverable(entry.key))) ? '上架前请确认所选服务已接通且开启按权益计费。' : '');
    if (invalid) { errorNode.textContent = invalid; errorNode.hidden = false; return; }
    pendingPayments.add(key); for (const field of form.elements) field.disabled = true; button.textContent = '正在保存…';
    try {
      const result = await request('/admin/payments/products/' + encodeURIComponent(id), payload);
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      const item = result.item;
      if (!item || item.id !== id) throw new Error('商品返回数据不完整，请刷新后核对保存结果。');
      const index = currentData.catalog.findIndex(product => product.id === id); if (index >= 0) currentData.catalog[index] = item;
      const holder = doc.createElement('div'); holder.innerHTML = paymentProduct(item); const replacement = holder.firstElementChild; form.replaceWith(replacement); paymentBaselines.set(key, paymentFingerprint(replacement)); syncPaymentAvailability(); toast(item.status === 'active' ? '商品已保存并上架，请核对交付权益。' : '商品已保存，当前未上架。');
    } catch (error) { if (authorized && ticket === generation) { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete(key); if (authorized && ticket === generation) { for (const field of form.elements) field.disabled = false; const add = form.querySelector('[data-bundle-add], [data-membership-add]'); if (add) add.disabled = form.querySelectorAll('[data-bundle-row], [data-membership-row]').length >= 20; button.textContent = '保存商品'; } }
  }
  function editBundleItems(button) {
    const form = button.closest('form[data-payment-product]'), id = form?.dataset.paymentProduct;
    const type = productType(currentData?.catalog?.find(item => item.id === id)), membership = type === 'membership', prefix = membership ? 'membership' : 'bundle';
    if (!form || currentView !== 'payments' || !['membership', 'bundle'].includes(type) || pendingPayments.has('product:' + id)) return;
    const list = form.querySelector('.payment-bundle-items');
    if (button.hasAttribute(`data-${prefix}-remove`)) button.closest(`[data-${prefix}-row]`)?.remove();
    else {
      const rows = [...list.querySelectorAll(`[data-${prefix}-row]`)];
      if (rows.length >= 20) return;
      const index = rows.reduce((max, row) => Math.max(max, Number(row.dataset[membership ? 'membershipRow' : 'bundleRow'])), -1) + 1;
      list.insertAdjacentHTML('beforeend', serviceItemRow(id, index, {}, membership));
      list.lastElementChild.querySelector('select')?.focus();
    }
    form.querySelector(`[data-${prefix}-add]`).disabled = list.children.length >= 20;
    refreshPaymentDirty(form);
  }
  function updateBillingCost(form) {
    for (const service of billableServices) {
      const mode = form.elements[service.key + 'Mode'], cost = form.elements[service.key + 'Cost'];
      if (mode && cost) cost.disabled = mode.value !== 'paid' || pendingPayments.has('billing');
    }
  }
  async function saveBilling(event) {
    event.preventDefault(); const form = event.target, ticket = generation;
    if (!authorized || currentView !== 'payments' || pendingPayments.has('billing')) return;
    const errorNode = form.querySelector('.form-error'), button = form.querySelector('[type="submit"]'); errorNode.hidden = true;
    if (currentData?.billing?.version === undefined || currentData.billing.version === null) { errorNode.textContent = '计价信息未取得，请刷新后重试。'; errorNode.hidden = false; return; }
    const services = billableServices.map(service => ({ key: service.key, mode: form.elements[service.key + 'Mode']?.value, creditCost: form.elements[service.key + 'Mode']?.value === 'paid' ? (/^[1-9]\d{0,6}$/.test(form.elements[service.key + 'Cost']?.value.trim() || '') ? Number(form.elements[service.key + 'Cost'].value.trim()) : null) : null }));
    if (services.some(service => !Object.hasOwn(billingModes, service.mode) || service.mode === 'paid' && (!Number.isSafeInteger(service.creditCost) || service.creditCost < 1 || service.creditCost > 100000))) { errorNode.textContent = '付费服务每次积分需为 1–100000 的整数。'; errorNode.hidden = false; return; }
    pendingPayments.add('billing'); for (const field of form.elements) field.disabled = true; button.textContent = '正在保存…';
    try {
      const result = await request('/admin/billing', { version: currentData.billing.version, services });
      if (!authorized || ticket !== generation || currentView !== 'payments') return;
      if (result?.billing?.version === undefined || !billableServices.every(service => result.billing.services?.some(item => item.key === service.key && Object.hasOwn(billingModes, item.mode)))) throw new Error('服务计价返回信息不完整，请刷新后核对保存结果。');
      currentData.billing = result.billing;if(result.toolBilling)currentData.toolBilling=result.toolBilling;updateToolBillingCost($('#tool-billing-form'));
      syncPaymentAvailability(result.catalog);
      const holder = doc.createElement('div'); holder.innerHTML = billingPage(result.billing); const replacement = holder.firstElementChild; form.closest('.billing-panel').replaceWith(replacement);
      paymentBaselines.set('billing', paymentFingerprint(replacement.querySelector('form'))); toast('服务计价已保存，仅对后续新任务生效。请核对相关商品的上架条件。');
    } catch (error) { if (authorized && ticket === generation && currentView === 'payments') { errorNode.textContent = error.message; errorNode.hidden = false; } }
    finally { pendingPayments.delete('billing'); if (authorized && ticket === generation && currentView === 'payments') { const live = $('#billing-form'); for (const field of live.elements) field.disabled = false; live.querySelector('[type="submit"]').textContent = '保存服务计价'; updateBillingCost(live); refreshPaymentDirty(live); } }
  }
  function updateToolBillingCost(form){if(!form)return;const parent=currentData?.billing?.services?.find(s=>s.key==='agent');for(const {key}of toolBillingServiceTypes){const mode=form.elements[key+'Mode'],cost=form.elements[key+'Cost'];if(!mode||!cost)continue;cost.disabled=mode.value!=='paid'||pendingPayments.has('tool-billing');const effective=mode.value==='inherit'?parent?.mode:mode.value,amount=mode.value==='inherit'?parent?.creditCost:cost.value.trim(),label=form.querySelector('[data-tool-effective="'+key+'"]');if(label)label.textContent=effective==='paid'?(amount||'待填写')+' 积分 / 次':effective==='free'?'当前免费':effective==='disabled'?'当前暂停':'请刷新规则';}}
  async function saveToolBilling(event){
   event.preventDefault();const form=event.target,ticket=generation,key='tool-billing';if(!authorized||currentView!=='payments'||pendingPayments.has(key))return;const errorNode=form.querySelector('.form-error');errorNode.hidden=true;let payload;try{payload=toolBillingPayload(form,currentData?.toolBilling?.version);}catch(error){errorNode.textContent=error.message;errorNode.hidden=false;return;}
   pendingPayments.add(key);for(const field of form.elements)field.disabled=true;form.querySelector('[type="submit"]').textContent='正在保存…';
   try{const result=await request('/admin/tool-billing',payload);if(!authorized||ticket!==generation||currentView!=='payments')return;if(!toolBillingRulesValid(result.toolBilling))throw Error('科研工具计价返回信息不完整，请刷新后核对。');currentData.toolBilling=result.toolBilling;syncPaymentAvailability(result.catalog);const holder=doc.createElement('div');holder.innerHTML=toolBillingPage(result.toolBilling);const replacement=holder.firstElementChild;form.closest('.tool-billing-panel').replaceWith(replacement);paymentBaselines.set(key,paymentFingerprint(replacement.querySelector('form')));toast('科研工具计价已保存，仅对后续新任务生效。');}
   catch(error){if(authorized&&ticket===generation&&currentView==='payments'){errorNode.textContent=error.message;errorNode.hidden=false;}}
   finally{pendingPayments.delete(key);if(authorized&&ticket===generation&&currentView==='payments'){const live=$('#tool-billing-form');if(live){for(const field of live.elements)field.disabled=false;live.querySelector('[type="submit"]').textContent='保存科研工具计费';updateToolBillingCost(live);refreshPaymentDirty(live);}}}
  }
  async function saveMonitoring(event) {
    event.preventDefault();const form=event.target,ticket=generation;
    if(!authorized||currentView!=='monitoring'||form.dataset.saving==='true')return;
    const errorNode=form.querySelector('.form-error');errorNode.hidden=true;
    let payload;try{payload=monitoringSettingsPayload(form,currentData?.settings?.version);}catch(error){errorNode.textContent=error.message;errorNode.hidden=false;return;}
    form.dataset.saving='true';for(const field of form.elements)field.disabled=true;
    try{await request('/admin/monitoring/settings',payload);if(authorized&&ticket===generation){toast('监控配置已保存，自动采样按新设置运行。');await loadView('monitoring');}}
    catch(error){if(authorized&&ticket===generation){errorNode.textContent=error.message;errorNode.hidden=false;}}
    finally{form.dataset.saving='false';for(const field of form.elements)field.disabled=false;}
  }
  async function sampleMonitoring() {
    const button=$('#monitor-sample'),ticket=generation;if(!authorized||currentView!=='monitoring'||!button||button.disabled)return;
    button.disabled=true;button.textContent='正在采样…';
    try{await request('/admin/monitoring/sample',{});if(authorized&&ticket===generation){toast('采样已完成，请核对采样时间和告警。');await loadView('monitoring');}}
    catch(error){if(authorized&&ticket===generation)toast(error.message);}
    finally{if(button.isConnected){button.disabled=false;button.textContent='立即采样';}}
  }
  $('#admin-content').addEventListener('input',event=>{const form=event.target.closest('#monitoring-form');if(form){form.dataset.dirty='true';form.querySelector('[data-monitor-dirty]').hidden=false;}});
  $('#admin-content').addEventListener('change',event=>{const form=event.target.closest('#monitoring-form');if(form){form.dataset.dirty='true';form.querySelector('[data-monitor-dirty]').hidden=false;}});
  $('#admin-app').addEventListener('click', event => {
    const link = event.target.closest('[data-view]');
    if (link) { event.preventDefault(); navigateView(link.dataset.view); return; }
    if (!authorized) return;
    if (event.target.closest('#refresh-view, #retry-view')) { guardPayments(() => loadView()); return; }
    if (event.target.closest('#test-agent-connection')) { testAgentSettings(); return; }
    if (event.target.closest('#monitor-sample')) { void sampleMonitoring(); return; }
    const paymentCheck = event.target.closest('[data-payment-check]'); if (paymentCheck) { checkPaymentChannel(paymentCheck.dataset.paymentCheck); return; }
    const paymentConfigure = event.target.closest('[data-payment-configure]'); if (paymentConfigure) { const field = $(`#${paymentConfigure.dataset.paymentConfigure}-appId`); field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); field?.focus({ preventScroll: true }); return; }
    const bundleEdit = event.target.closest('[data-bundle-add], [data-bundle-remove], [data-membership-add], [data-membership-remove]'); if (bundleEdit) { editBundleItems(bundleEdit); return; }
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
    if (event.target.id === 'agent-settings-form') saveAgentSettings(event);
    if (event.target.id === 'monitoring-form') void saveMonitoring(event);
    if (event.target.matches('form[data-payment-provider]')) savePaymentChannel(event);
    if (event.target.matches('form[data-payment-product]')) savePaymentProduct(event);
    if (event.target.matches('form[data-billing-form]')) saveBilling(event);
    if (event.target.matches('form[data-tool-billing-form]')) saveToolBilling(event);
  });
  for (const name of ['input', 'change']) $('#admin-content').addEventListener(name, event => { if (event.target.closest('#agent-settings-form')) { const dirty = agentHasWork(); $('[data-agent-dirty]').hidden = !dirty; $('#test-agent-connection').disabled = dirty || !currentData?.agent?.version || !currentData?.agent?.configured; } const form = event.target.closest('form[data-payment-provider], form[data-payment-product], form[data-billing-form], form[data-tool-billing-form]'); if (form) refreshPaymentDirty(form); });
  $('#admin-content').addEventListener('change', event => { if (event.target.matches('[data-payment-toggle]')) void togglePaymentChannel(event.target); if(event.target.matches('[data-tool-billing-mode]')||event.target.closest('form[data-tool-billing-form]'))updateToolBillingCost(event.target.closest('form')); if (event.target.matches('[data-billing-mode]')) updateBillingCost(event.target.closest('form')); if (event.target.matches('[name="bundleKey"], [name="membershipKey"]')) { const prefix = event.target.name === 'bundleKey' ? 'bundle' : 'membership', row = event.target.closest(`[data-${prefix}-row]`), title = row?.querySelector(`[name="${prefix}Title"]`); if (title && !title.value.trim()) title.value = allBillableServices().find(service => service.key === event.target.value)?.title || ''; if (row) refreshPaymentDirty(event.target.closest('form')); } });
  $('#menu-toggle').onclick = () => { const open = $('#admin-app').classList.toggle('nav-open'); $('#sidebar-backdrop').hidden = !open; $('#menu-toggle').setAttribute('aria-expanded', String(open)); };
  $('#sidebar-backdrop').onclick = closeMenu;
  $('#dialog-close').onclick = closeDialog;
  $('#admin-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  $('#dialog-body').addEventListener('click', event => { if (event.target.closest('[data-dialog-close]')) closeDialog(); });
  $('#logout').onclick = () => { if (!authorized) return; guardPayments(async () => { $('#logout').disabled = true; try { await request('/auth/logout', {}); deny(401, '你已退出登录。'); } catch (error) { if (authorized) toast(error.message); } finally { $('#logout').disabled = false; } }); };
  function historyNavigation() { if (!authorized || currentView === route()) return; const target = route(); if (paymentsHaveWork()) win.history.replaceState(null, '', '#' + currentView); guardPayments(() => { closeDialog(); closeMenu(); win.history.replaceState(null, '', '#' + target); loadView(target); }); }
  win.addEventListener('popstate', historyNavigation);
  win.addEventListener('hashchange', historyNavigation);
  win.addEventListener('beforeunload', event => { if (paymentsHaveWork() || agentHasWork()) { event.preventDefault(); event.returnValue = ''; } });
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
      if (authorized) polling = win.setInterval(() => { if (authorized && !doc.hidden && ['overview', 'jobs', 'monitoring'].includes(currentView) && !$('#admin-dialog').open && !doc.activeElement?.closest('#search-form, #monitoring-form') && $('#monitoring-form')?.dataset.dirty !== 'true') loadView(currentView, { quiet: true }); }, pollIntervalMs);
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
