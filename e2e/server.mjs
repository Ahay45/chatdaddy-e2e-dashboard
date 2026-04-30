import http from 'http'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PORT = 3101

// ── Live progress state ───────────────────────────────────────────────────────
let running = null         // { pid, suite, startedAt }
let progress = {
  currentSuite: null,      // e.g. "Compose & Send"
  currentStep:  null,      // e.g. "Emoji picker opens"
  lastResult:   null,      // "pass" | "fail" | "skip"
  log:          [],        // last 60 lines
  steps:        [],        // { suite, step, status } completed so far
  passed: 0, failed: 0, skipped: 0, total: 0,
}

function resetProgress() {
  progress = { currentSuite: null, currentStep: null, lastResult: null,
    log: [], steps: [], passed: 0, failed: 0, skipped: 0, total: 0 }
}

function parseLine(line) {
  // Suite header ━━━  icon  Name
  const suiteMatch = line.match(/^\s{2}([^\s─]+)\s{2}(.+)$/)
  if (line.includes('━━━') && suiteMatch) {
    progress.currentSuite = suiteMatch[2].trim()
    progress.currentStep  = null
    return
  }
  // Step start:  ▸ Step name
  const stepMatch = line.match(/^\s{2}▸\s+(.+)$/)
  if (stepMatch) {
    progress.currentStep = stepMatch[1].trim()
    progress.lastResult  = null
    return
  }
  // Result:  → PASS / FAIL / SKIP
  const passMatch = line.match(/→ PASS/)
  const failMatch = line.match(/→ FAIL:\s*(.+)/)
  const skipMatch = line.match(/→ SKIP:\s*(.+)/)
  if (passMatch || failMatch || skipMatch) {
    const status = passMatch ? 'pass' : failMatch ? 'fail' : 'skip'
    progress.lastResult = status
    if (progress.currentStep) {
      progress.steps.push({ suite: progress.currentSuite, step: progress.currentStep, status })
      if (status === 'pass')  progress.passed++
      if (status === 'fail')  progress.failed++
      if (status === 'skip')  progress.skipped++
      progress.total++
    }
    return
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
function runSuite(script) {
  if (running) return false
  resetProgress()

  const proc = spawn('node', [path.join(__dirname, script)], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  running = { pid: proc.pid, suite: script, startedAt: new Date().toISOString() }

  const handleChunk = (chunk) => {
    const text = chunk.toString()
    // also print to terminal so developer can see
    process.stdout.write(text)
    for (const line of text.split('\n')) {
      if (line.trim()) {
        progress.log.push(line)
        if (progress.log.length > 60) progress.log.shift()
        parseLine(line)
      }
    }
  }

  proc.stdout.on('data', handleChunk)
  proc.stderr.on('data', handleChunk)
  proc.on('close', () => { running = null })
  return true
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ running: running !== null, job: running }))
    return
  }

  if (req.method === 'GET' && req.url === '/api/progress') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      running: running !== null,
      currentSuite: progress.currentSuite,
      currentStep:  progress.currentStep,
      lastResult:   progress.lastResult,
      log:          progress.log.slice(-20),
      steps:        progress.steps,
      summary:      { passed: progress.passed, failed: progress.failed, skipped: progress.skipped, total: progress.total },
    }))
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
