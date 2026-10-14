import { accountDestination } from './account-routes.mjs';
const allowedDestinations = new Set(['/workspace.html', '/service.html', '/admin.html']);

export function safeNext(value, origin) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/workspace.html#home';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !allowedDestinations.has(url.pathname)) return '/workspace.html#home';
    if (url.pathname === '/service.html') return accountDestination(url.searchParams.get('view'), url.searchParams.get('result'));
    return url.pathname + url.search + url.hash;
  } catch { return '/workspace.html#home'; }
}

export function createAuthPage(doc, { navigate, requestTimeoutMs = 30_000 } = {}) {
  const win = doc.defaultView;
  const $ = selector => doc.querySelector(selector);
  const go = navigate || (destination => win.location.replace(destination));
  const params = new URLSearchParams(win.location.search);
  const next = safeNext(params.get('next'), win.location.origin);
  let mode = ['register', 'reset'].includes(params.get('mode')) ? params.get('mode') : 'login';
  let channel = params.get('channel') === 'phone' ? 'phone' : 'email';
  let method = params.get('method') === 'code' ? 'code' : 'password';
  let options = { password: true, emailCode: false, phoneCode: false, registration: { email: false, phone: false } };
  let challenge = null;
  let revision = 0;
  let sending = false;
  let submitting = false;
  let ready = false;
  const cooldowns = new Map();
  let ticker;

  const address = () => channel === 'email' ? $('#auth-address').value.trim().toLowerCase() : $('#auth-address').value.replace(/\s+/g, '').replace(/^\+86/, '');
  const purpose = () => mode === 'reset' ? 'reset' : mode === 'register' ? 'register' : 'login';
  const identityKey = () => [channel, address(), purpose()].join(':');
  const deliveryKey = () => [channel, address()].join(':');
  const usesCode = () => mode !== 'login' || method === 'code';
  const canSend = () => Boolean(options[channel === 'email' ? 'emailCode' : 'phoneCode']) && (mode !== 'register' || Boolean(options.registration?.[channel]));
  const remaining = () => Math.max(0, Math.ceil(((cooldowns.get(deliveryKey()) || 0) - Date.now()) / 1000));

  function message(kind, text = '') {
    const el = $(kind === 'error' ? '#auth-error' : '#auth-status');
    el.textContent = text;
    el.hidden = !text;
  }
  function clearMessages() {
    message('error'); message('status');
    doc.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  }
  function invalidateChallenge() {
    revision++;
    challenge = null;
    $('#auth-code').value = '';
    $('#code-hint').textContent = '验证码仅用于验证本次账户操作。';
    clearMessages();
    updateControls();
  }
  function updateControls() {
    const seconds = remaining();
    $('#send-code').disabled = !ready || sending || submitting || !canSend() || seconds > 0;
    $('#send-code').textContent = sending ? '正在发送…' : seconds > 0 ? `${seconds}s 后重发` : '获取验证码';
    $('#auth-submit').disabled = !ready || sending || submitting || (usesCode() && !canSend());
    $('#submit-label').textContent = submitting ? (mode === 'reset' ? '正在重置…' : '正在验证…') : mode === 'register' ? '创建账户' : mode === 'reset' ? '重置密码' : '登录';
    $('#auth-form').setAttribute('aria-busy', String(submitting || sending));
    doc.querySelectorAll('[data-channel], #switch-method, #switch-mode, #forgot-password').forEach(el => { el.disabled = submitting; });
    ['#auth-address', '#auth-password', '#auth-name', '#auth-code'].forEach(selector => { $(selector).readOnly = submitting; });
    const unavailable = ready && usesCode() && !canSend();
    $('#availability-note').hidden = !unavailable;
    $('#availability-note').textContent = unavailable ? `${channel === 'email' ? '邮件' : '短信'}验证码服务暂未开放。已有账户可以使用密码登录。` : '';
  }
  function render() {
    const login = mode === 'login';
    const register = mode === 'register';
    const phone = channel === 'phone';
    doc.title = `${register ? '注册' : login ? '登录' : '重置密码'} · PaperKnow`;
    $('#auth-title').textContent = register ? '创建你的账户' : login ? '欢迎回来' : '找回密码';
    $('#auth-subtitle').textContent = register ? '从这里开始，让研究一步步成为成果。' : login ? '登录 PaperKnow，继续未完成的研究。' : '验证账户身份，设置一个新的登录密码。';
    $('#auth-form').setAttribute('aria-labelledby', `${channel}-tab`);
    doc.querySelectorAll('[data-channel]').forEach(tab => {
      const active = tab.dataset.channel === channel;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $('#method-row').hidden = !login;
    $('#method-label').textContent = method === 'password' ? '密码登录' : '验证码登录';
    $('#switch-method').textContent = method === 'password' ? '使用验证码登录 ↔' : '使用密码登录 ↔';
    $('#name-field').hidden = !register;
    $('#auth-name').required = register;
    $('#address-label').textContent = phone ? '手机号' : '邮箱地址';
    $('#auth-address').type = phone ? 'tel' : 'email';
    $('#auth-address').inputMode = phone ? 'tel' : 'email';
    $('#auth-address').maxLength = phone ? 14 : 254;
    $('#auth-address').placeholder = phone ? '请输入手机号' : '请输入邮箱地址';
    $('#phone-prefix').hidden = !phone;
    $('#channel-hint').hidden = !phone;
    $('#code-field').hidden = !usesCode();
    $('#auth-code').required = usesCode();
    $('#password-field').hidden = login && method === 'code';
    $('#auth-password').required = !(login && method === 'code');
    $('#auth-password').autocomplete = login ? 'current-password' : 'new-password';
    $('#password-label').textContent = login ? '密码' : mode === 'reset' ? '新密码' : '设置密码';
    $('#auth-password').placeholder = login ? '请输入密码' : '设置 10–128 位密码';
    $('#forgot-password').hidden = !login;
    $('#password-hint').hidden = login;
    $('#switch-copy').textContent = login ? '还没有账户？' : register ? '已有账户？' : '记起密码了？';
    $('#switch-mode').textContent = login ? '创建账户' : '返回登录';
    updateControls();
  }
  async function request(path, data) {
    const Controller = win.AbortController || globalThis.AbortController;
    const controller = new Controller();
    let timedOut = false;
    const timeout = win.setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    try {
      let response;
      try {
        response = await win.fetch('/api/auth/' + path, {
          method: data === undefined ? 'GET' : 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: data === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: data === undefined ? undefined : JSON.stringify(data)
        });
      } catch { throw new Error(timedOut ? '请求超时，请稍后重试。' : '暂时无法连接服务，请检查网络后重试。'); }
      let result;
      try { result = await response.json(); } catch { throw new Error(timedOut ? '请求超时，请稍后重试。' : '服务暂时不可用，请稍后重试。'); }
      if (!response.ok) {
        const error = new Error(typeof result.error === 'string' ? result.error : '操作未完成，请稍后重试。');
        error.retryAfter = Number(response.headers?.get?.('Retry-After') || result.retryAfter || 0);
        throw error;
      }
      return result;
    } finally { win.clearTimeout(timeout); }
  }
  function invalid(selector, text) {
    $(selector).setAttribute('aria-invalid', 'true');
    $(selector).focus();
    throw new Error(text);
  }
  function validateAddress() {
    if (channel === 'phone' && !/^1[3-9]\d{9}$/.test(address())) invalid('#auth-address', '请输入有效的中国大陆手机号。');
    if (channel === 'email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address()) || address().length > 254)) invalid('#auth-address', '请输入有效的邮箱地址。');
  }
  function changeMode(value) {
    mode = value;
    method = 'password';
    $('#auth-password').value = '';
    $('#auth-password').type = 'password';
    $('#toggle-password').setAttribute('aria-label', '显示密码');
    $('#toggle-password').setAttribute('aria-pressed', 'false');
    invalidateChallenge();
    render();
    const url = new URL(win.location.href);
    url.searchParams.set('mode', mode);
    win.history.replaceState(null, '', url.pathname + url.search);
  }
  doc.querySelectorAll('[data-channel]').forEach(tab => {
    tab.addEventListener('click', () => {
      if (channel === tab.dataset.channel || submitting) return;
      channel = tab.dataset.channel;
      $('#auth-address').value = '';
      $('#auth-password').value = '';
      invalidateChallenge(); render();
      $('#auth-address').focus();
    });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? $('#email-tab') : event.key === 'End' ? $('#phone-tab') : $(`#${channel === 'phone' ? 'email' : 'phone'}-tab`);
      target.click(); target.focus();
    });
  });
  $('#auth-address').addEventListener('input', invalidateChallenge);
  $('#auth-code').addEventListener('input', () => {
    $('#auth-code').value = $('#auth-code').value.replace(/\D/g, '').slice(0, 6);
    $('#auth-code').removeAttribute('aria-invalid');
    message('error');
  });
  $('#switch-method').addEventListener('click', () => {
    method = method === 'password' ? 'code' : 'password';
    $('#auth-password').value = '';
    invalidateChallenge(); render();
  });
  $('#switch-mode').addEventListener('click', () => changeMode(mode === 'login' ? 'register' : 'login'));
  $('#forgot-password').addEventListener('click', () => changeMode('reset'));
  $('#toggle-password').addEventListener('click', () => {
    const visible = $('#auth-password').type === 'password';
    $('#auth-password').type = visible ? 'text' : 'password';
    $('#toggle-password').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    $('#toggle-password').setAttribute('aria-pressed', String(visible));
  });
  $('#send-code').addEventListener('click', async () => {
    if (sending || submitting || !canSend() || remaining()) return;
    clearMessages();
    try { validateAddress(); } catch (error) { message('error', error.message); return; }
    const ticket = revision;
    const key = identityKey();
    const cooldownKey = deliveryKey();
    const payload = { channel, address: address(), purpose: purpose() };
    sending = true; updateControls();
    try {
      const result = await request('code/send', payload);
      cooldowns.set(cooldownKey, Date.now() + Math.max(1, Number(result.retryAfter) || 60) * 1000);
      if (revision !== ticket || key !== identityKey()) return;
      if (!result.challengeId) throw new Error('验证码发送未完成，请稍后重试。');
      challenge = { id: result.challengeId, key, expiresAt: Date.now() + (Number(result.expiresIn) || 300) * 1000 };
      const minutes = Math.ceil((Number(result.expiresIn) || 300) / 60);
      $('#code-hint').textContent = `已发送验证码，${minutes} 分钟内有效。${channel === 'email' ? '未收到时请检查垃圾邮件。' : '请留意手机短信。'}`;
      message('status', '验证码已发送，请查收。');
      $('#auth-code').focus();
    } catch (error) {
      if (error.retryAfter > 0) cooldowns.set(cooldownKey, Date.now() + error.retryAfter * 1000);
      if (revision === ticket) message('error', error.message);
    } finally { sending = false; updateControls(); }
  });
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || sending || submitting || (usesCode() && !canSend())) return;
    clearMessages();
    try {
      validateAddress();
      if (mode === 'register' && !$('#auth-name').value.trim()) invalid('#auth-name', '请填写昵称。');
      if (usesCode()) {
        if (!challenge || challenge.key !== identityKey()) invalid('#auth-code', '请先获取当前账户的验证码。');
        if (Date.now() >= challenge.expiresAt) { challenge = null; invalid('#auth-code', '验证码已过期，请重新获取。'); }
        if (!/^\d{6}$/.test($('#auth-code').value)) invalid('#auth-code', '请输入 6 位数字验证码。');
      }
      const password = $('#auth-password').value;
      if (!$('#password-field').hidden && (password.length < 10 || password.length > 128)) invalid('#auth-password', '密码需要 10–128 个字符。');
      submitting = true; updateControls();
      if (mode === 'reset') {
        await request('password/reset', { challengeId: challenge.id, code: $('#auth-code').value, password });
        changeMode('login');
        message('status', '密码已更新，请使用新密码登录。');
        $('#auth-password').focus();
      } else {
        const path = mode === 'register' ? 'register' : method === 'code' ? 'code/login' : 'login';
        const payload = mode === 'register' ? { challengeId: challenge.id, code: $('#auth-code').value, password, name: $('#auth-name').value.trim() } : method === 'code' ? { challengeId: challenge.id, code: $('#auth-code').value } : { identifier: address(), password };
        const result = await request(path, payload);
        if (!result.user?.id) throw new Error('未能确认登录状态，请重试。');
        $('#auth-password').value = '';
        $('#auth-code').value = '';
        message('status', next.startsWith('/admin.html') ? '登录成功，正在进入管理后台…' : '登录成功，正在进入工作台…');
        go(next);
      }
    } catch (error) { message('error', error.message); }
    finally { submitting = false; updateControls(); }
  });
  render();
  ticker = win.setInterval(updateControls, 1000);
  win.addEventListener('pagehide', () => win.clearInterval(ticker), { once: true });
  const initialized = Promise.allSettled([request('options'), request('me')]).then(([configuration, account]) => {
    if (configuration.status === 'fulfilled') options = configuration.value;
    ready = true;
    render();
    if (account.status === 'fulfilled' && account.value.user?.id && mode !== 'reset' && params.get('verify') !== '1') go(next);
  });
  return { ready: initialized, destroy: () => win.clearInterval(ticker) };
}

if (typeof document !== 'undefined') createAuthPage(document);
