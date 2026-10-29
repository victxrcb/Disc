const { app, BrowserWindow, desktopCapturer, session, shell } = require('electron');
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
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

let localServer;

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

      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': filePath === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Nao foi possivel carregar o aplicativo.');
    }
  });

  return new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
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
    },
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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isTrustedOrigin(requestingOrigin) && (permission === 'media' || permission === 'display-capture');
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = isTrustedOrigin(webContents.getURL());
    callback(trusted && (permission === 'media' || permission === 'display-capture'));
  });

  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      callback(sources[0] ? { video: sources[0] } : {});
    }, { useSystemPicker: true });
  }

  await createWindow();

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
