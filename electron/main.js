import { app, BrowserWindow, session, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
const PORTAL_PARTITION = 'persist:portal';
const somaUrl = process.env.SOMA_BACKEND_URL || 'http://localhost:3001';
app.commandLine.appendSwitch('remote-debugging-port', '9222');
const permissionCache = new Map(); // origin -> permissions object

function isSafeExternalUrl(value = '') {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function mapPermission(electronPermission) {
  if (electronPermission === 'media') return ['camera', 'microphone'];
  if (electronPermission === 'geolocation') return ['location'];
  if (electronPermission === 'notifications') return ['notifications'];
  if (electronPermission.startsWith('clipboard')) return ['clipboard'];
  return [electronPermission];
}

function configurePortalSession() {
  const portalSession = session.fromPartition(PORTAL_PARTITION);
  const privateSession = session.fromPartition('portal_private');

  const setupSessionHandlers = (sess) => {
    sess.setPermissionRequestHandler(async (webContents, permission, callback) => {
      try {
        const url = webContents.getURL();
        const origin = new URL(url).origin;
        const res = await fetch(`${somaUrl}/api/aperture/portal/permissions/origin?origin=${encodeURIComponent(origin)}`);
        const data = await res.json();
        if (data.success && data.permissions) {
          permissionCache.set(origin, data.permissions);
          const dbPermissions = mapPermission(permission);
          const isAllowed = dbPermissions.every(p => data.permissions[p] === 'allow');
          return callback(isAllowed);
        }
      } catch (err) {
        console.error('[ELECTRON] Error handling permission request:', err);
      }
      callback(false);
    });

    sess.setPermissionCheckHandler((webContents, permission, origin) => {
      const cached = permissionCache.get(origin);
      if (cached) {
        const dbPermissions = mapPermission(permission);
        return dbPermissions.every(p => cached[p] === 'allow');
      }
      return false;
    });

    sess.on('will-download', (event, item, webContents) => {
      const downloadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const filename = item.getFilename();
      const url = item.getURL();
      const totalBytes = item.getTotalBytes();
      const savePath = path.join(app.getPath('downloads'), filename);
      item.setSavePath(savePath);

      fetch(`${somaUrl}/api/aperture/portal/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: downloadId, filename, url, savePath, totalBytes })
      }).catch(err => console.error('[ELECTRON] Failed to register download:', err));

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          fetch(`${somaUrl}/api/aperture/portal/downloads/${downloadId}/fail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorMessage: 'Download interrupted' })
          }).catch(err => {});
        } else if (state === 'progressing') {
          if (!item.isPaused()) {
            const receivedBytes = item.getReceivedBytes();
            fetch(`${somaUrl}/api/aperture/portal/downloads/${downloadId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ receivedBytes, state: 'progress' })
            }).catch(err => {});
          }
        }
      });

      item.once('done', (event, state) => {
        if (state === 'completed') {
          fetch(`${somaUrl}/api/aperture/portal/downloads/${downloadId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totalBytes: item.getTotalBytes() })
          }).catch(err => {});
        } else {
          fetch(`${somaUrl}/api/aperture/portal/downloads/${downloadId}/fail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorMessage: `Download failed: ${state}` })
          }).catch(err => {});
        }
      });
    });
  };

  setupSessionHandlers(portalSession);
  setupSessionHandlers(privateSession);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#111827',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true
    },
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'default'
  });

  // Dev: load from Vite dev server (proxies API calls to SOMA backend)
  // Production: load from the SOMA Express server (serves frontend/dist + handles API)
  // NOTE: Never use loadFile() — it creates a file:// origin which breaks all relative API fetches
  const viteUrl = process.env.VITE_DEV_SERVER_URL;
  const somaUrl = process.env.SOMA_BACKEND_URL || 'http://localhost:3001';
  const loadUrl = viteUrl || somaUrl;

  console.log('[ELECTRON] Loading from:', loadUrl);
  mainWindow.loadURL(loadUrl);

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isSafeExternalUrl(params.src) && params.src !== 'about:blank') {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.partition = params.partition || PORTAL_PARTITION;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      if (!isSafeExternalUrl(url)) event.preventDefault();
    });
    guest.on('did-navigate', async (event, url) => {
      try {
        const origin = new URL(url).origin;
        const res = await fetch(`${somaUrl}/api/aperture/portal/permissions/origin?origin=${encodeURIComponent(origin)}`);
        const data = await res.json();
        if (data.success && data.permissions) {
          permissionCache.set(origin, data.permissions);
        }
      } catch (err) {}
    });
  });

  if (viteUrl) {
    mainWindow.webContents.openDevTools();
  }

  // Allow toggling DevTools with F12 or Ctrl+Shift+I
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.key.toLowerCase() === 'i' && input.control && input.shift))) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  configurePortalSession();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
