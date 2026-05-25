const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let collectorProcess = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    title: 'Device Work Monitor',
    backgroundColor: '#050816',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

function startCollector({ employeeEmail, apiUrl, collectorToken, idleThreshold }) {
  if (collectorProcess) {
    return;
  }

  const scriptPath = path.join(__dirname, '..', 'python', 'system_event_monitor.py');
  const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
  const args = [
    scriptPath,
    '--api-url',
    apiUrl || process.env.SYSTEM_EVENTS_API_URL || 'http://localhost:8080/api/system-events/ingest',
    '--interval',
    '30',
    '--idle-threshold',
    String(idleThreshold || 300),
  ];

  if (collectorToken || process.env.SYSTEM_COLLECTOR_TOKEN) {
    args.push('--collector-token', collectorToken || process.env.SYSTEM_COLLECTOR_TOKEN);
  }

  if (employeeEmail || process.env.EMPLOYEE_EMAIL) {
    args.push('--employee-email', employeeEmail || process.env.EMPLOYEE_EMAIL);
  }

  collectorProcess = spawn(pythonExecutable, args, {
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
    env: {
      ...process.env,
      EMPLOYEE_EMAIL: employeeEmail || process.env.EMPLOYEE_EMAIL || '',
      SYSTEM_COLLECTOR_TOKEN: collectorToken || process.env.SYSTEM_COLLECTOR_TOKEN || '',
    },
  });

  collectorProcess.stdout.on('data', (chunk) => {
    mainWindow?.webContents.send('collector-log', chunk.toString());
  });

  collectorProcess.stderr.on('data', (chunk) => {
    mainWindow?.webContents.send('collector-log', chunk.toString());
  });

  collectorProcess.on('exit', (code) => {
    mainWindow?.webContents.send('collector-log', `Collector stopped with code ${code || 0}`);
    collectorProcess = null;
  });
}

function stopCollector() {
  if (collectorProcess && !collectorProcess.killed) {
    collectorProcess.kill();
  }
  collectorProcess = null;
}

ipcMain.handle('collector:start', (_event, options) => {
  startCollector(options || {});
  return { running: Boolean(collectorProcess) };
});

ipcMain.handle('collector:stop', () => {
  stopCollector();
  return { running: false };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  stopCollector();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
