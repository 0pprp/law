'use strict'

const { app, BrowserWindow, shell, utilityProcess } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')

const PORT = 3000
let mainWindow = null
let serverChild = null

// Simple .env parser — no external runtime deps needed
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const result = {}
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      val.length >= 2 &&
      val[0] === val[val.length - 1] &&
      (val[0] === '"' || val[0] === "'")
    ) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }
  return result
}

// Poll TCP until Next.js server is ready
function waitForPort(port, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const tryConnect = () => {
      const socket = net.createConnection(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) {
          reject(new Error(`Server did not start on :${port} within ${timeoutMs / 1000}s`))
        } else {
          setTimeout(tryConnect, 500)
        }
      })
    }
    tryConnect()
  })
}

function startNextServer() {
  // In dev mode (electron:dev script) the Next.js server is already running
  if (!app.isPackaged) return

  const standaloneDir = path.join(process.resourcesPath, 'standalone')
  const serverJs = path.join(standaloneDir, 'server.js')
  const envFile = path.join(process.resourcesPath, '.env.local')

  if (!fs.existsSync(serverJs)) {
    console.error('[electron] standalone server.js not found at:', serverJs)
    return
  }

  const extraEnv = loadEnvFile(envFile)

  // utilityProcess.fork uses Electron's bundled Node.js — no system node required
  serverChild = utilityProcess.fork(serverJs, [], {
    cwd: standaloneDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
  })

  if (serverChild.stdout) {
    serverChild.stdout.on('data', d => console.log('[next]', d.toString().trim()))
  }
  if (serverChild.stderr) {
    serverChild.stderr.on('data', d => console.error('[next]', d.toString().trim()))
  }
  serverChild.on('exit', code => console.log('[next] server exited with code', code))
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'قلعة الضمان',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
    autoHideMenuBar: true,
  })

  // Allow only localhost navigation; open external links in system browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Block pop-ups and new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.loadURL(`http://localhost:${PORT}/login`)
}

app.whenReady().then(async () => {
  startNextServer()

  try {
    await waitForPort(PORT)
  } catch (err) {
    console.error('[electron]', err.message)
    // Proceed anyway — server might still be warming up
  }

  await createWindow()
})

app.on('window-all-closed', () => {
  if (serverChild) {
    serverChild.kill()
    serverChild = null
  }
  app.quit()
})

app.on('activate', async () => {
  if (!mainWindow) await createWindow()
})