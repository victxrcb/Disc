const { app, BrowserWindow, desktopCapturer, ipcMain, Notification, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createReadStream, promises: fs } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

let localServer;
let mainWindow;
const LOCAL_PORT = 47832;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

/** Último estado conhecido da atualização, para a interface recuperar ao carregar. */
let updateStatus = { state: 'idle' };

function sendUpdateStatus(next) {
  updateStatus = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', next);
}

function setupAutoUpdates() {
  ipcMain.handle('update:get-status', () => updateStatus);
  ipcMain.handle('update:install', () => {
    if (updateStatus.state !== 'ready') return false;
    sendUpdateStatus({ ...updateStatus, state: 'installing' });
    // Dá tempo da tela de instalação aparecer; o instalador roda em silêncio e reabre o app.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
    return true;
  });

  // Em desenvolvimento não existe app-update.yml nem uma instalação NSIS para atualizar.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({ state: 'downloading', version: info.version, percent: 0 });
    // Com o app minimizado ou em segundo plano, avisa também pelo Windows.
    if (Notification.isSupported() && !mainWindow?.isFocused()) {
      new Notification({ title: 'Nova atualização disponível', body: `A versão ${info.version} está sendo baixada.` }).show();
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      version: updateStatus.version,
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ state: 'ready', version: info.version, percent: 100 });
  });

  autoUpdater.on('error', (error) => {
    // Falhas de rede não devem impedir o usuário de entrar no aplicativo.
    console.error('[update] Não foi possível verificar/instalar a atualização:', error);
    if (updateStatus.state === 'downloading' || updateStatus.state === 'installing') {
      sendUpdateStatus({ state: 'error', version: updateStatus.version });
    }
  });

  const timer = setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => {
      console.error('[update] Verificação falhou:', error);
    });
  }, 1500);
  timer.unref();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * O Chromium não oferece um seletor próprio quando o Electron trata
 * getDisplayMedia. Exibe uma janela modal para nunca escolher a primeira tela
 * silenciosamente e também permite pedir o áudio de loopback no Windows.
 */
async function chooseDisplaySource(parent) {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  if (!sources.length) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (selection) => {
      if (settled) return;
      settled = true;
      resolve(selection);
      if (!picker.isDestroyed()) picker.close();
    };
    const picker = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: Boolean(parent && !parent.isDestroyed()),
      width: 860,
      height: 650,
      minWidth: 640,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#111114',
      title: 'Escolher o que compartilhar',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const cards = sources.map((source, index) => `
      <button class="source" type="button" data-index="${index}">
        <img src="${source.thumbnail.toDataURL()}" alt="" />
        <span>${escapeHtml(source.name || `Fonte ${index + 1}`)}</span>
      </button>`).join('');
    const html = `<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Escolher o que compartilhar</title><style>
        *{box-sizing:border-box} body{margin:0;background:#111114;color:#f5f5f7;font:14px system-ui,-apple-system,'Segoe UI',sans-serif}
        header{position:sticky;top:0;z-index:2;padding:22px 24px 16px;background:linear-gradient(#111114 82%,transparent)}
        h1{margin:0 0 7px;font-size:22px} p{margin:0;color:#a8a8b3}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;padding:8px 24px 96px}
        .source{min-width:0;padding:8px;border:1px solid #32323a;border-radius:12px;background:#1b1b20;color:inherit;text-align:left;cursor:pointer}
        .source:hover,.source:focus-visible{border-color:#817cff;outline:none;box-shadow:0 0 0 3px #817cff33}.source img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:7px;background:#09090b}
        .source span{display:block;overflow:hidden;padding:9px 3px 3px;text-overflow:ellipsis;white-space:nowrap}
        footer{position:fixed;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-top:1px solid #2b2b32;background:#151519}
        label{display:flex;align-items:center;gap:9px;cursor:pointer}input{width:18px;height:18px;accent-color:#817cff}.cancel{padding:9px 16px;border:1px solid #3a3a43;border-radius:9px;background:#222228;color:inherit;cursor:pointer}
      </style></head><body><header><h1>Escolha uma tela ou janela</h1><p>Nada será transmitido até você selecionar uma opção.</p></header>
      <main class="grid">${cards}</main><footer><label><input id="audio" type="checkbox" checked /> Compartilhar áudio do sistema</label><button class="cancel" id="cancel" type="button">Cancelar</button></footer>
      <script>
        document.querySelectorAll('.source').forEach((button) => button.addEventListener('click', () => {
          location.href = 'disc-capture://select/' + button.dataset.index + '?audio=' + (document.querySelector('#audio').checked ? '1' : '0');
        }));
        document.querySelector('#cancel').addEventListener('click', () => { location.href = 'disc-capture://cancel'; });
      </script></body></html>`;

    picker.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('disc-capture://')) return;
      event.preventDefault();
      const parsed = new URL(url);
      if (parsed.hostname === 'cancel') return finish(null);
      const index = Number(parsed.pathname.replace(/^\//, ''));
      const source = sources[index];
      finish(source ? { source, withAudio: parsed.searchParams.get('audio') === '1' } : null);
    });
    picker.on('closed', () => finish(null));
    picker.once('ready-to-show', () => picker.show());
    void picker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function isTrustedOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function startLocalServer() {
  const distDirectory = path.resolve(__dirname, '..', 'dist');
  const indexFile = path.join(distDirectory, 'index.html');

  if (!(await fileExists(indexFile))) {
    throw new Error('A pasta dist nao existe. Execute "npm run build" antes de abrir o app.');
  }

  localServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const candidate = path.resolve(distDirectory, relativePath || 'index.html');
      const isInsideDist = candidate === distDirectory || candidate.startsWith(`${distDirectory}${path.sep}`);
      const filePath = isInsideDist && (await fileExists(candidate)) ? candidate : indexFile;
      const fileStat = await fs.stat(filePath);
      const range = request.headers.range;
      const commonHeaders = {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': filePath === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'bytes',
      };

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Number(match[2]) : fileStat.size - 1;
        if (!match || start > end || end >= fileStat.size) {
          response.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` });
          response.end();
          return;
        }
        response.writeHead(206, {
          ...commonHeaders,
          'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
          'Content-Length': end - start + 1,
        });
        createReadStream(filePath, { start, end }).pipe(response);
        return;
      }

      response.writeHead(200, { ...commonHeaders, 'Content-Length': fileStat.size });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Nao foi possivel carregar o aplicativo.');
    }
  });

  return new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      const address = localServer.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function createWindow() {
  const appUrl = await startLocalServer();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Discord 2.0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  await window.loadURL(appUrl);
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isTrustedOrigin(requestingOrigin) && (permission === 'media' || permission === 'display-capture');
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = isTrustedOrigin(webContents.getURL());
    callback(trusted && (permission === 'media' || permission === 'display-capture'));
  });

  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const selection = await chooseDisplaySource(parent);
        callback(selection
          ? { video: selection.source, ...(selection.withAudio ? { audio: 'loopback' } : {}) }
          : {});
      } catch (error) {
        console.error('[capture] Não foi possível abrir o seletor:', error);
        callback({});
      }
    });
  }

  await createWindow();
  setupAutoUpdates();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localServer?.close();
});
