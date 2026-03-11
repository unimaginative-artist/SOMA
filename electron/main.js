import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

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
      webSecurity: true
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

app.whenReady().then(createWindow);

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
