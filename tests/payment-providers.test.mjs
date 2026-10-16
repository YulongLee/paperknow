import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify, createCipheriv } from 'node:crypto';
import { validateProvider, validateAlipayPaymentURL, validateAlipayQRPaymentURL, deriveAlipayQRPaymentURL, createProviderPayment, queryProviderPayment, parseProviderNotification } from '../backend/payment-providers.mjs';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const platform = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const nowValue = Date.parse('2026-10-15T04:00:00Z');
const now = () => nowValue;
const settings = {
  wechat: { appId: 'wx1234567890abcdef', merchantId: '1900000109', merchantSerial: '0123456789ABCDEF0123456789ABCDEF01234567', privateKey: merchant.privateKey, apiV3Key: '0123456789abcdef0123456789abcdef', platformPublicKeyId: 'PUB_KEY_ID_3000000001', platformPublicKey: platform.publicKey },
  alipay: { appId: '2021001234567890', privateKey: merchant.privateKey, alipayPublicKey: platform.publicKey, sellerId: '2088123456789012' },
};
const order = { outTradeNo: 'PK20261015_test01', amountCents: 970, title: 'PaperKnow 月度会员', notifyUrl: 'https://paperknow.cn/api/payments/notify/wechat', expiresAt: '2026-10-15T04:30:00.000Z' };
const alipayOrder = { ...order, notifyUrl: 'https://paperknow.cn/api/payments/notify/alipay', returnUrl: 'https://paperknow.cn/api/payments/return/alipay?order=10d38a6d-174b-4eaa-898c-24db817c7f76' };
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

test('Alipay page payment locally signs the exact amount, identities, expiry and return URL without a network request', async () => {
  let calls = 0;
  const result = await createProviderPayment('alipay', { ...settings.alipay, gateway: 'https://evil.example' }, alipayOrder, options(async () => { calls++; throw new Error('unexpected network request'); }));
  assert.equal(calls, 0); assert.equal(result.expiresAt, alipayOrder.expiresAt); assert.equal(result.qrContent, undefined);
  const url = new URL(result.paymentUrl); assert.equal(url.origin + url.pathname, 'https://openapi.alipay.com/gateway.do');
  const form = Object.fromEntries(url.searchParams); const sig = form.sign; delete form.sign;
  assert.equal(form.sign_type, 'RSA2'); assert.equal(form.method, 'alipay.trade.page.pay'); assert.equal(form.timestamp, '2026-10-15 12:00:00');
  assert.equal(form.return_url, alipayOrder.returnUrl); assert.equal(form.notify_url, alipayOrder.notifyUrl); assert.equal(form.app_id, settings.alipay.appId);
  const content = Object.keys(form).sort().map(k => `${k}=${form[k]}`).join('&');
  assert.ok(verify('RSA-SHA256', Buffer.from(content), merchant.publicKey, Buffer.from(sig, 'base64')));
  assert.deepEqual(JSON.parse(form.biz_content), { out_trade_no: alipayOrder.outTradeNo, product_code: 'FAST_INSTANT_TRADE_PAY', total_amount: '9.70', subject: alipayOrder.title, seller_id: settings.alipay.sellerId, time_expire: '2026-10-15 12:30:00' });
  assert.equal(validateAlipayPaymentURL(result.paymentUrl, { ...alipayOrder, appId: settings.alipay.appId, sellerId: settings.alipay.sellerId }), true);
  assert.ok(!result.paymentUrl.includes('PRIVATE KEY')); assert.ok(!result.paymentUrl.includes(settings.alipay.privateKey));
});

test('Alipay page generation rejects foreign, duplicate, malformed or injected return and notification locations', async () => {
  let calls = 0; const opts = options(async () => { calls++; throw new Error('unexpected network request'); });
  for (const returnUrl of [undefined, '', 'javascript:alert(1)', 'http://paperknow.cn/api/payments/return/alipay?order=10d38a6d-174b-4eaa-898c-24db817c7f76', alipayOrder.returnUrl.replace('paperknow.cn', 'paperknow.cn.evil.example'), alipayOrder.returnUrl.replace('paperknow.cn', 'user@paperknow.cn'), alipayOrder.returnUrl + '&next=https://evil.example', alipayOrder.returnUrl + '&order=another-order', alipayOrder.returnUrl + '#fragment', alipayOrder.returnUrl.replace('10d38a6d-174b-4eaa-898c-24db817c7f76', 'not-a-uuid')]) {
    await assert.rejects(createProviderPayment('alipay', settings.alipay, { ...alipayOrder, returnUrl }, opts), safeError('payment_order_invalid'));
  }
  for (const invalid of [{ notifyUrl: 'https://evil.example/notify' }, { notifyUrl: order.notifyUrl }, { title: 'bad\nheader' }, { outTradeNo: 'order-with-dashes' }, { amountCents: 9.7 }]) await assert.rejects(createProviderPayment('alipay', settings.alipay, { ...alipayOrder, ...invalid }, opts), safeError('payment_order_invalid'));
  assert.equal(calls, 0);
});

test('Alipay handoff validation refuses URL injection, duplicate parameters and disagreement with the immutable order', async () => {
  const { paymentUrl } = await createProviderPayment('alipay', settings.alipay, alipayOrder, { now });
  const expected = { ...alipayOrder, appId: settings.alipay.appId, sellerId: settings.alipay.sellerId };
  assert.equal(validateAlipayPaymentURL(paymentUrl), true);
  for (const invalid of ['javascript:alert(1)', paymentUrl.replace('https://', 'http://'), paymentUrl.replace('openapi.alipay.com', 'openapi.alipay.com.evil.example'), paymentUrl.replace('openapi.alipay.com', 'user@openapi.alipay.com'), paymentUrl.replace('/gateway.do', '/other'), paymentUrl + '#fragment', paymentUrl + '&method=alipay.trade.pay', paymentUrl + '&return_url=https://evil.example', paymentUrl + '&extra=unapproved']) assert.equal(validateAlipayPaymentURL(invalid, expected), false);
  for (const [name, value] of [['method', 'alipay.trade.precreate'], ['app_id', '2021999999999999'], ['sign', 'invalid'], ['return_url', 'https://evil.example'], ['notify_url', 'https://evil.example/notify'], ['timestamp', '2026-02-30 12:00:00']]) {
    const modified = new URL(paymentUrl); modified.searchParams.set(name, value); assert.equal(validateAlipayPaymentURL(modified.href, expected), false);
  }
  for (const override of [{ amountCents: 1 }, { outTradeNo: 'another-order' }, { title: 'another title' }, { appId: '2021999999999999' }, { sellerId: '2088999999999999' }, { expiresAt: '2026-10-15T04:31:00.000Z' }]) assert.equal(validateAlipayPaymentURL(paymentUrl, { ...expected, ...override }), false);
  for (const override of [{ total_amount: '0.01' }, { product_code: 'QUICK_WAP_WAY' }, { seller_id: '2088999999999999' }, { time_expire: '2026-10-15 12:00:00' }, { time_expire: '2026-02-30 12:00:00' }, { total_amount: '9.7e0' }, { extra: 'not allowed' }]) {
    const modified = new URL(paymentUrl), biz = JSON.parse(modified.searchParams.get('biz_content')); modified.searchParams.set('biz_content', JSON.stringify({ ...biz, ...override })); assert.equal(validateAlipayPaymentURL(modified.href, expected), false);
  }
  const duplicate = new URL(paymentUrl), biz = duplicate.searchParams.get('biz_content'); duplicate.searchParams.set('biz_content', biz.slice(0, -1) + ',"total_amount":"9.70"}'); assert.equal(validateAlipayPaymentURL(duplicate.href, expected), false);
});

test('Alipay page titles remain encoded data, including quotes, ampersands and HTML-like input', async () => {
  const title = '<img src=x onerror="alert(1)"> & 论文 + "a"';
  const { paymentUrl } = await createProviderPayment('alipay', settings.alipay, { ...alipayOrder, title }, { now });
  assert.ok(!paymentUrl.includes('<img')); assert.equal(JSON.parse(new URL(paymentUrl).searchParams.get('biz_content')).subject, title);
  assert.equal(validateAlipayPaymentURL(paymentUrl, { ...alipayOrder, title }), true);
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

test('Alipay reports an absent remote trade distinctly only after verifying the signed response', async () => {
  const raw = JSON.stringify({ code: '40004', msg: 'Business Failed', sub_code: 'ACQ.TRADE_NOT_EXIST', sub_msg: 'trade does not exist' });
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw))), safeError('payment_trade_not_exist'));
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', raw, { sign: signature(raw, merchant.privateKey) }))), safeError('payment_signature_invalid'));
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => new Response(JSON.stringify({ alipay_trade_query_response: JSON.parse(raw) })))), safeError('payment_response_invalid'));
  const otherError = JSON.stringify({ code: '40004', sub_code: 'ACQ.ACCESS_FORBIDDEN' });
  await assert.rejects(queryProviderPayment('alipay', settings.alipay, order, options(async () => alipayResponse('alipay.trade.query', otherError))), safeError('payment_provider_unavailable'));
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
});


test('Alipay QR front-loading derives a stable official RSA2 request for the identical frozen order only', async () => {
  const { paymentUrl } = await createProviderPayment('alipay', settings.alipay, alipayOrder, { now });
  const expected = { ...alipayOrder, appId: settings.alipay.appId, sellerId: settings.alipay.sellerId };
  const qrUrl = deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, expected, { now });
  assert.equal(typeof qrUrl, 'string'); assert.equal(validateAlipayQRPaymentURL(qrUrl, expected), true);
  assert.equal(validateAlipayPaymentURL(qrUrl, expected), false, 'ordinary page links retain their six-field contract');
  assert.equal(validateAlipayQRPaymentURL(paymentUrl, expected), false);
  assert.equal(deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, expected, { now: nowValue + 60_000 }), qrUrl, 'polls do not refresh timestamps or expiry');
  const original = new URL(paymentUrl), qr = new URL(qrUrl), fields = Object.fromEntries(qr.searchParams);
  assert.deepEqual([...qr.searchParams.keys()], [...original.searchParams.keys()]);
  for (const [key, value] of original.searchParams) if (!['biz_content', 'sign'].includes(key)) assert.equal(qr.searchParams.get(key), value);
  assert.deepEqual(JSON.parse(fields.biz_content), { ...JSON.parse(original.searchParams.get('biz_content')), qr_pay_mode: '4', qrcode_width: '244' });
  const signed = Object.keys(fields).filter(key => key !== 'sign').sort().map(key => `${key}=${fields[key]}`).join('&');
  assert.ok(verify('RSA-SHA256', Buffer.from(signed), merchant.publicKey, Buffer.from(fields.sign, 'base64')));
  assert.equal(verify('RSA-SHA256', Buffer.from(signed), merchant.publicKey, Buffer.from(original.searchParams.get('sign'), 'base64')), false);
  assert.ok(!qrUrl.includes('PRIVATE KEY')); assert.ok(!qrUrl.includes(settings.alipay.privateKey));
});

test('Alipay QR derivation rejects tampered signatures, mismatched frozen identities, invalid keys and expiry', async () => {
  const { paymentUrl } = await createProviderPayment('alipay', settings.alipay, alipayOrder, { now });
  const expected = { ...alipayOrder, appId: settings.alipay.appId, sellerId: settings.alipay.sellerId };
  for (const invalid of [
    { ...settings.alipay, appId: '2021999999999999' }, { ...settings.alipay, sellerId: '2088999999999999' },
    { ...settings.alipay, privateKey: platform.privateKey }, { ...settings.alipay, privateKey: '' },
  ]) assert.equal(deriveAlipayQRPaymentURL(paymentUrl, invalid, expected, { now }), null);
  for (const override of [{ amountCents: 1 }, { title: 'changed' }, { outTradeNo: 'different_order' }, { appId: '2021999999999999' }, { sellerId: '2088999999999999' }, { expiresAt: '2026-10-15T04:31:00.000Z' }, { notifyUrl: 'https://evil.example' }, { returnUrl: 'https://evil.example' }]) {
    assert.equal(deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, { ...expected, ...override }, { now }), null);
  }
  const tampered = new URL(paymentUrl); tampered.searchParams.set('sign', signature('not the page request', merchant.privateKey));
  assert.equal(validateAlipayPaymentURL(tampered.href, expected), true, 'shape-valid signatures still require cryptographic verification before derivation');
  assert.equal(deriveAlipayQRPaymentURL(tampered.href, settings.alipay, expected, { now }), null);
  const changedTitle = new URL(paymentUrl), biz = JSON.parse(changedTitle.searchParams.get('biz_content')); biz.subject = 'changed'; changedTitle.searchParams.set('biz_content', JSON.stringify(biz));
  assert.equal(deriveAlipayQRPaymentURL(changedTitle.href, settings.alipay, { ...expected, title: 'changed' }, { now }), null);
  assert.equal(deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, expected, { now: Date.parse(alipayOrder.expiresAt) }), null);
  assert.equal(deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, expected, { now: Date.parse(alipayOrder.expiresAt) + 1 }), null);
});

test('Alipay QR validation accepts only the fixed front-loading mode and size without relaxing URL or order checks', async () => {
  const { paymentUrl } = await createProviderPayment('alipay', settings.alipay, alipayOrder, { now });
  const expected = { ...alipayOrder, appId: settings.alipay.appId, sellerId: settings.alipay.sellerId };
  const qrUrl = deriveAlipayQRPaymentURL(paymentUrl, settings.alipay, expected, { now });
  for (const override of [{ qr_pay_mode: '0' }, { qr_pay_mode: 4 }, { qrcode_width: '245' }, { qrcode_width: 244 }, { total_amount: '0.01' }, { seller_id: '2088999999999999' }, { extra: 'bad' }]) {
    const changed = new URL(qrUrl), biz = JSON.parse(changed.searchParams.get('biz_content')); changed.searchParams.set('biz_content', JSON.stringify({ ...biz, ...override }));
    assert.equal(validateAlipayQRPaymentURL(changed.href, expected), false);
  }
  for (const invalid of [qrUrl.replace('https://', 'http://'), qrUrl.replace('openapi.alipay.com', 'evil.example'), qrUrl + '&method=alipay.trade.page.pay', qrUrl + '&extra=bad', qrUrl + '#fragment']) assert.equal(validateAlipayQRPaymentURL(invalid, expected), false);
  const duplicate = new URL(qrUrl), biz = duplicate.searchParams.get('biz_content'); duplicate.searchParams.set('biz_content', biz.slice(0, -1) + ',"qr_pay_mode":"4"}');
  assert.equal(validateAlipayQRPaymentURL(duplicate.href, expected), false);
});
