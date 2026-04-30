import http from 'http'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PORT = 3101

let running = null // { pid, suite, startedAt }

function runSuite(script) {
  if (running) return false
  const proc = spawn('node', [path.join(__dirname, script)], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'inherit',
  })
  running = { pid: proc.pid, suite: script, startedAt: new Date().toISOString() }
  proc.on('close', () => { running = null })
  return true
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ running: running !== null, job: running }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/run') {
    const started = runSuite('runner.mjs')
    res.writeHead(started ? 200 : 409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: started, message: started ? 'Test run started' : 'Already running' }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/run/inbox') {
    const started = runSuite('inbox.mjs')
    res.writeHead(started ? 200 : 409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: started, message: started ? 'Inbox test run started' : 'Already running' }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`[e2e-server] Listening on http://localhost:${PORT}`)
})
