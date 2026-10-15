import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createAdminPage } from '../dist/admin.mjs';

const html = await readFile(new URL('../dist/admin.html', import.meta.url), 'utf8');
const account = { user: { id: 'admin-1', name: '管理测试', phone: '13800138000', email: null, role: 'admin' } };
const overview = { metrics: { users: 8, projects: 3, files: 4, storageBytes: 2048, jobs: 20, queued: 2, running: 1, failed: 2, completed: 15, results: 15, feedbackOpen: 3, orders: 0 }, recentJobs: [], daily: [{ date: '2026-10-14', users: 2, jobs: 7 }, { date: '2026-10-15', users: 1, jobs: 3 }], services: { ai: true, email: true, sms: false, payment: false, storage: 'local_server_sqlite' } };
const settings = { ai: { provider: 'test-provider', model: 'test-model', configured: true, enabled: true, ready: true }, auth: { emailCode: true, phoneCode: false }, storage: { provider: 'local_server_sqlite' }, payment: false };
const user = { id: 'user-1', name: '手机用户', email: null, phone: '13800138000', role: 'user', created_at: '2026-10-14T10:00:00.000Z', phone_verified_at: '2026-10-14T10:00:00.000Z', project_count: 2, job_count: 3 };
const job = { id: 'job-1', user_id: user.id, user_name: user.name, user_phone: user.phone, user_email: null, type: 'polish', status: 'queued', stage: 'queued', attempt: 0, created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z' };
const feedback = { id: 'feedback-1', user_name: user.name, user_phone: user.phone, category: '功能建议', body: '希望增加研究分类', status: 'open', note: '', created_at: '2026-10-15T10:00:00.000Z' };
const list = (items = [], total = items.length, page = 1) => ({ items, total, page, pageSize: 20 });
async function settle(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('UI did not settle'); }
async function page(t, { hash = '', role = 'admin', guest = false, handle, requestTimeoutMs, wait = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://paperknow.cn/admin.html' + hash, pretendToBeVisual: true });
  const win = dom.window, calls = [], navigations = [];
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; };
  win.fetch = async (url, init = {}) => {
    const payload = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method || 'GET', payload });
    let response = await handle?.(url, payload, init);
    if (!response) {
      if (url === '/api/auth/me') response = guest ? { status: 401, body: { error: '未登录' } } : { body: { user: { ...account.user, role } } };
      else if (url === '/api/admin/overview') response = { body: overview };
      else if (url === '/api/admin/settings') response = { body: settings };
      else if (payload !== undefined) response = { body: { ok: true } };
      else response = { body: list() };
    }
    const status = response.status || 200;
    return { ok: status >= 200 && status < 300, status, json: async () => response.body };
  };
  const app = createAdminPage(win.document, { navigate: url => navigations.push(url), requestTimeoutMs, pollIntervalMs: 60_000 });
  t.after(() => { app.destroy(); win.close(); });
  if (wait) await app.ready;
  const $ = selector => win.document.querySelector(selector);
  const fill = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const click = selector => $(selector).click();
  const submit = selector => $(selector).dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
  return { app, $, win, fill, click, submit, calls, navigations };
}

test('guests are sent to sign-in without fetching any administration data', async t => {
  const ui = await page(t, { guest: true });
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].url, '/api/auth/me');
  assert.equal(ui.$('#admin-app').hidden, true);
  assert.equal(ui.$('#admin-content').textContent, '');
  assert.deepEqual(ui.navigations, ['/auth.html?mode=login&next=%2Fadmin.html']);
});

test('a normal account receives an access-denied page without fetching admin APIs', async t => {
  const ui = await page(t, { role: 'user', hash: '#users' });
  assert.equal(ui.calls.length, 1);
  assert.match(ui.$('#access-title').textContent, /没有管理权限/);
  assert.equal(ui.$('#admin-app').hidden, true);
  assert.equal(ui.$('#admin-navigation').textContent, '');
  assert.equal(ui.navigations.length, 0);
});

test('administrator sees real metrics and service states only after role verification', async t => {
  let finishAuth;
  const ui = await page(t, { wait: false, handle: url => url === '/api/auth/me' ? new Promise(resolve => { finishAuth = resolve; }) : undefined });
  assert.equal(ui.$('#admin-app').hidden, true);
  assert.equal(ui.calls.length, 1);
  finishAuth({ body: account }); await ui.app.ready;
  assert.equal(ui.$('#admin-app').hidden, false);
  assert.equal(ui.$('#admin-name').textContent, '管理测试');
  assert.deepEqual([...ui.win.document.querySelectorAll('.metric-number')].map(el => el.textContent), ['8', '20', '15', '3']);
  assert.match(ui.$('#admin-content').textContent, /2 KB/);
  assert.match(ui.$('[role="img"]').getAttribute('aria-label'), /2026-10-14：新增用户 2，任务 7/);
  assert.equal(ui.win.document.querySelectorAll('.admin-nav-link').length, 10);
});

test('lists support search, status filtering, pagination and reset while preserving phone-only identity', async t => {
  const ui = await page(t, { hash: '#users', handle: url => url.startsWith('/api/admin/users?') ? { body: list([user], 45, Number(new URL(url, 'https://paperknow.cn').searchParams.get('page'))) } : undefined });
  assert.match(ui.$('tbody').textContent, /13800138000/);
  assert.doesNotMatch(ui.$('tbody').textContent, /null/);
  ui.click('#next-page'); await settle(() => ui.$('.pagination-buttons span')?.textContent === '2 / 3');
  assert.match(ui.calls.at(-1).url, /page=2/);
  ui.fill('#admin-search', '手机用户'); ui.$('#status-filter').value = 'user'; ui.submit('#search-form');
  await settle(() => ui.$('.pagination-buttons span')?.textContent === '1 / 3');
  const request = new URL(ui.calls.at(-1).url, 'https://paperknow.cn');
  assert.equal(request.searchParams.get('q'), '手机用户'); assert.equal(request.searchParams.get('status'), 'user');
  ui.click('#reset-search'); await settle(() => ui.$('#admin-search')?.value === '' && !ui.$('#reset-search'));
  assert.equal(new URL(ui.calls.at(-1).url, 'https://paperknow.cn').searchParams.has('q'), false);
});

test('tasks can only be cancelled after confirming and no retry action is offered', async t => {
  let cancelled = false;
  const ui = await page(t, { hash: '#jobs', handle: (url, payload) => {
    if (url.startsWith('/api/admin/jobs?')) return { body: list([{ ...job, status: cancelled ? 'cancelled' : 'queued' }]) };
    if (url === '/api/admin/jobs/job-1/cancel') { cancelled = true; return { body: { ok: true } }; }
  } });
  ui.click('[data-cancel]');
  assert.equal(ui.$('#admin-dialog').open, true);
  assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  ui.click('[data-dialog-close]'); assert.equal(ui.$('#admin-dialog').open, false);
  ui.click('[data-cancel]'); ui.click('#confirm-cancel');
  await settle(() => cancelled && ui.$('tbody')?.textContent.includes('已取消'));
  assert.deepEqual(ui.calls.find(call => call.method === 'POST'), { url: '/api/admin/jobs/job-1/cancel', method: 'POST', payload: {} });
  assert.equal(ui.$('[data-cancel]'), null);
  assert.doesNotMatch(ui.$('#admin-content').textContent, /重试任务/);
});

test('feedback editing sends status and note, refreshes list and never sends a message', async t => {
  let saved;
  const ui = await page(t, { hash: '#feedback', handle: (url, payload) => {
    if (url.startsWith('/api/admin/feedback?')) return { body: list([{ ...feedback, ...saved }]) };
    if (url === '/api/admin/feedback/feedback-1') { saved = payload; return { body: { ok: true } }; }
  } });
  ui.click('[data-feedback]');
  assert.match(ui.$('#dialog-body').textContent, /不会自动发送邮件或短信/);
  ui.$('#feedback-status').value = 'resolved'; ui.fill('#feedback-note', '已提供操作说明。'); ui.submit('#feedback-form');
  await settle(() => saved && ui.$('tbody')?.textContent.includes('已解决'));
  assert.deepEqual(saved, { status: 'resolved', note: '已提供操作说明。' });
  assert.equal(ui.$('#admin-dialog').open, false);
  assert.match(ui.$('#admin-toast').textContent, /已保存/);
});

test('model settings validate input and save exactly model and enabled fields', async t => {
  let saved;
  const ui = await page(t, { hash: '#settings', handle: (url, payload) => {
    if (url === '/api/admin/settings') return { body: { ...settings, ai: { ...settings.ai, ...saved } } };
    if (url === '/api/admin/model') { saved = payload; return { body: { ai: saved } }; }
  } });
  ui.fill('#model-name', 'bad model'); ui.submit('#model-form');
  assert.match(ui.$('#model-error').textContent, /有效的模型名称/);
  assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  ui.fill('#model-name', 'model-v2'); ui.$('#model-enabled').checked = false; ui.submit('#model-form');
  await settle(() => ui.$('#save-model')?.disabled === false && saved);
  assert.deepEqual(saved, { model: 'model-v2', enabled: false });
  assert.equal(ui.$('#model-name').value, 'model-v2');
  assert.equal(ui.win.document.querySelector('input[type=password]'), null);
});

test('server errors preserve feedback editing and leave the save button usable', async t => {
  const ui = await page(t, { hash: '#feedback', handle: (url, payload) => url.startsWith('/api/admin/feedback?') ? { body: list([feedback]) } : url === '/api/admin/feedback/feedback-1' ? { status: 409, body: { error: '该记录暂时无法保存。' } } : undefined });
  ui.click('[data-feedback]'); ui.fill('#feedback-note', '尚未保存的处理记录'); ui.submit('#feedback-form');
  await settle(() => ui.$('#feedback-error')?.textContent.includes('无法保存'));
  assert.equal(ui.$('#feedback-note').value, '尚未保存的处理记录');
  assert.equal(ui.$('#save-feedback').disabled, false);
  assert.equal(ui.$('#admin-dialog').open, true);
});

test('a 403 clears loaded private data, closes dialogs and ignores late responses', async t => {
  let delayed;
  const ui = await page(t, { hash: '#users', handle: url => {
    if (url.startsWith('/api/admin/users?')) return { body: list([user]) };
    if (url.startsWith('/api/admin/jobs?')) return new Promise(resolve => { delayed = resolve; });
    if (url.startsWith('/api/admin/results?')) return { status: 403, body: { error: '管理权限已变更' } };
  } });
  ui.click('[data-detail]'); assert.equal(ui.$('#admin-dialog').open, true);
  ui.click('[data-view="jobs"]'); await settle(() => delayed);
  ui.click('[data-view="results"]'); await settle(() => !ui.$('#access-gate').hidden);
  delayed({ body: list([job]) }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.$('#admin-content').textContent, ''); assert.equal(ui.$('#admin-name').textContent, '');
  assert.equal(ui.$('#dialog-body').textContent, ''); assert.equal(ui.$('#admin-dialog').open, false);
  assert.equal(ui.$('#admin-app').hidden, true); assert.equal(ui.navigations.length, 0);
});

test('a 401 during a refresh removes admin content and redirects to sign-in', async t => {
  let count = 0;
  const ui = await page(t, { handle: url => url === '/api/admin/overview' ? ++count === 1 ? { body: overview } : { status: 401, body: { error: '登录已过期' } } : undefined });
  ui.click('#refresh-view'); await settle(() => ui.navigations.length === 1);
  assert.equal(ui.$('#admin-content').textContent, '');
  assert.equal(ui.$('#admin-navigation').textContent, '');
  assert.equal(ui.navigations[0], '/auth.html?mode=login&next=%2Fadmin.html');
});

test('switching views prevents a slow response from overwriting the newer page', async t => {
  let finishJobs;
  const ui = await page(t, { handle: url => {
    if (url.startsWith('/api/admin/jobs?')) return new Promise(resolve => { finishJobs = resolve; });
    if (url.startsWith('/api/admin/users?')) return { body: list([user]) };
  } });
  ui.click('[data-view="jobs"]'); await settle(() => finishJobs);
  ui.click('[data-view="users"]'); await settle(() => ui.$('tbody')?.textContent.includes('手机用户'));
  finishJobs({ body: list([job]) }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.$('#admin-content h1').textContent, '用户管理');
  assert.match(ui.$('tbody').textContent, /手机用户/);
  assert.equal(ui.$('[data-cancel]'), null);
});

test('user-controlled strings are escaped in tables and feedback forms', async t => {
  const injected = '<img src=x onerror="window.adminXss=true">';
  const ui = await page(t, { hash: '#feedback', handle: url => url.startsWith('/api/admin/feedback?') ? { body: list([{ ...feedback, user_name: injected, body: injected, note: '</textarea>' + injected }]) } : undefined });
  assert.equal(ui.win.document.querySelector('#admin-content img'), null);
  assert.match(ui.$('tbody').textContent, /<img src=x/);
  ui.click('[data-feedback]');
  assert.equal(ui.win.document.querySelector('#dialog-body img'), null);
  assert.equal(ui.$('#feedback-note').value, '</textarea>' + injected);
  assert.equal(ui.win.adminXss, undefined);
});

test('orders and usage show unavailable commercial information honestly', async t => {
  const ui = await page(t, { hash: '#orders', handle: url => url.startsWith('/api/admin/usage?') ? { body: list([{ id: 'usage-1', user_name: '手机用户', user_phone: '13800138000', model: 'test-model', input_tokens: null, output_tokens: 42, billable: 0 }]) } : undefined });
  assert.match(ui.$('#admin-content').textContent, /未支付订单不计入收入/);
  assert.doesNotMatch(ui.$('#admin-content').textContent, /¥0|￥0/);
  ui.click('[data-view="usage"]'); await settle(() => ui.$('tbody'));
  assert.match(ui.$('tbody').textContent, /— \/ 42/);
  assert.match(ui.$('#admin-content').textContent, /不等于第三方账单/);
});

test('failed loading offers an explicit retry and recovers without fabricated rows', async t => {
  let tries = 0;
  const ui = await page(t, { hash: '#users', handle: url => url.startsWith('/api/admin/users?') ? ++tries === 1 ? { status: 503, body: { error: '服务正在恢复' } } : { body: list([user]) } : undefined });
  assert.equal(ui.$('tbody'), null); assert.match(ui.$('#admin-content').textContent, /服务正在恢复/);
  ui.click('#retry-view'); await settle(() => ui.$('tbody'));
  assert.match(ui.$('tbody').textContent, /手机用户/);
});

test('a request timeout leaves a retry action instead of an endless loading state', async t => {
  const ui = await page(t, { hash: '#users', requestTimeoutMs: 20, handle: (url, payload, init) => url.startsWith('/api/admin/users?') ? new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) : undefined });
  assert.match(ui.$('#admin-content').textContent, /请求超时/);
  assert.ok(ui.$('#retry-view')); assert.equal(ui.$('.loading-state'), null);
});
