const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../security.cjs');

test('only exact production HTTPS origins remain inside desktop windows', () => {
  for (const url of ['https://paperknow.cn/', 'https://www.paperknow.cn/workspace.html#home']) assert.equal(policy.navigationAction(url), 'allow');
  for (const url of ['https://paperknow.cn.evil.test/', 'https://openapi.alipay.com/gateway.do']) assert.equal(policy.navigationAction(url), 'external');
  for (const url of ['http://paperknow.cn/', 'https://paperknow.cn@evil.test/', 'https://user:password@paperknow.cn/', 'https://paperknow.cn:8080/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'powershell:run', 'weixin://x', 'alipay://test', 'not a url']) assert.equal(policy.navigationAction(url), 'deny');
});
test('safe trusted blob and OSS links use streaming download, never system execution', () => {
  assert.equal(policy.navigationAction('blob:https://paperknow.cn/identifier'), 'download');
  assert.equal(policy.navigationAction('https://mybucket.oss-cn-hangzhou.aliyuncs.com/file.docx?signature=example'), 'download');
  assert.equal(policy.navigationAction('blob:https://evil.test/id'), 'deny');
  assert.equal(policy.navigationAction('https://aliyuncs.com.evil.test/file.exe'), 'external');
});
test('only the exact public support mailbox can open a mail client', () => {
  assert.equal(policy.navigationAction('mailto:contact@oneshowailab.com'), 'external');
  for (const url of ['mailto:other@example.com', 'mailto:contact@oneshowailab.com?attach=/etc/passwd', 'mailto:contact@oneshowailab.com\nfile:///etc/passwd']) assert.equal(policy.navigationAction(url), 'deny');
});
test('download allows authenticated HTTPS redirects and trusted blobs only from trusted documents', () => {
  assert.equal(policy.allowDownload(['https://paperknow.cn/api/file/1', 'https://bucket.oss-cn-shanghai.aliyuncs.com/file'], 'https://paperknow.cn/workspace.html'), true);
  assert.equal(policy.allowDownload(['blob:https://paperknow.cn/id'], 'https://paperknow.cn/workspace.html'), true);
  for (const chain of [[], ['file:///etc/passwd'], ['http://insecure.test/file'], ['data:text/html,bad'], ['blob:https://evil.test/id']]) assert.equal(policy.allowDownload(chain, 'https://paperknow.cn/'), false);
  assert.equal(policy.allowDownload(['https://paperknow.cn/file'], 'https://evil.test/'), false);
});
test('all renderers have persistent session with sandbox and no native bridge', () => {
  const prefs = policy.securePreferences();
  assert.equal(prefs.partition, 'persist:paperknow');
  assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.webviewTag, false); assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.preload, undefined);
  assert.equal(policy.windowAction('https://paperknow.cn/api/payments/frame'), 'allow');
  assert.equal(policy.windowAction('https://openapi.alipay.com/gateway.do'), 'external');
});
test('only sanitized clipboard writes from exact trusted origins are allowed', () => {
  assert.equal(policy.allowPermission('clipboard-sanitized-write', 'https://paperknow.cn/'), true);
  assert.equal(policy.allowPermission('clipboard-sanitized-write', 'https://evil.test/'), false);
  for (const kind of ['clipboard-read', 'media', 'display-capture', 'geolocation', 'notifications', 'openExternal', 'fileSystem']) assert.equal(policy.allowPermission(kind, 'https://paperknow.cn/'), false);
});
test('download filenames cannot escape selected folder or embed Windows path syntax', () => {
  assert.equal(policy.safeFilename('../../private/secret.txt'), 'secret.txt');
  assert.equal(policy.safeFilename('C:\\Windows\\system.exe'), 'system.exe');
  assert.equal(policy.safeFilename('a<b>:c?.txt'), 'a_b__c_.txt');
  assert.equal(policy.safeFilename('..'), 'PaperKnow-download');
});
test('packaging is explicitly versioned, unsigned, scoped, and supports target architectures', () => {
  const config = require('../package.json');
  assert.equal(config.version, '0.1.0');
  assert.equal(config.build.mac.identity, null);
  assert.equal(config.build.mac.minimumSystemVersion, '13.0');
  assert.equal(config.build.win.signExecutable, false);
  assert.equal(config.build.nsis.perMachine, false); assert.equal(config.build.nsis.allowElevation, false);
  assert.equal(config.build.nsis.allowToChangeInstallationDirectory, true);
  assert.deepEqual(config.build.win.target[0].arch, ['x64']);
  assert.deepEqual(config.build.mac.target[0].arch, ['arm64', 'x64']);
  assert.deepEqual(config.build.files, ['main.cjs', 'security.cjs', 'offline.html', 'assets/icon.png', 'package.json']);
});
test('client code does not disable TLS security or expose renderer IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.doesNotMatch(main, /ignore-certificate-errors|no-sandbox|ipcMain|ipcRenderer|executeJavaScript|\.env/);
  assert.match(main, /if \(isMainFrame\) handleNavigation/);
  assert.match(main, /overrideBrowserWindowOptions: windowOptions\(false\)/);
});
test('every platform packages original Electron and Chromium third-party licenses', () => {
  const config = require('../package.json');
  assert.deepEqual(config.build.extraResources, [
    { from: 'node_modules/electron/dist/LICENSE', to: 'licenses/ELECTRON-LICENSE.txt' },
    { from: 'node_modules/electron/dist/LICENSES.chromium.html', to: 'licenses/LICENSES.chromium.html' }
  ]);
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /process\.resourcesPath, 'licenses\/LICENSES\.chromium\.html'/);
  assert.match(main, /shell\.showItemInFolder\(file\)/);
});
