import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }

        reject(new Error('Could not determine an available localhost port'))
      })
    })
    server.listen(0, '127.0.0.1')
  })
}

async function findAvailablePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port
  }

  throw new Error(`No available localhost port found from ${start} to ${start + 99}`)
}

const requestedPort = Number.parseInt(process.env.CYCLEMETRY_DEV_PORT || '', 10)
const port =
  Number.isFinite(requestedPort) && requestedPort > 0
    ? await findAvailablePort(requestedPort)
    : await getEphemeralPort()
const url = `http://127.0.0.1:${port}`
const extraArgs = process.argv.slice(2)
if (extraArgs[0] === '--') extraArgs.shift()
const tauriBin = path.join(
  rootDir,
  'app',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
)

const config = {
  build: {
    devUrl: url,
    beforeDevCommand: `pnpm -C app vite --host 127.0.0.1 --port ${port} --strictPort`,
  },
}

const child = spawn(tauriBin, ['dev', '--config', JSON.stringify(config), ...extraArgs], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    CYCLEMETRY_BUILD_STAMP: process.env.CYCLEMETRY_BUILD_STAMP || String(Math.floor(Date.now() / 1000)),
    CYCLEMETRY_DEV_PORT: String(port),
  },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
