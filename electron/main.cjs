const { app, BrowserWindow, nativeTheme, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const isMac = process.platform === 'darwin';
const NOTE_FILE_EXTENSION = '.ntp';
const NOTE_STORAGE_DIR_NAME = 'NotesTakerPlusNotes';
const NOTE_FILE_FILTERS = [
  { name: 'NotesTaker Plus Document', extensions: ['ntp'] },
  { name: 'JSON', extensions: ['json'] }
];
let notesDirectoryPath;

const getNotesDirectory = () => {
  if (!notesDirectoryPath) {
    notesDirectoryPath = path.join(app.getPath('documents'), NOTE_STORAGE_DIR_NAME);
  }
  return notesDirectoryPath;
};

const ensureNotesDirectory = async () => {
  const dir = getNotesDirectory();
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.once('ready-to-show', () => win.show());

  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    win.loadURL(devServerURL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    win.loadFile(indexPath);
  }
};

app.whenReady().then(async () => {
  await ensureNotesDirectory();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

const ensureExtension = fileName => {
  if (!fileName) return undefined;
  return fileName.toLowerCase().endsWith(NOTE_FILE_EXTENSION) ? fileName : `${fileName}${NOTE_FILE_EXTENSION}`;
};

const sanitizeFileName = value => {
  if (typeof value !== 'string') return 'note';
  let sanitized = value.trim();
  if (!sanitized) return 'note';
  sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/\.+$/, '');
  if (!sanitized) {
    return 'note';
  }
  return sanitized;
};

const resolveUniqueFileName = async (directory, fileName) => {
  const { name, ext } = path.parse(fileName);
  let candidate = fileName;
  let attempt = 1;
  while (true) {
    const candidatePath = path.join(directory, candidate);
    try {
      await fs.access(candidatePath);
      candidate = `${name} (${attempt})${ext}`;
      attempt += 1;
    } catch {
      return candidate;
    }
  }
};

const readNoteFile = async (filePath, fileNameOverride) => {
  const stats = await fs.stat(filePath);
  let document = null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    document = JSON.parse(raw);
  } catch (error) {
    document = null;
  }
  return {
    fileName: fileNameOverride ?? path.basename(filePath),
    path: filePath,
    updatedAt: stats.mtimeMs,
    document
  };
};

ipcMain.handle('note:save', async (event, payload) => {
  try {
    const document = payload?.document ?? payload;
    const requestedName = sanitizeFileName(payload?.fileName);
    const fileName = ensureExtension(requestedName);
    if (!document || typeof document !== 'object') {
      throw new Error('Invalid note payload');
    }
    const directory = await ensureNotesDirectory();
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, JSON.stringify(document, null, 2), 'utf8');
    return { status: 'saved', path: filePath, fileName };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('note:open', async event => {
  try {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = await ensureNotesDirectory();
    const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow ?? undefined, {
      title: 'Open note',
      defaultPath,
      filters: NOTE_FILE_FILTERS,
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { status: 'cancelled' };
    }
    const [filePath] = filePaths;
    const contents = await fs.readFile(filePath, 'utf8');
    const document = JSON.parse(contents);
    return { status: 'opened', path: filePath, fileName: path.basename(filePath), document };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('note:list', async () => {
  try {
    const directory = await ensureNotesDirectory();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(NOTE_FILE_EXTENSION)) continue;
      const fullPath = path.join(directory, entry.name);
      try {
        const metadata = await readNoteFile(fullPath, entry.name);
        files.push(metadata);
      } catch (error) {
        continue;
      }
    }
    files.sort((a, b) => b.updatedAt - a.updatedAt);
    return { status: 'ok', files };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('note:import', async event => {
  try {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow ?? undefined, {
      title: 'Import note files',
      filters: NOTE_FILE_FILTERS,
      properties: ['openFile', 'multiSelections']
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { status: 'cancelled' };
    }
    const directory = await ensureNotesDirectory();
    const imported = [];
    for (const filePath of filePaths) {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const document = JSON.parse(raw);
        const originalName = path.basename(filePath, path.extname(filePath));
        const sanitizedName = sanitizeFileName(originalName);
        const targetName = await resolveUniqueFileName(directory, ensureExtension(sanitizedName));
        const targetPath = path.join(directory, targetName);
        await fs.writeFile(targetPath, JSON.stringify(document, null, 2), 'utf8');
        const metadata = await readNoteFile(targetPath, targetName);
        imported.push(metadata);
      } catch (error) {
        continue;
      }
    }
    return { status: 'imported', files: imported };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
