import { createPrivateKey, createPublicKey, createDecipheriv, randomBytes, sign, verify } from 'node:crypto';

// Direct merchant integrations. Never accept a configurable gateway or unsigned result.
// WeChat Native / public-key verification:
// https://pay.wechatpay.cn/doc/v3/merchant/4012791877
// https://pay.wechatpay.cn/doc/v3/merchant/4013053249
// Alipay OpenAPI RSA2 and raw-response / callback signing reference:
// https://github.com/alipay/alipay-sdk-nodejs-all
const WECHAT_HOST = 'https://api.mch.weixin.qq.com';
const ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 20_000;
const messages = {
  payment_provider_invalid: '不支持的支付渠道',
  payment_configuration_invalid: '支付渠道配置未完整或格式不正确，请联系管理员',
  payment_order_invalid: '支付订单参数不正确',
  payment_signature_invalid: '支付渠道签名验证失败，请稍后重试',
  payment_response_invalid: '支付渠道返回的数据不完整，请稍后重试',
  payment_provider_unavailable: '支付渠道暂时不可用，请稍后重试',
  payment_timeout: '支付渠道响应超时，请查询订单后重试',
};

function fail(code) { const error = new Error(messages[code]); error.code = code; throw error; }
function safeError(error) { if (error?.code && Object.hasOwn(messages, error.code)) throw error; fail('payment_provider_unavailable'); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function keyObject(value, kind) {
  const normalized = text(value).replace(/\\n/g, '\n');
  if (!normalized || normalized.length > 20_000) throw new Error('key');
  const read = kind === 'private' ? createPrivateKey : createPublicKey;
  const candidates = normalized.includes('-----BEGIN ') ? [normalized] : kind === 'private'
    ? ['PRIVATE KEY', 'RSA PRIVATE KEY'].map(type => `-----BEGIN ${type}-----\n${normalized}\n-----END ${type}-----`)
    : [`-----BEGIN PUBLIC KEY-----\n${normalized}\n-----END PUBLIC KEY-----`];
  for (const pem of candidates) {
    try {
      const key = read(pem);
      if (key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 2048) return key;
    } catch { /* Try the other supported PEM envelope. */ }
  }
  throw new Error('key');
}

export function validateProvider(provider, settings = {}) {
  if (!['wechat', 'alipay'].includes(provider)) return [{ field: 'provider', message: messages.payment_provider_invalid }];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  const issues = [];
  const required = provider === 'wechat'
    ? ['appId', 'merchantId', 'merchantSerial', 'privateKey', 'apiV3Key', 'platformPublicKeyId', 'platformPublicKey']
    : ['appId', 'privateKey', 'alipayPublicKey', 'sellerId'];
  for (const field of required) if (!text(settings[field])) issues.push({ field, message: '此项尚未配置' });
  const check = (field, valid, message) => { if (text(settings[field]) && !valid) issues.push({ field, message }); };
  check('appId', provider === 'wechat' ? /^wx[A-Za-z0-9]{16}$/.test(text(settings.appId)) : /^\d{12,32}$/.test(text(settings.appId)), '应用 ID 格式不正确');
  if (provider === 'wechat') {
    check('merchantId', /^\d{6,32}$/.test(text(settings.merchantId)), '商户号格式不正确');
    check('merchantSerial', /^[A-Fa-f0-9]{16,64}$/.test(text(settings.merchantSerial)), '商户证书序列号格式不正确');
    check('apiV3Key', typeof settings.apiV3Key === 'string' && Buffer.byteLength(settings.apiV3Key, 'utf8') === 32 && /^[\x21-\x7e]{32}$/.test(settings.apiV3Key), 'API v3 密钥应为 32 位 ASCII 字符');
    check('platformPublicKeyId', /^PUB_KEY_ID_\d{5,80}$/.test(text(settings.platformPublicKeyId)), '微信支付公钥 ID 格式不正确');
  } else check('sellerId', /^\d{10,32}$/.test(text(settings.sellerId)), '收款支付宝账号 UID 格式不正确');
  for (const field of ['privateKey', provider === 'wechat' ? 'platformPublicKey' : 'alipayPublicKey']) {
    if (!text(settings[field])) continue;
    try { keyObject(settings[field], field === 'privateKey' ? 'private' : 'public'); }
    catch { issues.push({ field, message: '请填写有效的 RSA 密钥（至少 2048 位）' }); }
  }
  return issues;
}

function assertSettings(provider, settings) {
  if (!['wechat', 'alipay'].includes(provider)) fail('payment_provider_invalid');
  if (validateProvider(provider, settings).length) fail('payment_configuration_invalid');
}
function nowMs(options) { const value = typeof options.now === 'function' ? options.now() : (options.now ?? Date.now()); if (!Number.isFinite(value)) fail('payment_order_invalid'); return value; }
function checkOrder(provider, order, create = false) {
  if (!order || !new RegExp(`^[A-Za-z0-9_*\\-]{1,${provider === 'wechat' ? 32 : 64}}$`).test(order.outTradeNo || '')) fail('payment_order_invalid');
  if (create) {
    if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0 || order.amountCents > 100_000_000 || !text(order.title) || Buffer.byteLength(order.title, 'utf8') > 127) fail('payment_order_invalid');
    let notify;
    try { notify = new URL(order.notifyUrl); } catch { fail('payment_order_invalid'); }
    if (notify.protocol !== 'https:' || notify.username || notify.password || notify.hash) fail('payment_order_invalid');
  }
}
function parseJSON(body) { try { const parsed = JSON.parse(body); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('payment_response_invalid'); return parsed; } catch { fail('payment_response_invalid'); } }
function rawText(rawBody) { if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) || Buffer.byteLength(rawBody) > MAX_BODY_BYTES) fail('payment_response_invalid'); return String(rawBody); }
function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  const matches = Object.entries(headers || {}).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || typeof matches[0][1] !== 'string') return '';
  return matches[0][1];
}
function verifyRSA(content, signature, publicKey) {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 2048 || !verify('RSA-SHA256', Buffer.from(content, 'utf8'), keyObject(publicKey, 'public'), Buffer.from(signature, 'base64'))) fail('payment_signature_invalid');
  } catch { fail('payment_signature_invalid'); }
}
function signRSA(content, privateKey) { return sign('RSA-SHA256', Buffer.from(content, 'utf8'), keyObject(privateKey, 'private')).toString('base64'); }

async function fetchText(url, init, options) {
  const controller = new AbortController();
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, Number(options.timeoutMs) || MAX_TIMEOUT_MS));
  let timer;
  const timedOut = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const error = new Error(messages.payment_timeout); error.code = 'payment_timeout'; reject(error); }, timeoutMs); });
  try {
    return await Promise.race([timedOut, (async () => {
      const response = await (options.fetchImpl || fetch)(url, { ...init, signal: controller.signal, redirect: 'error' });
      const size = Number(header(response.headers, 'content-length'));
      if (size > MAX_BODY_BYTES) fail('payment_response_invalid');
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let length = 0;
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_BODY_BYTES) { await reader.cancel(); fail('payment_response_invalid'); }
          chunks.push(chunk.value);
        }
        body = Buffer.concat(chunks).toString('utf8');
      } else body = rawText(await response.text());
      return { response, body };
    })()]);
  } catch (error) { safeError(error); }
  finally { clearTimeout(timer); }
}

function verifyWechat(settings, headers, body, options) {
  const timestamp = header(headers, 'Wechatpay-Timestamp');
  const nonce = header(headers, 'Wechatpay-Nonce');
  if (!/^\d{10}$/.test(timestamp) || Math.abs(nowMs(options) / 1000 - Number(timestamp)) > 300 || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)
      || header(headers, 'Wechatpay-Serial') !== text(settings.platformPublicKeyId)) fail('payment_signature_invalid');
  const type = header(headers, 'Wechatpay-Signature-Type');
  if (type && type !== 'WECHATPAY2-SHA256-RSA2048') fail('payment_signature_invalid');
  verifyRSA(`${timestamp}\n${nonce}\n${body}\n`, header(headers, 'Wechatpay-Signature'), settings.platformPublicKey);
}
async function wechatRequest(settings, method, path, payload, options) {
  const body = payload ? JSON.stringify(payload) : '';
  const timestamp = String(Math.floor(nowMs(options) / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signature = signRSA(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, settings.privateKey);
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${text(settings.merchantId)}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${text(settings.merchantSerial)}",signature="${signature}"`;
  const result = await fetchText(`${WECHAT_HOST}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization, 'Wechatpay-Serial': text(settings.platformPublicKeyId) }, ...(body ? { body } : {}) }, options);
  verifyWechat(settings, result.response.headers, result.body, options);
  if (!result.response.ok) fail('payment_provider_unavailable');
  return parseJSON(result.body);
}

function sortedParams(parameters, excluded = ['sign']) { return Object.keys(parameters).filter(key => !excluded.includes(key) && parameters[key] !== '').sort().map(key => `${key}=${parameters[key]}`).join('&'); }
function chinaTime(ms) { return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' '); }
function valueEnd(source, start) {
  let depth = 0; let quoted = false; let escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (depth === 0) return i; depth--; }
    else if (c === ',' && depth === 0) return i;
  }
  fail('payment_response_invalid');
}
// Keep the exact signed JSON object bytes, including whitespace and decimal literals.
function responseSlice(source, expected) {
  const root = parseJSON(source); let i = source.indexOf('{') + 1; const seen = new Set(); let found;
  while (i < source.length) {
    while (/\s/.test(source[i] || '') && i < source.length) i++;
    if (source[i] === '}') break;
    const match = /^"(?:[^"\\]|\\.)*"/.exec(source.slice(i));
    if (!match) fail('payment_response_invalid');
    const key = JSON.parse(match[0]); if (seen.has(key)) fail('payment_response_invalid'); seen.add(key); i += match[0].length;
    while (/\s/.test(source[i] || '') && i < source.length) i++;
    if (source[i++] !== ':') fail('payment_response_invalid');
    while (/\s/.test(source[i] || '') && i < source.length) i++;
    const end = valueEnd(source, i);
    if (key === expected) found = source.slice(i, end).trimEnd();
    i = end; if (source[i] === ',') i++; else if (source[i] === '}') break; else fail('payment_response_invalid');
  }
  if (!found || typeof root[expected] !== 'object' || !root[expected] || Array.isArray(root[expected]) || typeof root.sign !== 'string') fail('payment_response_invalid');
  return { signed: found, data: root[expected], signature: root.sign };
}
async function alipayRequest(settings, method, bizContent, notifyUrl, options) {
  const parameters = { app_id: text(settings.appId), method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', timestamp: chinaTime(nowMs(options)), version: '1.0', biz_content: JSON.stringify(bizContent), ...(notifyUrl ? { notify_url: notifyUrl } : {}) };
  parameters.sign = signRSA(sortedParams(parameters), settings.privateKey);
  const { response, body } = await fetchText(ALIPAY_GATEWAY, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(parameters).toString() }, options);
  if (!response.ok) fail('payment_provider_unavailable');
  const parsed = responseSlice(body, `${method.replaceAll('.', '_')}_response`);
  verifyRSA(parsed.signed, parsed.signature, settings.alipayPublicKey);
  if (parsed.data.code !== '10000') fail('payment_provider_unavailable');
  return parsed.data;
}
function yuan(cents) { return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`; }
function cents(value) {
  // Do not round provider amounts or use floating point multiplication.
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value)) fail('payment_response_invalid');
  const [whole, fraction = ''] = value.split('.'); const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 0) fail('payment_response_invalid'); return amount;
}
function requireString(value, max = 128) { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value)) fail('payment_response_invalid'); return value; }
function paidTime(value, alipay = false) {
  if (!value) return undefined;
  const formatted = alipay ? `${requireString(value).replace(' ', 'T')}+08:00` : requireString(value);
  const parsed = Date.parse(formatted); if (!Number.isFinite(parsed)) fail('payment_response_invalid'); return new Date(parsed).toISOString();
}
function wechatResult(data) {
  const states = { SUCCESS: 'paid', NOTPAY: 'pending', USERPAYING: 'pending', ACCEPT: 'pending', CLOSED: 'closed', REVOKED: 'closed', REFUND: 'closed', PAYERROR: 'failed' };
  if (!Object.hasOwn(states, data.trade_state) || !Number.isSafeInteger(data.amount?.total) || data.amount.total < 0 || data.amount.currency !== 'CNY') fail('payment_response_invalid');
  const state = states[data.trade_state];
  const result = { state, amountCents: data.amount.total, currency: 'CNY', merchantId: requireString(data.mchid), appId: requireString(data.appid), outTradeNo: requireString(data.out_trade_no, 32) };
  if (data.transaction_id) result.providerTradeNo = requireString(data.transaction_id);
  if (state === 'paid' && !result.providerTradeNo) fail('payment_response_invalid');
  if (data.success_time) result.paidAt = paidTime(data.success_time);
  return result;
}
function alipayResult(data, settings, notification = false) {
  const states = { TRADE_SUCCESS: 'paid', TRADE_FINISHED: 'paid', WAIT_BUYER_PAY: 'pending', TRADE_CLOSED: 'closed' };
  if (!Object.hasOwn(states, data.trade_status) || (data.trans_currency && data.trans_currency !== 'CNY')) fail('payment_response_invalid');
  const result = { state: states[data.trade_status], amountCents: cents(data.total_amount), currency: 'CNY', merchantId: requireString(notification ? data.seller_id : (data.seller_id || text(settings.sellerId))), appId: requireString(notification ? data.app_id : (data.app_id || text(settings.appId))), outTradeNo: requireString(data.out_trade_no, 64) };
  if (data.trade_no) result.providerTradeNo = requireString(data.trade_no);
  if (result.state === 'paid' && !result.providerTradeNo) fail('payment_response_invalid');
  const time = data.gmt_payment || data.send_pay_date; if (time) result.paidAt = paidTime(time, true);
  return result;
}

export async function createProviderPayment(provider, settings, order, options = {}) {
  try {
    assertSettings(provider, settings); checkOrder(provider, order, true);
    const current = nowMs(options); const expires = order.expiresAt ? new Date(order.expiresAt).getTime() : current + 30 * 60_000;
    if (!Number.isFinite(expires) || expires <= current || expires > current + 24 * 3_600_000) fail('payment_order_invalid');
    const expiresAt = new Date(expires).toISOString();
    if (provider === 'wechat') {
      const data = await wechatRequest(settings, 'POST', '/v3/pay/transactions/native', { appid: text(settings.appId), mchid: text(settings.merchantId), description: order.title, out_trade_no: order.outTradeNo, notify_url: order.notifyUrl, time_expire: expiresAt, amount: { total: order.amountCents, currency: 'CNY' } }, options);
      if (typeof data.code_url !== 'string' || !/^weixin:\/\/wxpay\/bizpayurl\?[^\s]{1,1900}$/.test(data.code_url)) fail('payment_response_invalid');
      return { qrContent: data.code_url, expiresAt };
    }
    const data = await alipayRequest(settings, 'alipay.trade.precreate', { out_trade_no: order.outTradeNo, total_amount: yuan(order.amountCents), subject: order.title, seller_id: text(settings.sellerId), timeout_express: `${Math.ceil((expires - current) / 60_000)}m` }, order.notifyUrl, options);
    if (data.out_trade_no !== order.outTradeNo || typeof data.qr_code !== 'string' || !/^https:\/\/qr\.alipay\.com\/[^\s]{1,1900}$/.test(data.qr_code)) fail('payment_response_invalid');
    return { qrContent: data.qr_code, expiresAt };
  } catch (error) { safeError(error); }
}

export async function queryProviderPayment(provider, settings, order, options = {}) {
  try {
    assertSettings(provider, settings); checkOrder(provider, order);
    if (provider === 'wechat') return wechatResult(await wechatRequest(settings, 'GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.outTradeNo)}?mchid=${encodeURIComponent(text(settings.merchantId))}`, undefined, options));
    return alipayResult(await alipayRequest(settings, 'alipay.trade.query', { out_trade_no: order.outTradeNo }, undefined, options), settings);
  } catch (error) { safeError(error); }
}

export async function parseProviderNotification(provider, settings, { headers, rawBody }, options = {}) {
  try {
    assertSettings(provider, settings); const body = rawText(rawBody);
    if (provider === 'wechat') {
      verifyWechat(settings, headers, body, options);
      const envelope = parseJSON(body); const resource = envelope.resource;
      if (envelope.event_type !== 'TRANSACTION.SUCCESS' || envelope.resource_type !== 'encrypt-resource' || resource?.algorithm !== 'AEAD_AES_256_GCM' || resource.original_type !== 'transaction') fail('payment_response_invalid');
      if (typeof resource.nonce !== 'string' || Buffer.byteLength(resource.nonce) !== 12 || typeof resource.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(resource.ciphertext) || typeof resource.associated_data !== 'string') fail('payment_response_invalid');
      const encrypted = Buffer.from(resource.ciphertext, 'base64'); if (encrypted.length <= 16) fail('payment_response_invalid');
      let plaintext;
      try {
        const decipher = createDecipheriv('aes-256-gcm', Buffer.from(settings.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
        decipher.setAAD(Buffer.from(resource.associated_data, 'utf8')); decipher.setAuthTag(encrypted.subarray(-16));
        plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8');
      } catch { fail('payment_signature_invalid'); }
      const result = wechatResult(parseJSON(plaintext)); if (result.state !== 'paid') fail('payment_response_invalid'); return result;
    }
    const parameters = Object.create(null); const form = new URLSearchParams(body);
    for (const [key, value] of form) { if (Object.hasOwn(parameters, key)) fail('payment_response_invalid'); parameters[key] = value; }
    if (parameters.sign_type !== 'RSA2' || (parameters.charset && parameters.charset.toLowerCase() !== 'utf-8')) fail('payment_signature_invalid');
    verifyRSA(sortedParams(parameters, ['sign', 'sign_type']), parameters.sign || '', settings.alipayPublicKey);
    return alipayResult(parameters, settings, true);
  } catch (error) { safeError(error); }
}
