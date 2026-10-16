import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createAdminPage } from '../dist/admin.mjs';

const html = await readFile(new URL('../dist/admin.html', import.meta.url), 'utf8');
const channels = [
  { provider: 'wechat', enabled: false, configured: true, ready: false, fields: { appId: 'wx-demo', merchantId: '1900000000', merchantSerial: 'serial-demo', platformPublicKeyId: 'PUB_KEY_ID_demo' }, secretFields: { privateKey: true, apiV3Key: true, platformPublicKey: true }, notifyUrl: 'https://paperknow.cn/api/payments/notify/wechat', validation: [] },
  { provider: 'alipay', enabled: false, configured: false, ready: false, fields: {}, secretFields: {}, notifyUrl: 'https://paperknow.cn/api/payments/notify/alipay', validation: ['请配置应用 AppID'] }
];
const billing = { version: 3, services: ['polish', 'review', 'agent'].map(key => ({ key, title: key, mode: 'paid', creditCost: 5, available: true })) };
const catalog = [{ id: 'basic', title: '基础会员', description: '', status: 'preview', priceCents: null, durationDays: null, entitlementType: 'membership' }];
const creditCatalog = [200, 500, 1000].map(creditAmount => ({ id: `credits-${creditAmount}`, title: `${creditAmount} 积分`, description: `到账 ${creditAmount} 积分。`, status: 'preview', priceCents: creditAmount * 10, durationDays: null, entitlementType: 'credits', creditAmount }));
const bundleCatalog = [{ id: 'bundle-rewrite', title: '论文修改套餐', description: '提供已列出的论文修改服务项。', status: 'preview', priceCents: 9900, durationDays: null, entitlementType: 'bundle', bundleItems: [{ key: 'polish', title: '论文修改', quantity: 2 }] }];
async function settle(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('UI did not settle'); }
async function page(t, { role = 'admin', data, handle, hash = '#payments' } = {}) {
  const dom = new JSDOM(html, { url: 'https://paperknow.cn/admin.html' + hash, pretendToBeVisual: true });
  const win = dom.window, calls = [], navigations = [];
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; };
  win.fetch = async (url, init = {}) => {
    const payload = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, payload, method: init.method });
    let result = await handle?.(url, payload, init);
    if (!result) {
      if (url === '/api/auth/me') result = { body: { user: { id: 'admin-demo', name: '运营管理员', role } } };
      else if (url === '/api/admin/payments') result = { body: { billing: structuredClone(billing), ...structuredClone(data ?? { channels, catalog, encryptionReady: true }) } };
      else if (url === '/api/admin/settings') result = { body: {} };
      else result = { body: {} };
    }
    const status = result.status || 200;
    return { status, ok: status < 400, json: async () => result.body };
  };
  const app = createAdminPage(win.document, { navigate: url => navigations.push(url), pollIntervalMs: 60_000 });
  t.after(() => { app.destroy(); win.close(); });
  await app.ready;
  const $ = selector => win.document.querySelector(selector);
  const fill = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const check = (selector, checked) => { $(selector).checked = checked; $(selector).dispatchEvent(new win.Event('change', { bubbles: true })); };
  const submit = selector => $(selector).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  return { app, win, $, calls, navigations, fill, check, submit, click: selector => $(selector).click() };
}

test('payment administration remains inaccessible to a normal account', async t => {
  const ui = await page(t, { role: 'user' });
  assert.deepEqual(ui.calls.map(call => call.url), ['/api/auth/me']);
  assert.equal(ui.$('#admin-app').hidden, true);
  assert.equal(ui.$('#payment-wechat'), null);
});

test('both payment forms show configuration flags without echoing any signing material', async t => {
  const unsafe = structuredClone(channels); unsafe[0].privateKey = 'never-render-private-key'; unsafe[0].fields.apiV3Key = 'never-render-api-key'; unsafe[0].secretFields.platformPublicKey = true;
  const ui = await page(t, { data: { channels: unsafe, catalog, encryptionReady: true } });
  assert.equal(ui.win.document.querySelectorAll('form[data-payment-provider]').length, 2);
  assert.equal(ui.$('#wechat-privateKey').value, ''); assert.equal(ui.$('#wechat-apiV3Key').value, ''); assert.equal(ui.$('#wechat-platformPublicKey').value, '');
  assert.equal(ui.$('#wechat-appId').value, 'wx-demo');
  assert.equal(ui.$('#wechat-notify').readOnly, true);
  assert.equal(ui.$('#wechat-notify').value, 'https://paperknow.cn/api/payments/notify/wechat');
  assert.doesNotMatch(ui.$('#admin-content').innerHTML, /never-render/);
  assert.match(ui.$('#admin-content').textContent, /留空保留现有值/);
  assert.match(ui.$('#admin-content').textContent, /不会创建支付、扣款/);
  assert.doesNotMatch(ui.$('#admin-content').textContent, /已收款|收款成功|渠道已连通/);
  assert.match(ui.$('.payment-channel[data-provider="wechat"] .badge').textContent, /已配置 · 已停用/);
  assert.equal(ui.$('#product-basic-status').value, 'preview');
  assert.equal(ui.$('#product-basic-price').value, '');
});

test('an empty server configuration renders safely and disallows credential storage before encryption is ready', async t => {
  const ui = await page(t, { data: {} });
  assert.equal(ui.win.document.querySelectorAll('form[data-payment-provider]').length, 2);
  assert.match(ui.$('#admin-content').textContent, /服务端尚未准备好支付配置加密/);
  assert.equal(ui.$('#payment-wechat [type="submit"]').disabled, true);
  assert.match(ui.$('#admin-content').textContent, /暂无可配置的商品/);
  ui.submit('#payment-wechat');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('independent channel switches distinguish saved configuration from checkout visibility and never enable on load', async t => {
  const ui = await page(t);
  assert.equal(ui.win.document.querySelectorAll('[data-payment-toggle][role="switch"]').length, 2);
  assert.equal(ui.$('#wechat-enabled').checked, false); assert.equal(ui.$('#wechat-enabled').disabled, false);
  assert.equal(ui.$('#alipay-enabled').checked, false); assert.equal(ui.$('#alipay-enabled').disabled, true);
  assert.match(ui.$('[data-channel-control="wechat"] .badge').textContent, /未启用/);
  assert.match(ui.$('[data-channel-control="wechat"]').textContent, /商户配置已保存/);
  assert.match(ui.$('[data-channel-control="alipay"] .badge').textContent, /配置待完善/);
  assert.match(ui.$('.payment-channel-controls-heading').textContent, /会员、积分、套餐共用/);
  assert.equal(ui.$('#payment-wechat [name="enabled"]'), null);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('enabling one channel posts only its boolean and preserves the other channel’s unsaved secrets', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => url === '/api/admin/payments/wechat' ? (saved = payload, { body: { ...channels[0], enabled: true, ready: true } }) : undefined });
  ui.fill('#alipay-privateKey', 'unsaved-other-channel-key'); ui.check('#wechat-enabled', true);
  await settle(() => saved && !ui.$('#wechat-enabled').disabled);
  assert.deepEqual(saved, { enabled: true });
  assert.equal(ui.$('#wechat-enabled').checked, true); assert.equal(ui.$('#alipay-enabled').checked, false);
  assert.equal(ui.$('#alipay-privateKey').value, 'unsaved-other-channel-key');
  assert.match(ui.$('[data-channel-control="wechat"] .badge').textContent, /已启用/);
  assert.match(ui.$('#wechat-switch-message').textContent, /已启用/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(ui.$('#wechat-privateKey').value, '');
});

test('disabling a channel retains saved credentials and later parameter saves preserve the disabled state', async t => {
  const saved = [], activeChannels = structuredClone(channels); activeChannels[0].enabled = true; activeChannels[0].ready = true;
  const ui = await page(t, { data: { channels: activeChannels, catalog, encryptionReady: true }, handle: (url, payload) => url === '/api/admin/payments/wechat' ? (saved.push(payload), { body: { ...channels[0], enabled: payload.enabled, ready: false } }) : undefined });
  ui.check('#wechat-enabled', false); await settle(() => saved.length === 1 && !ui.$('#wechat-enabled').disabled);
  assert.deepEqual(saved[0], { enabled: false }); assert.equal(ui.$('#wechat-enabled').checked, false);
  assert.match(ui.$('#wechat-switch-message').textContent, /参数与密钥已保留/);
  assert.equal(ui.$('#payment-wechat .payment-secret-state').textContent, '已保存');
  ui.fill('#wechat-merchantSerial', 'serial-next'); ui.submit('#payment-wechat');
  await settle(() => saved.length === 2 && !ui.$('#payment-wechat [type="submit"]').disabled);
  assert.equal(saved[1].enabled, false); assert.equal(saved[1].merchantSerial, 'serial-next');
  assert.equal(Object.hasOwn(saved[1], 'clearSecrets'), false); assert.equal(Object.hasOwn(saved[1], 'privateKey'), false);
});

test('a dirty channel blocks its switch without submitting or discarding entered parameters', async t => {
  const ui = await page(t); ui.fill('#wechat-privateKey', 'unsaved-own-key'); ui.check('#wechat-enabled', true);
  assert.equal(ui.$('#wechat-enabled').checked, false); assert.equal(ui.$('#wechat-privateKey').value, 'unsaved-own-key');
  assert.match(ui.$('#wechat-switch-message').textContent, /先保存下方修改/);
  assert.equal(ui.$('#payment-wechat .payment-dirty').hidden, false);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('incomplete configuration and unavailable encryption reject even a synthetic switch change', async t => {
  const ui = await page(t); ui.check('#alipay-enabled', true);
  assert.equal(ui.$('#alipay-enabled').checked, false); assert.equal(ui.$('#alipay-enabled').disabled, true);
  assert.match(ui.$('#alipay-switch-message').textContent, /完善并保存商户参数/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  const locked = await page(t, { data: { channels, catalog, encryptionReady: false } }); locked.check('#wechat-enabled', true);
  assert.equal(locked.$('#wechat-enabled').checked, false); assert.equal(locked.$('#wechat-enabled').disabled, true);
  assert.match(locked.$('#wechat-switch-message').textContent, /加密配置尚未就绪/);
  assert.equal(locked.calls.filter(call => call.method === 'POST').length, 0);
});

test('pending switch saves lock the matching form, reject duplicates and prevent leaving', async t => {
  let finish;
  const ui = await page(t, { handle: url => url === '/api/admin/payments/wechat' ? new Promise(resolve => { finish = resolve; }) : undefined });
  ui.check('#wechat-enabled', true); await settle(() => finish);
  assert.equal(ui.$('#wechat-enabled').disabled, true); assert.equal(ui.$('#wechat-appId').disabled, true);
  ui.check('#wechat-enabled', true); ui.submit('#payment-wechat'); ui.click('[data-payment-check="wechat"]');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  ui.click('[data-view="settings"]'); assert.equal(ui.win.location.hash, '#payments'); assert.equal(ui.$('#admin-dialog').open, false);
  assert.match(ui.$('#admin-toast').textContent, /请等待/);
  const unload = new ui.win.Event('beforeunload', { cancelable: true }); ui.win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  finish({ body: { ...channels[0], enabled: true, ready: true } }); await settle(() => !ui.$('#wechat-enabled').disabled);
  assert.equal(ui.$('#wechat-enabled').checked, true); assert.equal(ui.$('#wechat-appId').disabled, false);
});

test('failed channel switches roll back their visual state and permit retry without losing configuration', async t => {
  let attempts = 0;
  const ui = await page(t, { handle: url => url === '/api/admin/payments/wechat' ? (++attempts === 1 ? { status: 400, body: { error: '配置已变更，请先检查。' } } : { body: { ...channels[0], enabled: true, ready: true } }) : undefined });
  ui.check('#wechat-enabled', true); await settle(() => ui.$('#wechat-switch-message').textContent.includes('配置已变更'));
  assert.equal(ui.$('#wechat-enabled').checked, false); assert.equal(ui.$('#wechat-enabled').disabled, false);
  assert.equal(ui.$('#wechat-appId').value, 'wx-demo'); assert.equal(ui.$('#wechat-appId').disabled, false);
  ui.check('#wechat-enabled', true); await settle(() => ui.$('[data-channel-control="wechat"] .badge').textContent === '已启用');
  assert.equal(attempts, 2); assert.equal(ui.$('#wechat-enabled').checked, true);
});

test('a revoked role clears switch configuration and stale switch responses do not repaint another page', async t => {
  const denied = await page(t, { handle: url => url === '/api/admin/payments/wechat' ? { status: 403, body: { error: '权限已失效' } } : undefined });
  denied.check('#wechat-enabled', true); await settle(() => !denied.$('#access-gate').hidden);
  assert.equal(denied.$('#admin-content').innerHTML, ''); assert.equal(denied.$('#admin-app').hidden, true);
  let finish;
  const ui = await page(t, { handle: url => url === '/api/admin/payments/wechat' ? new Promise(resolve => { finish = resolve; }) : undefined });
  ui.check('#wechat-enabled', true); await settle(() => finish); ui.app.destroy(); ui.$('#admin-content').innerHTML = '<p>已离开的页面</p>';
  finish({ body: { ...channels[0], enabled: true, ready: true } }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.$('#admin-content').textContent, '已离开的页面');
});

test('saving one channel omits blank secrets and preserves the other channel’s unsaved work', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => {
    if (url === '/api/admin/payments/wechat') { saved = payload; return { body: { ...channels[0], enabled: payload.enabled, fields: { ...channels[0].fields, merchantId: payload.merchantId } } }; }
  } });
  ui.fill('#alipay-appId', 'unsaved-alipay-app'); ui.fill('#wechat-merchantId', '1900000001');
  ui.submit('#payment-wechat'); ui.submit('#payment-wechat');
  await settle(() => ui.$('#wechat-merchantId').value === '1900000001' && !ui.$('#payment-wechat [type="submit"]').disabled);
  assert.deepEqual(saved, { enabled: false, appId: 'wx-demo', merchantId: '1900000001', merchantSerial: 'serial-demo', platformPublicKeyId: 'PUB_KEY_ID_demo' });
  assert.equal(ui.calls.filter(call => call.url === '/api/admin/payments/wechat').length, 1);
  assert.equal(ui.$('#alipay-appId').value, 'unsaved-alipay-app');
  assert.equal(ui.$('#wechat-privateKey').value, '');
});

test('credentials are submitted only when filled and explicit removals use clearSecrets', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => url === '/api/admin/payments/wechat' ? (saved = payload, { body: channels[0] }) : undefined });
  ui.fill('#wechat-privateKey', '  new-private-key\n  '); ui.fill('#wechat-apiV3Key', 'do-not-submit-when-removing'); ui.check('[name="clear-apiV3Key"]', true);
  ui.submit('#payment-wechat'); await settle(() => saved && ui.$('#wechat-privateKey').value === '');
  assert.equal(saved.privateKey, 'new-private-key'); assert.deepEqual(saved.clearSecrets, ['apiV3Key']); assert.equal('apiV3Key' in saved, false);
  assert.equal('platformPublicKey' in saved, false);
});

test('a rejected save preserves form contents and restores usable controls', async t => {
  const ui = await page(t, { handle: url => url === '/api/admin/payments/alipay' ? { status: 400, body: { error: '支付宝应用私钥格式不正确。' } } : undefined });
  ui.fill('#alipay-appId', 'app-new'); ui.fill('#alipay-privateKey', 'invalid-private'); ui.submit('#payment-alipay');
  await settle(() => ui.$('#alipay-error').textContent.includes('格式不正确'));
  assert.equal(ui.$('#alipay-appId').value, 'app-new'); assert.equal(ui.$('#alipay-privateKey').value, 'invalid-private');
  assert.equal(ui.$('#payment-alipay [type="submit"]').disabled, false);
  assert.equal(ui.$('#alipay-appId').disabled, false);
});

test('configuration checking uses saved data and explicitly avoids claiming real payment verification', async t => {
  const ui = await page(t, { handle: url => url === '/api/admin/payments/wechat/check' ? { body: { ok: true, configured: true, ready: true, validation: [] } } : undefined });
  ui.fill('#wechat-merchantId', 'changed'); assert.equal(ui.$('[data-payment-check="wechat"]').disabled, true);
  ui.fill('#wechat-merchantId', '1900000000'); assert.equal(ui.$('[data-payment-check="wechat"]').disabled, false);
  ui.click('[data-payment-check="wechat"]'); await settle(() => !ui.$('#wechat-check-result').hidden);
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/check')).payload, {});
  assert.match(ui.$('#wechat-check-result').textContent, /本地配置检查通过，尚未进行真实支付验证/);
  assert.doesNotMatch(ui.$('#wechat-check-result').textContent, /已收款|连通成功/);
});

test('unsaved channel and product edits are protected from navigation, refresh and browser unload', async t => {
  const ui = await page(t); ui.fill('#product-basic-title', '尚未保存的商品');
  const before = ui.calls.length;
  ui.click('[data-view="settings"]'); assert.equal(ui.$('#admin-dialog').open, true); assert.equal(ui.win.location.hash, '#payments'); assert.equal(ui.calls.length, before);
  ui.click('[data-dialog-close]'); ui.click('#refresh-view'); assert.equal(ui.$('#admin-dialog').open, true); assert.equal(ui.calls.length, before);
  const unload = new ui.win.Event('beforeunload', { cancelable: true }); ui.win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  ui.click('[data-dialog-close]'); ui.click('[data-view="settings"]'); ui.click('#discard-payment-changes');
  await settle(() => ui.$('#model-form')); assert.equal(ui.win.location.hash, '#settings');
});

test('navigation waits for a pending channel save instead of discarding it', async t => {
  let finish;
  const ui = await page(t, { handle: url => url === '/api/admin/payments/wechat' ? new Promise(resolve => { finish = resolve; }) : undefined });
  ui.fill('#wechat-merchantId', '1900000001'); ui.submit('#payment-wechat'); await settle(() => finish);
  ui.click('[data-view="settings"]'); assert.equal(ui.$('#admin-dialog').open, false); assert.equal(ui.win.location.hash, '#payments'); assert.match(ui.$('#admin-toast').textContent, /请等待/);
  assert.equal(ui.$('#wechat-merchantId').disabled, true);
  finish({ body: channels[0] }); await settle(() => !ui.$('#wechat-merchantId').disabled);
});

test('product prices are parsed exactly to integer cents and products remain unpublished by default', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => url === '/api/admin/payments/products/basic' ? (saved = payload, { body: { item: { ...catalog[0], ...payload } } }) : undefined });
  ui.fill('#product-basic-price', '0.29'); ui.fill('#product-basic-days', '30'); ui.fill('#product-basic-description', '已开放的会员权益。'); ui.submit('[data-payment-product="basic"]');
  await settle(() => saved && !ui.$('[data-payment-product="basic"] [type="submit"]').disabled);
  assert.equal(saved.priceCents, 29); assert.equal(saved.durationDays, 30); assert.equal(saved.status, 'preview');
  assert.deepEqual(saved, { title: '基础会员', description: '已开放的会员权益。', status: 'preview', priceCents: 29, durationDays: 30, membershipItems: [] });
  assert.equal(ui.$('#product-basic-price').value, '0.29'); assert.match(ui.$('#admin-toast').textContent, /当前未上架/);
});

test('membership, credit and bundle products are grouped with distinct fields and the confirmed credit amounts', async t => {
  const ui = await page(t, { data: { channels, catalog: [...catalog, ...creditCatalog, ...bundleCatalog], encryptionReady: true } });
  assert.equal(ui.win.document.querySelectorAll('[data-product-group="membership"] form').length, 1);
  assert.equal(ui.win.document.querySelectorAll('[data-product-group="credits"] form').length, 3);
  for (const amount of [200, 500, 1000]) {
    assert.equal(ui.$(`#product-credits-${amount}-credits`).value, String(amount));
    assert.equal(ui.$(`#product-credits-${amount}-price`).value, `${amount / 10}.00`);
    assert.equal(ui.$(`#product-credits-${amount}-days`), null);
  }
  assert.equal(ui.$('#product-basic-credits'), null);
  assert.equal(ui.win.document.querySelectorAll('[data-product-group="bundle"] form').length, 1);
  assert.equal(ui.$('#product-bundle-rewrite-days').value, '');
  assert.equal(ui.$('#product-bundle-rewrite-credits'), null);
  assert.match(ui.$('label[for="product-bundle-rewrite-days"]').textContent, /套餐有效期/);
  for (const type of ['membership', 'credits', 'bundle']) assert.match(ui.$(`[data-product-group="${type}"] .payment-product-channels`).textContent, /微信支付 · 支付宝/);
  assert.match(ui.$('[data-payment-product="bundle-rewrite"] .payment-product-delivery').textContent, /付费任务成功才扣减/);
});

test('credit saves submit credit entitlement without membership days and preserve a separate unsaved membership edit', async t => {
  let saved;
  const ui = await page(t, { data: { channels, catalog: [...catalog, ...creditCatalog], encryptionReady: true }, handle: (url, payload) => url === '/api/admin/payments/products/credits-500' ? (saved = payload, { body: { item: { ...creditCatalog[1], ...payload } } }) : undefined });
  ui.fill('#product-basic-title', '会员未保存名称');
  ui.fill('#product-credits-500-status', 'active');
  const extra = ui.win.document.createElement('input'); extra.name = 'durationDays'; extra.value = '365'; ui.$('[data-payment-product="credits-500"]').append(extra);
  ui.submit('[data-payment-product="credits-500"]');
  await settle(() => saved && !ui.$('[data-payment-product="credits-500"] [type="submit"]').disabled);
  assert.deepEqual(saved, { title: '500 积分', description: '到账 500 积分。', status: 'active', priceCents: 5000, durationDays: null, entitlementType: 'credits', creditAmount: 500 });
  assert.equal(ui.$('#product-basic-title').value, '会员未保存名称');
  assert.equal(ui.$('[data-payment-product="basic"] .payment-dirty').hidden, false);
  assert.equal(ui.$('#product-credits-500-days'), null);
  assert.equal(ui.$('#product-credits-500-credits').value, '500');
});

test('credit publishing rejects missing, fractional, negative and excessive quantities without sending requests', async t => {
  const ui = await page(t, { data: { channels, catalog: creditCatalog, encryptionReady: true } });
  ui.fill('#product-credits-200-status', 'active');
  for (const value of ['', '0', '-1', '200.5', '1000001', '2e2']) {
    ui.fill('#product-credits-200-credits', value); ui.submit('[data-payment-product="credits-200"]');
    assert.match(ui.$('[data-payment-product="credits-200"] .form-error').textContent, value ? /积分数量需为/ : /上架前请填写售价、积分数量/);
  }
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(ui.$('[data-payment-product="credits-200"] [type="submit"]').disabled, false);
});

test('bundle product saves snapshot service items and their own duration without membership or credit conversion', async t => {
  let saved;
  const ui = await page(t, { data: { channels, catalog: [...catalog, ...bundleCatalog], encryptionReady: true }, handle: (url, payload) => url === '/api/admin/payments/products/bundle-rewrite' ? (saved = payload, { body: { item: { ...bundleCatalog[0], ...payload } } }) : undefined });
  ui.fill('#product-basic-title', '仍未保存的会员修改');
  ui.click('[data-payment-product="bundle-rewrite"] [data-bundle-add]');
  ui.fill('#product-bundle-rewrite-bundle-1-key', 'review'); ui.fill('#product-bundle-rewrite-bundle-1-title', '格式排版'); ui.fill('#product-bundle-rewrite-bundle-1-quantity', '1');
  ui.fill('#product-bundle-rewrite-days', '30'); ui.fill('#product-bundle-rewrite-status', 'active'); ui.submit('[data-payment-product="bundle-rewrite"]');
  await settle(() => saved && !ui.$('[data-payment-product="bundle-rewrite"] [type="submit"]').disabled);
  assert.deepEqual(saved, { title: '论文修改套餐', description: '提供已列出的论文修改服务项。', status: 'active', priceCents: 9900, durationDays: 30, entitlementType: 'bundle', bundleItems: [{ key: 'polish', title: '论文修改', quantity: 2 }, { key: 'review', title: '格式排版', quantity: 1 }] });
  assert.equal(Object.hasOwn(saved, 'creditAmount'), false);
  assert.equal(ui.$('#product-basic-title').value, '仍未保存的会员修改');
  assert.equal(ui.$('[data-payment-product="basic"] .payment-dirty').hidden, false);
});

test('bundle drafts can save empty entitlements but publishing requires duration and service items', async t => {
  let saved;
  const ui = await page(t, { data: { channels, catalog: bundleCatalog, encryptionReady: true }, handle: (url, payload) => url === '/api/admin/payments/products/bundle-rewrite' ? (saved = payload, { body: { item: { ...bundleCatalog[0], ...payload } } }) : undefined });
  ui.click('[data-bundle-remove]'); ui.submit('[data-payment-product="bundle-rewrite"]');
  await settle(() => saved && !ui.$('[data-payment-product="bundle-rewrite"] [type="submit"]').disabled);
  assert.equal(saved.durationDays, null); assert.deepEqual(saved.bundleItems, []); assert.equal(saved.status, 'preview');
  ui.fill('#product-bundle-rewrite-status', 'active'); ui.submit('[data-payment-product="bundle-rewrite"]');
  assert.match(ui.$('[data-payment-product="bundle-rewrite"] .form-error').textContent, /套餐有效期/);
  ui.fill('#product-bundle-rewrite-days', '30'); ui.submit('[data-payment-product="bundle-rewrite"]');
  assert.match(ui.$('[data-payment-product="bundle-rewrite"] .form-error').textContent, /至少配置一个/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});

test('bundle service keys, names and quantities are strictly validated before any save', async t => {
  const ui = await page(t, { data: { channels, catalog: bundleCatalog, encryptionReady: true } });
  const prefix = '#product-bundle-rewrite-bundle-0-';
  for (const [field, value, message] of [['key', 'Rewrite', /请选择有效/], ['key', 'a'.repeat(65), /请选择有效/], ['title', '', /1–80/], ['title', '文'.repeat(81), /1–80/], ['quantity', '0', /1–100000/], ['quantity', '1.5', /1–100000/], ['quantity', '100001', /1–100000/]]) {
    ui.fill(prefix + 'key', 'polish'); ui.fill(prefix + 'title', '论文修改'); ui.fill(prefix + 'quantity', '2'); ui.fill(prefix + field, value);
    ui.submit('[data-payment-product="bundle-rewrite"]'); assert.match(ui.$('[data-payment-product="bundle-rewrite"] .form-error').textContent, message);
  }
  ui.fill(prefix + 'quantity', '2'); ui.click('[data-bundle-add]');
  ui.fill('#product-bundle-rewrite-bundle-1-key', 'polish'); ui.fill('#product-bundle-rewrite-bundle-1-title', '重复服务标识'); ui.fill('#product-bundle-rewrite-bundle-1-quantity', '1');
  ui.submit('[data-payment-product="bundle-rewrite"]'); assert.match(ui.$('[data-payment-product="bundle-rewrite"] .form-error').textContent, /不能重复/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('bundle row additions and removals participate in dirty guards and enforce the maximum row count', async t => {
  const ui = await page(t, { data: { channels, catalog: bundleCatalog, encryptionReady: true } });
  ui.click('[data-bundle-add]'); assert.equal(ui.$('.payment-dirty').hidden, true);
  assert.equal(ui.$('[data-payment-product="bundle-rewrite"] .payment-dirty').hidden, false);
  const unload = new ui.win.Event('beforeunload', { cancelable: true }); ui.win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  ui.click('[data-view="settings"]'); assert.equal(ui.$('#admin-dialog').open, true); ui.click('[data-dialog-close]');
  ui.click('[data-bundle-row="1"] [data-bundle-remove]'); assert.equal(ui.$('[data-payment-product="bundle-rewrite"] .payment-dirty').hidden, true);
  for (let i = 1; i < 21; i++) ui.click('[data-bundle-add]');
  assert.equal(ui.win.document.querySelectorAll('[data-bundle-row]').length, 20); assert.equal(ui.$('[data-bundle-add]').disabled, true);
  ui.click('[data-bundle-row="19"] [data-bundle-remove]'); assert.equal(ui.$('[data-bundle-add]').disabled, false);
});

test('bundle saves protect pending changes from navigation and do not expose unescaped service content', async t => {
  let finish;
  const injected = '<img src=x onerror="window.pwned=true">';
  const data = { channels, catalog: [{ ...bundleCatalog[0], bundleItems: [{ key: 'rewrite', title: injected, quantity: 1 }] }], encryptionReady: true };
  const ui = await page(t, { data, handle: url => url === '/api/admin/payments/products/bundle-rewrite' ? new Promise(resolve => { finish = resolve; }) : undefined });
  assert.equal(ui.$('#admin-content img'), null); assert.equal(ui.$('#product-bundle-rewrite-bundle-0-title').value, injected);
  ui.fill('#product-bundle-rewrite-bundle-0-title', '论文修改'); ui.submit('[data-payment-product="bundle-rewrite"]'); await settle(() => finish);
  assert.equal(ui.$('[data-bundle-add]').disabled, true); assert.equal(ui.$('[data-bundle-remove]').disabled, true);
  ui.click('[data-view="settings"]'); assert.equal(ui.win.location.hash, '#payments'); assert.equal(ui.$('#admin-dialog').open, false); assert.match(ui.$('#admin-toast').textContent, /请等待/);
  finish({ body: { item: bundleCatalog[0] } }); await settle(() => !ui.$('[data-bundle-add]').disabled);
  assert.equal(ui.win.pwned, undefined);
});

test('publishing requires a real price, positive membership duration and delivery description', async t => {
  const ui = await page(t); ui.fill('#product-basic-status', 'active'); ui.submit('[data-payment-product="basic"]');
  assert.match(ui.$('[data-payment-product="basic"] .form-error').textContent, /上架前请填写/);
  ui.fill('#product-basic-price', '29.999'); ui.submit('[data-payment-product="basic"]'); assert.match(ui.$('[data-payment-product="basic"] .form-error').textContent, /最多保留两位小数/);
  ui.fill('#product-basic-price', '29.99'); ui.fill('#product-basic-days', '-1'); ui.submit('[data-payment-product="basic"]'); assert.match(ui.$('[data-payment-product="basic"] .form-error').textContent, /整数天/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('server-controlled validation and product content are escaped', async t => {
  const injected = '<img src=x onerror="window.pwned=true">';
  const data = { channels: [{ ...channels[1], validation: [injected] }], catalog: [{ ...catalog[0], title: injected, description: '</textarea>' + injected }], encryptionReady: true };
  const ui = await page(t, { data });
  assert.equal(ui.$('#admin-content img'), null); assert.equal(ui.win.pwned, undefined);
  assert.equal(ui.$('#product-basic-description').value, '</textarea>' + injected);
  assert.match(ui.$('#alipay-validation').textContent, /<img src=x/);
});

test('revoked administration access clears payment fields on a save failure', async t => {
  const ui = await page(t, { handle: url => url === '/api/admin/payments/alipay' ? { status: 403, body: { error: '权限已失效' } } : undefined });
  ui.fill('#alipay-privateKey', 'not-left-on-screen'); ui.submit('#payment-alipay'); await settle(() => !ui.$('#access-gate').hidden);
  assert.equal(ui.$('#admin-app').hidden, true); assert.equal(ui.$('#admin-content').innerHTML, ''); assert.equal(ui.$('#admin-navigation').textContent, '');
});

test('missing payment parameters identify their channel-specific field labels', async t => {
  const ui = await page(t, { data: {
    channels: [
      { ...channels[0], configured: false, validation: ['原有文字提示', ...['appId', 'merchantId', 'merchantSerial', 'privateKey', 'apiV3Key', 'platformPublicKeyId', 'platformPublicKey'].map(field => ({ field, message: '此项尚未配置' }))] },
      { ...channels[1], validation: ['appId', 'sellerId', 'privateKey', 'alipayPublicKey'].map(field => ({ field, message: '此项尚未配置' })) }
    ], catalog: [], encryptionReady: true
  } });
  const wechat = [...ui.win.document.querySelectorAll('#wechat-validation li')].map(item => item.textContent);
  assert.deepEqual(wechat, ['原有文字提示', '应用 AppID：此项尚未配置', '商户号：此项尚未配置', '商户 API 证书序列号：此项尚未配置', '商户 API 私钥：此项尚未配置', 'API v3 密钥：此项尚未配置', '微信支付公钥 ID：此项尚未配置', '微信支付公钥：此项尚未配置']);
  const alipay = [...ui.win.document.querySelectorAll('#alipay-validation li')].map(item => item.textContent);
  assert.deepEqual(alipay, ['应用 AppID：此项尚未配置', '收款卖家 PID：此项尚未配置', '应用私钥：此项尚未配置', '支付宝公钥：此项尚未配置']);
});

test('order management displays server prices, both channel names and complete selectable transaction identifiers', async t => {
  const merchantNo = 'PK20261015000000000000000001', providerNo = '4200000000202610151234567890';
  const rows = [
    { id: 'order-wechat', product_id: 'basic', product_title: '创建订单时的会员名称', status: 'paid', amount_cents: 12901, provider: 'wechat', out_trade_no: merchantNo, provider_trade_no: providerNo, created_at: '2026-10-15T06:00:00.000Z', paid_at: '2026-10-15T06:01:00.000Z' },
    { id: 'order-alipay', product_id: 'advanced', product_title: '高级会员', status: 'pending', amount_cents: 29, provider: 'alipay', out_trade_no: 'PK-alipay-demo', provider_trade_no: null, created_at: '2026-10-15T06:00:00.000Z' },
    { id: 'order-old', product_id: 'premium', status: 'expired', amount_cents: null, provider: null, created_at: '2026-10-15T05:00:00.000Z' }
  ];
  const ui = await page(t, { hash: '#orders', handle: url => url.startsWith('/api/admin/orders?') ? { body: { items: rows, total: rows.length, page: 1, pageSize: 20 } } : undefined });
  const rendered = [...ui.win.document.querySelectorAll('tbody tr')];
  assert.equal(rendered[0].children[3].textContent, '¥129.01');
  assert.equal(rendered[0].children[4].textContent, '微信支付');
  assert.equal(rendered[0].children[5].textContent, merchantNo);
  assert.equal(rendered[0].children[5].querySelector('span').title, merchantNo);
  assert.equal(rendered[0].children[5].querySelector('span').style.userSelect, 'all');
  assert.equal(rendered[0].children[6].textContent, providerNo);
  assert.equal(rendered[0].children[6].querySelector('span').title, providerNo);
  assert.equal(rendered[0].children[2].textContent, '创建订单时的会员名称');
  assert.match(rendered[0].children[8].textContent, /支付 2026\/10\/15 14:01/);
  assert.equal(rendered[1].children[3].textContent, '¥0.29');
  assert.equal(rendered[1].children[4].textContent, '支付宝');
  assert.equal(rendered[1].children[6].textContent, '—');
  assert.equal(rendered[2].children[3].textContent, '—');
  assert.doesNotMatch(rendered[2].textContent, /¥0/);
  assert.match(rendered[2].textContent, /已过期/);
  assert.doesNotMatch(ui.$('#admin-content').innerHTML, /clipboard|navigator\.clipboard/);
  assert.equal(ui.win.document.querySelectorAll('tbody button').length, 0);
});

test('closed and expired orders have explicit filter values and unavailable amounts never become zero', async t => {
  const rows = [
    { id: 'closed-order', product_id: 'basic', status: 'closed', amount_cents: undefined },
    { id: 'invalid-order', product_id: 'basic', status: 'expired', amount_cents: 129.01 }
  ];
  const ui = await page(t, { hash: '#orders', handle: url => url.startsWith('/api/admin/orders?') ? { body: { items: rows, total: rows.length, page: 1, pageSize: 20 } } : undefined });
  assert.equal(ui.$('#status-filter option[value="closed"]').textContent, '已关闭');
  assert.equal(ui.$('#status-filter option[value="expired"]').textContent, '已过期');
  assert.deepEqual([...ui.win.document.querySelectorAll('tbody .cell-number')].map(cell => cell.textContent), ['—', '—']);
  assert.match(ui.$('tbody').textContent, /已关闭/);
  ui.fill('#status-filter', 'expired'); ui.submit('#search-form');
  await settle(() => ui.calls.some(call => call.url.includes('status=expired')));
  assert.equal(new URL(ui.calls.at(-1).url, 'https://paperknow.cn').searchParams.get('status'), 'expired');
});

test('service pricing exposes only three delivered capabilities and never changes defaults on load', async t => {
  const data = { channels, catalog, encryptionReady: true, billing: { version: 0, services: billing.services.map(item => ({ ...item, mode: 'free', creditCost: null, available: false })) } };
  const ui = await page(t, { data });
  assert.equal(ui.win.document.querySelectorAll('[data-billing-service]').length, 3);
  for (const key of ['polish', 'review', 'agent']) {
    assert.equal(ui.$(`#billing-${key}-mode`).value, 'free');
    assert.equal(ui.$(`#billing-${key}-cost`).disabled, true);
    assert.match(ui.$(`[data-billing-service="${key}"]`).textContent, /服务未接通/);
  }
  assert.match(ui.$('#billing-form').textContent, /会员额度 → 套餐次数 → 科研积分/);
  assert.match(ui.$('#billing-form').textContent, /失败或取消后返还/);
  assert.match(ui.$('#billing-form').textContent, /免费任务不消耗权益/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('pricing saves exact integer charges and version while free and paused services send no fee', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => url === '/api/admin/billing' ? (saved = payload, { body: { billing: { version: 4, services: payload.services.map(item => ({ ...item, available: true })) } } }) : undefined });
  ui.fill('#product-basic-title', '保留的会员草稿');
  ui.fill('#billing-polish-cost', '12');
  ui.fill('#billing-review-mode', 'free'); ui.$('#billing-review-mode').dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  ui.fill('#billing-agent-mode', 'disabled'); ui.$('#billing-agent-mode').dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  assert.equal(ui.$('#billing-review-cost').disabled, true);
  ui.submit('#billing-form'); await settle(() => saved && !ui.$('#billing-form [type="submit"]').disabled);
  assert.deepEqual(saved, { version: 3, services: [{ key: 'polish', mode: 'paid', creditCost: 12 }, { key: 'review', mode: 'free', creditCost: null }, { key: 'agent', mode: 'disabled', creditCost: null }] });
  assert.equal(ui.$('#billing-polish-cost').value, '12');
  assert.equal(ui.$('#billing-review-cost').disabled, true);
  assert.equal(ui.$('#billing-form .payment-dirty').hidden, true);
  assert.equal(ui.$('#product-basic-title').value, '保留的会员草稿');
  assert.equal(ui.$('[data-payment-product="basic"] .payment-dirty').hidden, false);
});

test('invalid service charges do not submit and a pricing conflict preserves edits for review', async t => {
  const ui = await page(t, { handle: url => url === '/api/admin/billing' ? { status: 409, body: { error: '服务计价已被其他管理员修改，请刷新后重试。' } } : undefined });
  for (const value of ['', '0', '-1', '1.2', '1e2', '100001']) {
    ui.fill('#billing-polish-cost', value); ui.submit('#billing-form');
    assert.match(ui.$('#billing-form .form-error').textContent, /1–100000/);
  }
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  ui.fill('#billing-polish-cost', '8'); ui.submit('#billing-form');
  await settle(() => ui.$('#billing-form .form-error').textContent.includes('其他管理员'));
  assert.equal(ui.$('#billing-polish-cost').value, '8');
  assert.equal(ui.$('#billing-form [type="submit"]').disabled, false);
  assert.equal(ui.$('#billing-form .payment-dirty').hidden, false);
});

test('pricing edits and pending requests participate in navigation guards and ignore stale responses', async t => {
  let finish;
  const ui = await page(t, { handle: url => url === '/api/admin/billing' ? new Promise(resolve => { finish = resolve; }) : undefined });
  ui.fill('#billing-polish-cost', '9'); ui.click('[data-view="settings"]');
  assert.equal(ui.$('#admin-dialog').open, true); assert.match(ui.$('#dialog-body').textContent, /服务计价/); ui.click('[data-dialog-close]');
  ui.submit('#billing-form'); await settle(() => finish); ui.submit('#billing-form');
  assert.equal(ui.calls.filter(call => call.url === '/api/admin/billing').length, 1);
  assert.equal(ui.$('#billing-polish-mode').disabled, true);
  ui.click('[data-view="settings"]'); assert.equal(ui.win.location.hash, '#payments'); assert.equal(ui.$('#admin-dialog').open, false);
  ui.app.destroy(); ui.$('#admin-content').innerHTML = '<p>已离开管理页</p>';
  finish({ body: { billing } }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.$('#admin-content').textContent, '已离开管理页');
});

test('missing pricing data blocks pricing updates without inventing service availability', async t => {
  const ui = await page(t, { data: { channels, catalog, encryptionReady: true, billing: null } });
  assert.match(ui.$('#billing-form').textContent, /服务计价信息暂未取得/);
  assert.equal(ui.$('#billing-form [type="submit"]').disabled, true);
  ui.submit('#billing-form'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('membership publishing requires concrete connected service totals and sends separate membership items', async t => {
  let saved;
  const ui = await page(t, { handle: (url, payload) => url === '/api/admin/payments/products/basic' ? (saved = payload, { body: { item: { ...catalog[0], ...payload } } }) : undefined });
  ui.fill('#product-basic-price', '20'); ui.fill('#product-basic-days', '30'); ui.fill('#product-basic-description', '30 天内包含学术润色 3 次。'); ui.fill('#product-basic-status', 'active');
  ui.submit('[data-payment-product="basic"]'); assert.match(ui.$('[data-payment-product="basic"] .form-error').textContent, /至少配置一个/);
  ui.click('[data-membership-add]'); ui.fill('#product-basic-membership-0-key', 'polish'); ui.fill('#product-basic-membership-0-title', '学术润色'); ui.fill('#product-basic-membership-0-quantity', '3');
  ui.submit('[data-payment-product="basic"]'); await settle(() => saved && !ui.$('[data-payment-product="basic"] [type="submit"]').disabled);
  assert.deepEqual(saved.membershipItems, [{ key: 'polish', title: '学术润色', quantity: 3 }]);
  assert.equal(Object.hasOwn(saved, 'bundleItems'), false); assert.equal(Object.hasOwn(saved, 'creditAmount'), false);
  assert.match(ui.$('[data-payment-product="basic"]').textContent, /本次会员有效期总额度/);
  assert.match(ui.$('[data-payment-product="basic"]').textContent, /不按日或按月重置/);
  assert.match(ui.$('[data-payment-product="basic"]').textContent, /不自动续费/);
});

test('legacy unknown bundle services remain unchanged in drafts and cannot be published as a connected service', async t => {
  let saved;
  const legacy = { ...bundleCatalog[0], bundleItems: [{ key: 'legacy-tool', title: '旧工具服务', quantity: 2 }] };
  const ui = await page(t, { data: { channels, catalog: [legacy], encryptionReady: true }, handle: (url, payload) => url.endsWith('/products/bundle-rewrite') ? (saved = payload, { body: { item: { ...legacy, ...payload } } }) : undefined });
  const select = ui.$('#product-bundle-rewrite-bundle-0-key');
  assert.equal(select.tagName, 'SELECT'); assert.equal(select.value, 'legacy-tool'); assert.match(select.selectedOptions[0].textContent, /待接通/);
  assert.equal(select.querySelectorAll('option').length, 5);
  ui.submit('[data-payment-product="bundle-rewrite"]'); await settle(() => saved && !ui.$('[data-payment-product="bundle-rewrite"] [type="submit"]').disabled);
  assert.deepEqual(saved.bundleItems, legacy.bundleItems);
  ui.fill('#product-bundle-rewrite-days', '30'); ui.fill('#product-bundle-rewrite-status', 'active'); ui.submit('[data-payment-product="bundle-rewrite"]');
  assert.match(ui.$('[data-payment-product="bundle-rewrite"] .form-error').textContent, /已接通且开启按权益计费/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});

test('unavailable paid services block new product publishing and display authoritative reasons', async t => {
  const ui = await page(t, { data: { channels, encryptionReady: true, billing: { ...billing, services: billing.services.map(item => ({ ...item, available: false })) }, catalog: [{ ...creditCatalog[0], status: 'active', purchasable: false, unavailableReason: '当前暂无可交付的付费服务' }] } });
  assert.match(ui.$('.payment-product-blocked').textContent, /当前暂无可交付/);
  assert.match(ui.$('.payment-product-heading .badge').textContent, /暂不可售/);
  ui.submit('[data-payment-product="credits-200"]');
  assert.match(ui.$('[data-payment-product="credits-200"] .form-error').textContent, /已接通且开启按权益计费/);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
});

test('revoked administration rights clear pricing data during a save and escaped service titles remain inert', async t => {
  const ui = await page(t, { handle: url => url === '/api/admin/billing' ? { status: 403, body: { error: '管理权限已失效' } } : undefined });
  ui.fill('#billing-polish-cost', '15'); ui.submit('#billing-form');
  await settle(() => !ui.$('#access-gate').hidden);
  assert.equal(ui.$('#admin-content').innerHTML, ''); assert.equal(ui.$('#admin-app').hidden, true);
  const injected = '<img src=x onerror="window.pwned=true">';
  const escaped = await page(t, { data: { channels, billing, encryptionReady: true, catalog: [{ ...catalog[0], membershipItems: [{ key: 'polish', title: injected, quantity: 2 }] }] } });
  assert.equal(escaped.$('#admin-content img'), null); assert.equal(escaped.$('#product-basic-membership-0-title').value, injected); assert.equal(escaped.win.pwned, undefined);
});
