'use strict';

const SITE_URL = 'https://paperknow.cn/';
const SESSION_PARTITION = 'persist:paperknow';
const SITE_HOSTS = new Set(['paperknow.cn', 'www.paperknow.cn']);

function parseURL(value) {
  try { return new URL(value); } catch { return null; }
}
function isHTTPS(value) {
  const url = parseURL(value);
  return Boolean(url && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'));
}
function isTrustedURL(value) {
  const url = parseURL(value);
  return isHTTPS(value) && SITE_HOSTS.has(url.hostname);
}
function isSupportEmail(value) {
  return value === 'mailto:contact@oneshowailab.com';
}
function isTrustedBlob(value) {
  const url = parseURL(value);
  return Boolean(url?.protocol === 'blob:' && isTrustedURL(url.origin));
}
function isOSSDownload(value) {
  const url = parseURL(value);
  return Boolean(isHTTPS(value) && url.hostname.endsWith('.aliyuncs.com'));
}
function navigationAction(value) {
  if (isTrustedURL(value)) return 'allow';
  if (isTrustedBlob(value) || isOSSDownload(value)) return 'download';
  if (isHTTPS(value) || isSupportEmail(value)) return 'external';
  return 'deny';
}
function windowAction(value) {
  if (isTrustedURL(value)) return 'allow';
  return navigationAction(value);
}
function allowDownload(urlChain, initiatorURL) {
  return isTrustedURL(initiatorURL) && Array.isArray(urlChain) && urlChain.length > 0
    && urlChain.every(url => isHTTPS(url) || isTrustedBlob(url));
}
function allowPermission(permission, requestingURL) {
  // Normal file pickers/downloads do not need extra permissions. Never grant
  // camera, microphone, location, screen capture, notifications or raw clipboard.
  return permission === 'clipboard-sanitized-write' && isTrustedURL(requestingURL);
}
function safeFilename(value) {
  const file = String(value || '').split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  return file && !/^\.+$/.test(file) ? file.slice(0, 180) : 'PaperKnow-download';
}
function securePreferences() {
  return {
    partition: SESSION_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false
  };
}

module.exports = { SITE_URL, SESSION_PARTITION, isHTTPS, isTrustedURL, isSupportEmail, isTrustedBlob, isOSSDownload,
  navigationAction, windowAction, allowDownload, allowPermission, safeFilename, securePreferences };
