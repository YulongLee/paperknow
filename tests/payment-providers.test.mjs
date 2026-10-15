import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify, createCipheriv } from 'node:crypto';
import { validateProvider, createProviderPayment, queryProviderPayment, parseProviderNotification } from '../backend/payment-providers.mjs';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const platform = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const nowValue = Date.parse('2026-10-15T04:00:00Z');
const now = () => nowValue;
const settings = {
  wechat: { appId: 'wx1234567890abcdef', merchantId: '1900000109', merchantSerial: '0123456789ABCDEF0123456789ABCDEF01234567', privateKey: merchant.privateKey, apiV3Key: '0123456789abcdef0123456789abcdef', platformPublicKeyId: 'PUB_KEY_ID_3000000001', platformPublicKey: platform.publicKey },
  alipay: { appId: '2021001234567890', privateKey: merchant.privateKey, alipayPublicKey: platform.publicKey, sellerId: '2088123456789012' },
};
const order = { outTradeNo: 'PK20261015_test01', amountCents: 970, title: 'PaperKnow 月度会员', notifyUrl: 'https://paperknow.cn/api/payments/notify/wechat', expiresAt: '2026-10-15T04:30:00.000Z' };
const signature = (data, key = platform.privateKey) => sign('RSA-SHA256', Buffer.from(data), key).toString('base64');
const options = fetchImpl => ({ now, fetchImpl });
const safeError = code => error => { assert.equal(error.code, code); assert.ok(!error.message.includes('PRIVATE KEY')); assert.ok(!error.message.includes('secret-vendor-data')); return true; };

function wechatEnvelope(body, overrides = {}) {
  const timestamp = String(nowValue / 1000); const nonce = 'signed_platform_nonce';
  return { rawBody: body, headers: { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': settings.wechat.platformPublicKeyId, 'wechatpay-signature': signature(`${timestamp}\n${nonce}\n${body}\n`), ...overrides } };
}
function wechatResponse(data, overrides = {}) { const env = wechatEnvelope(typeof data === 'string' ? data : JSON.stringify(data), overrides); return new Response(env.rawBody, { status: 200, headers: env.headers }); }
function wechatPaid(overrides = {}) { return { appid: settings.wechat.appId, mchid: settings.wechat.merchantId, out_trade_no: order.outTradeNo, transaction_id: '4200000123456789', trade_state: 'SUCCESS', success_time: '2026-10-15T12:00:00+08:00', amount: { total: 970, currency: 'CNY' }, ...overrides }; }
function alipayResponse(method, raw, overrides = {}) {
  const name = `${method.replaceAll('.', '_')}_response`;
  return new Response(`{ "${name}" : ${raw}, "sign":${JSON.stringify(overrides.sign || signature(raw))}${overrides.extra || ''} }`, { status: 200, headers: { 'content-type': 'application/json' } });
}
function alipayPaid(overrides = {}) { return { code: '10000', msg: 'Success', out_trade_no: order.outTradeNo, trade_no: '202610152200123456', trade_status: 'TRADE_SUCCESS', total_amount: '9.70', send_pay_date: '2026-10-15 12:00:00', ...overrides }; }
function alipayNotify(overrides = {}) {
  const fields = { app_id: settings.alipay.appId, seller_id: settings.alipay.sellerId, notify_id: 'notify-0001', notify_type: 'trade_status_sync', charset: 'utf-8', out_trade_no: order.outTradeNo, trade_no: '202610152200123456', trade_status: 'TRADE_SUCCESS', total_amount: '9.70', subject: '资料 + 下载 & 测试', gmt_payment: '2026-10-15 12:00:00', ...overrides };
  const content = Object.keys(fields).filter(k => fields[k] !== '').sort().map(k => `${k}=${fields[k]}`).join('&');
  return new URLSearchParams({ ...fields, sign_type: 'RSA2', sign: signature(content) }).toString();
}

test('provider configuration requires merchant identities, pinned platform keys and RSA 2048; diagnostics contain no secret', () => {
  assert.deepEqual(validateProvider('wechat', settings.wechat), []);
  assert.deepEqual(validateProvider('alipay', settings.alipay), []);
  assert.equal(validateProvider('other', {}).at(0).field, 'provider');
  const invalid = validateProvider('wechat', { ...settings.wechat, privateKey: 'secret-vendor-data', apiV3Key: 'short', platformPublicKeyId: 'https://evil.example' });
  assert.deepEqual(new Set(invalid.map(i => i.field)), new Set(['privateKey', 'apiV3Key', 'platformPublicKeyId']));
  assert.ok(!JSON.stringify(invalid).includes('secret-vendor-data'));
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(validateProvider('alipay', { ...settings.alipay, alipayPublicKey: weak }).at(0).field, 'alipayPublicKey');
  const bare = settings.alipay.alipayPublicKey.replace(/-----[^-]+-----|\s/g, '');
  assert.deepEqual(validateProvider('alipay', { ...settings.alipay, alipayPublicKey: bare }), []);
});

test('WeChat Native request signs exact method/path/body and requests the configured public-key mode', async () => {
  const result = await createProviderPayment('wechat', { ...settings.wechat, gateway: 'https://evil.example' }, order, options(async (url, init) => {
    assert.equal(url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Wechatpay-Serial'], settings.wechat.platformPublicKeyId);
    const attrs = Object.fromEntries([...init.headers.Authorization.matchAll(/([a-z_]+)="([^"]+)"/g)].map(m => [m[1], m[2]]));
    assert.equal(attrs.mchid, settings.wechat.merchantId); assert.equal(attrs.serial_no, settings.wechat.merchantSerial);
    const signed = `POST\n/v3/pay/transactions/native\n${attrs.timestamp}\n${attrs.nonce_str}\n${init.body}\n`;
    assert.equal(verify('RSA-SHA256', Buffer.from(signed), merchant.publicKey, Buffer.from(attrs.signature, 'base64')), true);
    const data = JSON.parse(init.body); assert.equal(data.amount.total, 970); assert.equal(data.amount.currency, 'CNY');
    assert.equal(data.notify_url, order.notifyUrl); assert.equal(data.time_expire, order.expiresAt);
    return wechatResponse({ code_url: 'weixin://wxpay/bizpayurl?pr=valid_qr' });
  }));
  assert.deepEqual(result, { qrContent: 'weixin://wxpay/bizpayurl?pr=valid_qr', expiresAt: order.expiresAt });
});

test('WeChat query verifies the raw signed result before returning paid data and signs its query string', async () => {
  const result = await queryProviderPayment('wechat', settings.wechat, order, options(async (url, init) => {
    const path = `/v3/pay/transactions/out-trade-no/${order.outTradeNo}?mchid=${settings.wechat.merchantId}`;
    assert.equal(url, `https://api.mch.weixin.qq.com${path}`);
    assert.equal(init.body, undefined);
    const attrs = Object.fromEntries([...init.headers.Authorization.matchAll(/([a-z_]+)="([^"]+)"/g)].map(m => [m[1], m[2]]));
    assert.ok(verify('RSA-SHA256', Buffer.from(`GET\n${path}\n${attrs.timestamp}\n${attrs.nonce_str}\n\n`), merchant.publicKey, Buffer.from(attrs.signature, 'base64')));
    return wechatResponse(wechatPaid());
  }));
  assert.deepEqual(result, { state: 'paid', amountCents: 970, currency: 'CNY', merchantId: settings.wechat.merchantId, appId: settings.wechat.appId, outTradeNo: order.outTradeNo, providerTradeNo: '4200000123456789', paidAt: '2026-10-15T04:00:00.000Z' });
});

test('WeChat refuses invalid/missing/probe signatures, unpinned serial and expired timestamp', async () => {
  const bodies = [
    wechatResponse(wechatPaid(), { 'wechatpay-signature': 'WECHATPAY/SIGNTEST/invalid' }),
    wechatResponse(wechatPaid(), { 'wechatpay-signature': '' }),
    wechatResponse(wechatPaid(), { 'wechatpay-serial': 'PUB_KEY_ID_3000000002' }),
    wechatResponse(wechatPaid(), { 'wechatpay-timestamp': String(nowValue / 1000 - 301) }),
  ];
  for (const response of bodies) await assert.rejects(queryProviderPayment('wechat', settings.wechat, order, options(async () => response)), safeError('payment_signature_invalid'));
  const original = wechatEnvelope(JSON.stringify(wechatPaid()));
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, { ...original, rawBody: original.rawBody.replace('970', '971') }, { now }), safeError('payment_signature_invalid'));
});

function encryptedNotification(data, overrides = {}) {
  const nonce = '123456789012'; const associated_data = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(settings.wechat.apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associated_data));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  return wechatEnvelope(JSON.stringify({ id: 'evt_0001', event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource', resource: { algorithm: 'AEAD_AES_256_GCM', original_type: 'transaction', ciphertext, nonce, associated_data }, ...overrides }));
}

test('WeChat callback verifies outer RSA signature then authenticates AES-256-GCM resource', async () => {
  const notification = encryptedNotification(wechatPaid());
  const result = await parseProviderNotification('wechat', settings.wechat, notification, { now });
  assert.equal(result.state, 'paid'); assert.equal(result.amountCents, 970);
  const envelope = JSON.parse(notification.rawBody); envelope.resource.ciphertext = envelope.resource.ciphertext.replace(/^./, envelope.resource.ciphertext[0] === 'A' ? 'B' : 'A');
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, wechatEnvelope(JSON.stringify(envelope)), { now }), safeError('payment_signature_invalid'));
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, notification, { now: () => nowValue + 301_000 }), safeError('payment_signature_invalid'));
});

test('WeChat callback rejects other events, algorithms and non-CNY amounts even if platform signed', async () => {
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, encryptedNotification(wechatPaid(), { event_type: 'REFUND.SUCCESS' }), { now }), safeError('payment_response_invalid'));
  const envelope = JSON.parse(encryptedNotification(wechatPaid()).rawBody); envelope.resource.algorithm = 'AES_CBC';
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, wechatEnvelope(JSON.stringify(envelope)), { now }), safeError('payment_response_invalid'));
  await assert.rejects(parseProviderNotification('wechat', settings.wechat, encryptedNotification(wechatPaid({ amount: { total: 970, currency: 'USD' } })), { now }), safeError('payment_response_invalid'));
});

test('Alipay precreate uses fixed production gateway, exact cents and RSA2 sorted request fields', async () => {
  const result = await createProviderPayment('alipay', { ...settings.alipay, gateway: 'https://evil.example' }, order, options(async (url, init) => {
    assert.equal(url, 'https://openapi.alipay.com/gateway.do');
    const form = Object.fromEntries(new URLSearchParams(init.body)); const sig = form.sign; delete form.sign;
    assert.equal(form.sign_type, 'RSA2'); assert.equal(form.method, 'alipay.trade.precreate');
    assert.equal(form.timestamp, '2026-10-15 12:00:00');
    const content = Object.keys(form).sort().map(k => `${k}=${form[k]}`).join('&');
    assert.ok(verify('RSA-SHA256', Buffer.from(content), merchant.publicKey, Buffer.from(sig, 'base64')));
    const biz = JSON.parse(form.biz_content); assert.equal(biz.total_amount, '9.70'); assert.equal(biz.seller_id, settings.alipay.sellerId); assert.equal(biz.timeout_express, '30m');
    return alipayResponse(form.method, JSON.stringify({ code: '10000', out_trade_no: order.outTradeNo, qr_code: 'https://qr.alipay.com/bax12345' }));
  }));
  assert.equal(result.qrContent, 'https://qr.alipay.com/bax12345');
});

test('Alipay query verifies the original JSON slice, preserving escaped strings, order and whitespace', async () => {
  const raw = `{ "out_trade_no" : "${order.outTradeNo}", "code":"10000", "msg":"escaped \\" quote: } and ,", "total_amount":"9.70", "trade_status":"TRADE_SUCCESS", "trade_no":"20261015", "fund_bill_list":[{"amount":"9.70"}] }`;
  const result = await queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw)));
  assert.equal(result.state, 'paid'); assert.equal(result.amountCents, 970); assert.equal(result.merchantId, settings.alipay.sellerId); assert.equal(result.appId, settings.alipay.appId);
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw, { sign: signature(JSON.stringify(JSON.parse(raw))) }))), safeError('payment_signature_invalid'));
});

test('Alipay unsigned, altered or duplicate response keys cannot return success', async () => {
  const raw = JSON.stringify(alipayPaid());
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => new Response(JSON.stringify({ alipay_trade_query_response: alipayPaid() })))), safeError('payment_response_invalid'));
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw.replace('9.70', '8.70'), { sign: signature(raw) }))), safeError('payment_signature_invalid'));
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw, { extra: ',"sign":"invalid"' }))), safeError('payment_response_invalid'));
});

test('Alipay notification URL-decodes only once, verifies sorted fields excluding sign_type and returns signed identities', async () => {
  const rawBody = alipayNotify();
  const result = await parseProviderNotification('alipay', settings.alipay, { headers: {}, rawBody }, { now });
  assert.deepEqual(result, { state: 'paid', amountCents: 970, currency: 'CNY', merchantId: settings.alipay.sellerId, appId: settings.alipay.appId, outTradeNo: order.outTradeNo, providerTradeNo: '202610152200123456', paidAt: '2026-10-15T04:00:00.000Z' });
  await assert.rejects(parseProviderNotification('alipay', settings.alipay, { rawBody: `${rawBody}&total_amount=9.70` }), safeError('payment_response_invalid'));
  await assert.rejects(parseProviderNotification('alipay', settings.alipay, { rawBody: rawBody.replace('total_amount=9.70', 'total_amount=8.70') }), safeError('payment_signature_invalid'));
  await assert.rejects(parseProviderNotification('alipay', settings.alipay, { rawBody: rawBody.replace('sign_type=RSA2', 'sign_type=RSA') }), safeError('payment_signature_invalid'));
});

test('money values are strict decimal strings, not rounded float, exponent, negative or >2 decimals', async () => {
  for (const amount of ['9.701', '9.7e0', '-1.00', '09.70', 'NaN', '9,70', 9.7]) {
    await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', JSON.stringify(alipayPaid({ total_amount: amount }))))), safeError('payment_response_invalid'));
  }
  for (const [input, expected] of [['0.01', 1], ['9.7', 970], ['0.29', 29], ['9999.99', 999999]]) {
    const result = await queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', JSON.stringify(alipayPaid({ total_amount: input })))));
    assert.equal(result.amountCents, expected);
  }
});

test('invalid outgoing amount, out_trade_no and notification URL are rejected before fetching', async () => {
  let calls = 0; const opts = options(async () => { calls++; throw new Error('unexpected'); });
  for (const invalid of [{ amountCents: 9.7 }, { amountCents: -1 }, { outTradeNo: '../escape' }, { notifyUrl: 'http://paperknow.cn/notify' }, { expiresAt: '2020-01-01' }]) {
    await assert.rejects(createProviderPayment('wechat', settings.wechat, { ...order, ...invalid }, opts), safeError('payment_order_invalid'));
  }
  assert.equal(calls, 0);
});

test('provider errors remain safe and timeouts cancel a request that would otherwise hang', async () => {
  await assert.rejects(queryProviderPayment('wechat', settings.wechat, order, options(async () => { throw new Error('secret-vendor-data'); })), safeError('payment_provider_unavailable'));
  let signal;
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, { now, timeoutMs: 15, fetchImpl: async (_url, init) => { signal = init.signal; return new Promise(() => {}); } }), safeError('payment_timeout'));
  assert.equal(signal.aborted, true);
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => new Response('secret-vendor-data', { status: 500 }))), safeError('payment_provider_unavailable'));
});

test('only expected provider QR schemes are accepted after verification', async () => {
  await assert.rejects(createProviderPayment('wechat', settings.wechat, order, options(async () => wechatResponse({ code_url: 'https://evil.example/checkout' }))), safeError('payment_response_invalid'));
  await assert.rejects(createProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.precreate', JSON.stringify({ code: '10000', out_trade_no: order.outTradeNo, qr_code: 'javascript:alert(1)' })))), safeError('payment_response_invalid'));
});
