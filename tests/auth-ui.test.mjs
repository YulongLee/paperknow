import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createAuthPage, safeNext } from '../dist/auth.mjs';

const html = await readFile(new URL('../dist/auth.html', import.meta.url), 'utf8');
const available = { password: true, emailCode: true, phoneCode: true, registration: { email: true, phone: true }, codeLength: 6, retryAfter: 60 };
async function settle(check) { for (let i = 0; i < 60; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('UI did not settle'); }
async function page(t, { query = '', options = available, handle, requestTimeoutMs, currentUser } = {}) {
  const dom = new JSDOM(html, { url: 'https://paperknow.cn/auth.html' + query });
  const win = dom.window;
  const calls = [], navigations = [];
  win.fetch = async (url, init = {}) => {
    const data = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, data });
    let body, status = 200;
    if (url.endsWith('/options')) body = options;
    else if (url.endsWith('/me')) { body = currentUser ? {user: currentUser} : { error: '未登录' }; status = currentUser ? 200 : 401; }
    else {
      const result = await handle?.(url, data, init);
      body = result?.body || (url.endsWith('/code/send') ? { challengeId: 'test-challenge', retryAfter: 60, expiresIn: 300 } : { user: { id: 'test-user', phone: '13800138000' } });
      status = result?.status || 200;
    }
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
  };
  const app = createAuthPage(win.document, { navigate: path => navigations.push(path), requestTimeoutMs });
  t.after(() => { app.destroy(); win.close(); });
  await app.ready;
  const $ = selector => win.document.querySelector(selector);
  const fill = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const click = selector => $(selector).click();
  const submit = () => $('#auth-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  return { win, $, fill, click, submit, calls, navigations };
}

test('next accepts only explicit same-origin destinations and migrates old service links', () => {
  const origin = 'https://paperknow.cn';
  for (const value of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/auth.html?next=/service.html', '/api/auth/logout', '/%2f%2fevil.invalid', '/service.html\n', 'workspace.html', null]) assert.equal(safeNext(value, origin), '/workspace.html#home', String(value));
  assert.equal(safeNext('/workspace.html#category/writing', origin), '/workspace.html#category/writing');
  assert.equal(safeNext('/service.html?auth=register&view=projects', origin), '/workspace.html#projects?scope=account');
});

test('phone password login sends normalized identifier and resumes the intended page', async t => {
  const ui = await page(t, { query: '?next=%2Fservice.html%3Fview%3Dprojects' });
  ui.click('#phone-tab');
  ui.fill('#auth-address', '+8613800138000');
  ui.fill('#auth-password', 'A-valid-password!');
  ui.submit();
  await settle(() => ui.navigations.length === 1);
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/login')).data, { identifier: '13800138000', password: 'A-valid-password!' });
  assert.equal(ui.navigations[0], '/workspace.html#projects?scope=account');
  assert.equal(ui.$('#auth-password').value, '');
});

test('code login uses challenge, starts resend cooldown, and never sends password', async t => {
  const ui = await page(t);
  ui.click('#switch-method');
  ui.fill('#auth-address', ' Reader@Example.com ');
  ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/code/send')).data, { channel: 'email', address: 'reader@example.com', purpose: 'login' });
  assert.equal(ui.$('#send-code').disabled, true);
  assert.match(ui.$('#send-code').textContent, /\d+s 后重发/);
  ui.fill('#auth-code', '123456'); ui.submit();
  await settle(() => ui.navigations.length === 1);
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/code/login')).data, { challengeId: 'test-challenge', code: '123456' });
});

test('editing identity invalidates its existing challenge and preserves the original resend limit', async t => {
  const ui = await page(t);
  ui.click('#switch-method'); ui.fill('#auth-address', 'first@example.com'); ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  ui.fill('#auth-address', 'second@example.com'); ui.fill('#auth-code', '123456'); ui.submit();
  assert.match(ui.$('#auth-error').textContent, /先获取当前账户/);
  assert.equal(ui.calls.some(call => call.url.endsWith('/code/login')), false);
  ui.fill('#auth-address', 'first@example.com');
  assert.equal(ui.$('#send-code').disabled, true);
  assert.equal(ui.$('#auth-code').value, '');
});

test('a delayed send response cannot attach a challenge to a changed identity', async t => {
  let finish;
  const ui = await page(t, { handle: url => url.endsWith('/code/send') ? new Promise(resolve => { finish = resolve; }) : undefined });
  ui.click('#switch-method'); ui.fill('#auth-address', 'first@example.com'); ui.click('#send-code');
  await settle(() => finish);
  ui.fill('#auth-address', 'second@example.com');
  finish({ body: { challengeId: 'old-identity', retryAfter: 60, expiresIn: 300 } });
  await settle(() => !ui.$('#auth-submit').disabled);
  ui.fill('#auth-code', '123456'); ui.submit();
  assert.match(ui.$('#auth-error').textContent, /先获取当前账户/);
  assert.equal(ui.calls.some(call => call.url.endsWith('/code/login')), false);
});

test('registration requires a purpose-bound code and submits nickname with password', async t => {
  const ui = await page(t, { query: '?mode=register' });
  ui.fill('#auth-name', '研究者'); ui.fill('#auth-address', 'reader@example.com');
  ui.fill('#auth-password', 'A-valid-password!'); ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  assert.equal(ui.calls.find(call => call.url.endsWith('/code/send')).data.purpose, 'register');
  ui.fill('#auth-code', '654321'); ui.submit();
  await settle(() => ui.navigations.length);
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/register')).data, { challengeId: 'test-challenge', code: '654321', password: 'A-valid-password!', name: '研究者' });
});

test('reset validates ownership and returns to password login without assuming a session', async t => {
  const ui = await page(t, { handle: url => url.endsWith('/password/reset') ? { body: { ok: true } } : undefined });
  ui.click('#forgot-password'); ui.fill('#auth-address', 'reader@example.com');
  ui.fill('#auth-password', 'New-valid-password!'); ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  assert.equal(ui.calls.find(call => call.url.endsWith('/code/send')).data.purpose, 'reset');
  ui.fill('#auth-code', '123456'); ui.submit();
  await settle(() => ui.$('#auth-status').textContent.includes('密码已更新'));
  assert.equal(ui.$('#auth-title').textContent, '欢迎回来');
  assert.equal(ui.$('#auth-password').value, '');
  assert.equal(ui.$('#code-field').hidden, true);
  assert.equal(ui.navigations.length, 0);
});

test('unconfigured delivery is visible, disables code submission, and leaves password login available', async t => {
  const ui = await page(t, { options: { password: true, emailCode: false, phoneCode: false, registration: { email: false, phone: false } } });
  ui.click('#phone-tab'); ui.click('#switch-method');
  assert.equal(ui.$('#phone-tab').hidden, false);
  assert.equal(ui.$('#send-code').disabled, true);
  assert.equal(ui.$('#auth-submit').disabled, true);
  assert.match(ui.$('#availability-note').textContent, /短信验证码服务暂未开放/);
  ui.click('#switch-method');
  assert.equal(ui.$('#auth-submit').disabled, false);
});

test('failed delivery does not show a fake success or allow code login', async t => {
  const ui = await page(t, { handle: url => url.endsWith('/code/send') ? { status: 503, body: { error: '发送暂不可用，请稍后重试。' } } : undefined });
  ui.click('#switch-method'); ui.fill('#auth-address', 'reader@example.com'); ui.click('#send-code');
  await settle(() => ui.$('#auth-error').textContent.includes('发送暂不可用'));
  assert.equal(ui.$('#auth-status').hidden, true);
  ui.fill('#auth-code', '123456'); ui.submit();
  assert.match(ui.$('#auth-error').textContent, /先获取当前账户/);
  assert.equal(ui.calls.some(call => call.url.endsWith('/code/login')), false);
});

test('invalid phone and password are rejected locally; server errors remain readable and retryable', async t => {
  const ui = await page(t, { handle: url => url.endsWith('/login') ? { status: 401, body: { error: '账号或密码不正确。' } } : undefined });
  ui.click('#phone-tab'); ui.fill('#auth-address', '123'); ui.fill('#auth-password', 'abc'); ui.submit();
  assert.match(ui.$('#auth-error').textContent, /手机号/);
  ui.fill('#auth-address', '13800138000'); ui.submit();
  assert.match(ui.$('#auth-error').textContent, /10–128/);
  ui.fill('#auth-password', 'Wrong-password!'); ui.submit();
  await settle(() => ui.$('#auth-error').textContent.includes('账号或密码'));
  assert.equal(ui.$('#auth-submit').disabled, false);
  assert.equal(ui.navigations.length, 0);
});


test('send cooldown is shared by one identity across login, registration and reset', async t => {
  const ui = await page(t);
  ui.click('#switch-method'); ui.fill('#auth-address', 'reader@example.com'); ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  ui.click('#switch-mode');
  assert.equal(ui.$('#auth-title').textContent, '创建你的账户');
  assert.equal(ui.$('#send-code').disabled, true);
  assert.match(ui.$('#send-code').textContent, /\d+s 后重发/);
  ui.click('#switch-mode'); ui.click('#forgot-password');
  assert.equal(ui.$('#send-code').disabled, true);
  assert.equal(ui.$('#auth-code').value, '');
});

test('timed out delivery releases loading and can be retried without exposing a challenge', async t => {
  const ui = await page(t, { requestTimeoutMs: 20, handle: (url, data, init) => url.endsWith('/code/send') ? new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) : undefined });
  ui.click('#switch-method'); ui.fill('#auth-address', 'reader@example.com'); ui.click('#send-code');
  assert.equal(ui.$('#send-code').disabled, true);
  await settle(() => ui.$('#auth-error').textContent.includes('请求超时'));
  assert.equal(ui.$('#send-code').disabled, false);
  assert.equal(ui.$('#auth-submit').disabled, false);
  assert.equal(ui.$('#auth-form').getAttribute('aria-busy'), 'false');
  assert.equal(ui.$('#auth-status').hidden, true);
});


test('admin destination resumes after verified code login, even when an unverified session already exists', async t => {
  assert.equal(safeNext('/admin.html', 'https://paperknow.cn'), '/admin.html');
  assert.equal(safeNext('/service.html?view=admin', 'https://paperknow.cn'), '/admin.html');
  const ui = await page(t, {query:'?method=code&verify=1&next=%2Fadmin.html',currentUser:{id:'unverified-owner',role:'user'}});
  assert.equal(ui.navigations.length, 0);
  assert.equal(ui.$('#method-label').textContent, '验证码登录');
  ui.fill('#auth-address', 'owner@example.com'); ui.click('#send-code');
  await settle(() => ui.$('#auth-status').textContent.includes('已发送'));
  ui.fill('#auth-code', '123456'); ui.submit();
  await settle(() => ui.navigations.length === 1);
  assert.equal(ui.navigations[0], '/admin.html');
});
