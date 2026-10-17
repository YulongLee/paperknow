'use strict';

const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SITE_URL, SESSION_PARTITION, isTrustedURL, isHTTPS, isSupportEmail, navigationAction, windowAction,
  allowDownload, allowPermission, safeFilename, securePreferences } = require('./security.cjs');

// Online service client: no backend, model credentials, preload bridge, or IPC.
app.setName('PaperKnow');
app.enableSandbox();
const windows = new Set();
const offlineLoads = new WeakMap();
const offlinePath = path.join(__dirname, 'offline.html');
const offlineURL = pathToFileURL(offlinePath).href;
let mainWindow;

function externalURL(url) {
  if (isHTTPS(url) || isSupportEmail(url)) void shell.openExternal(url).catch(() => {
    if (mainWindow && !mainWindow.isDestroyed()) void dialog.showMessageBox(mainWindow, {
      type: 'info', title: '打开链接', message: '暂时无法打开系统浏览器，请稍后重试。'
    });
  });
}

function guardContents(contents) {
  contents.on('will-attach-webview', event => event.preventDefault());
  function handleNavigation(event, url) {
    const action = navigationAction(url);
    if (action === 'allow') return;
    event.preventDefault();
    if (action === 'external') externalURL(url);
    if (action === 'download' && isTrustedURL(contents.getURL())) contents.downloadURL(url);
  }
  contents.on('will-navigate', handleNavigation);
  // Only guard main-frame redirects. Payment iframe navigation remains sandboxed
  // in Chromium with the website's existing CSP; it never acquires Node access.
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) handleNavigation(event, url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const action = windowAction(url);
    if (action === 'allow') return { action: 'allow', overrideBrowserWindowOptions: windowOptions(false) };
    if (action === 'external') externalURL(url);
    if (action === 'download' && isTrustedURL(contents.getURL())) contents.downloadURL(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => attachWindow(child));
  contents.on('will-prevent-unload', event => {
    const window = BrowserWindow.fromWebContents(contents);
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', title: '内容尚未保存', message: '页面仍有未保存的内容，确认离开？',
      buttons: ['继续编辑', '离开页面'], defaultId: 0, cancelId: 0
    });
    if (choice === 1) event.preventDefault();
  });
}

function windowOptions(primary = true) {
  return {
    title: 'PaperKnow', width: 1360, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#f5f8ff', show: false,
    ...(process.platform === 'darwin' ? {} : { icon: path.join(__dirname, 'assets/icon.png') }),
    ...(primary ? {} : { width: 1120, height: 800 }),
    webPreferences: securePreferences()
  };
}

function attachWindow(window) {
  if (windows.has(window)) return;
  windows.add(window);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => windows.delete(window));
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} PaperKnowDesktop/${app.getVersion()}`);
}

async function loadSite(window) {
  try { await window.loadURL(SITE_URL); }
  catch { await showOffline(window); }
}

function showOffline(window) {
  if (window.isDestroyed() || window.webContents.getURL() === offlineURL) return Promise.resolve();
  if (offlineLoads.has(window)) return offlineLoads.get(window);
  const loading = window.loadFile(offlinePath).catch(() => {}).finally(() => offlineLoads.delete(window));
  offlineLoads.set(window, loading);
  return loading;
}

function createMainWindow() {
  mainWindow = new BrowserWindow(windowOptions());
  attachWindow(mainWindow);
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, failedURL, isMainFrame) => {
    if (isMainFrame && code !== -3 && isTrustedURL(failedURL)) void showOffline(mainWindow);
  });
  void loadSite(mainWindow);
  return mainWindow;
}

function installSessionHandlers() {
  const webSession = session.fromPartition(SESSION_PARTITION);
  webSession.setPermissionCheckHandler((_contents, permission, origin, details) =>
    allowPermission(permission, details?.requestingUrl || origin));
  webSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowPermission(permission, details?.requestingUrl || contents.getURL())));
  webSession.setDevicePermissionHandler(() => false);
  webSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  webSession.on('will-download', (event, item, contents) => {
    if (!contents || !allowDownload(item.getURLChain(), contents.getURL())) {
      event.preventDefault();
      return;
    }
    // Keep Chromium's streaming downloader. A native save dialog lets the user
    // choose where to store exports and never runs/opens a downloaded executable.
    item.setSaveDialogOptions({
      title: '保存 PaperKnow 文件',
      defaultPath: path.join(app.getPath('downloads'), safeFilename(item.getFilename()))
    });
    item.once('done', (_event, state) => {
      if (state !== 'interrupted') return;
      const window = BrowserWindow.fromWebContents(contents);
      if (window && !window.isDestroyed()) void dialog.showMessageBox(window, {
        type: 'warning', title: '下载未完成', message: '文件下载中断，请检查网络后重新下载。'
      });
    });
  });
}

function installMenu() {
  const focused = () => BrowserWindow.getFocusedWindow() || mainWindow;
  const template = [
    ...(process.platform === 'darwin' ? [{ label: 'PaperKnow', submenu: [
      { role: 'about', label: '关于 PaperKnow' }, { type: 'separator' },
      { role: 'hide', label: '隐藏 PaperKnow' }, { role: 'hideOthers', label: '隐藏其他' },
      { type: 'separator' }, { role: 'quit', label: '退出 PaperKnow' }
    ] }] : []),
    { label: '文件', submenu: [
      { label: '工作台', accelerator: 'CmdOrCtrl+Shift+H', click: () => { const win = focused(); if (win) void win.loadURL(`${SITE_URL}workspace.html#home`); } },
      { label: '下载文件夹', click: () => { void shell.openPath(app.getPath('downloads')); } },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit', label: process.platform === 'darwin' ? '关闭窗口' : '退出 PaperKnow' }
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [
      { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => { const win = focused(); if (win) { if (isTrustedURL(win.webContents.getURL())) win.reload(); else void loadSite(win); } } },
      { label: '返回上一页', accelerator: 'Alt+Left', click: () => { const contents = focused()?.webContents; if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); } },
      { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
      { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }
    ] },
    { label: '帮助', submenu: [
      { label: '帮助与反馈', click: () => { const win = focused(); if (win) void win.loadURL(`${SITE_URL}workspace.html#help`); } },
      { label: '在浏览器中打开 PaperKnow', click: () => externalURL(SITE_URL) },
      { label: '开源组件许可', click: () => {
        // Fixed, packaged first-party path only; never accepts a webpage path.
        const file = app.isPackaged ? path.join(process.resourcesPath, 'licenses/LICENSES.chromium.html')
          : path.join(__dirname, 'node_modules/electron/dist/LICENSES.chromium.html');
        shell.showItemInFolder(file);
      } },
      { label: `版本 ${app.getVersion()} · 手动检查更新`, click: () => externalURL(`${SITE_URL}#download`) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.on('web-contents-created', (_event, contents) => guardContents(contents));
  app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: 'PaperKnow', applicationVersion: app.getVersion(),
      copyright: '© 2026 oneshowailab-paperknow', website: SITE_URL });
    installSessionHandlers();
    installMenu();
    createMainWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
