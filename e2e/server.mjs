import http from 'http'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PORT = 3101

// ── Live progress state ───────────────────────────────────────────────────────
let running = null
let progress = {
  currentSuite: null,
  currentStep:  null,
  lastResult:   null,
  log:          [],        // last 60 raw lines
  activity:     [],        // last 40 activity events for the dashboard feed
  steps:        [],        // completed steps { suite, step, status, error }
  passed: 0, failed: 0, skipped: 0, total: 0,
}

function resetProgress() {
  progress = { currentSuite: null, currentStep: null, lastResult: null,
    log: [], activity: [], steps: [], passed: 0, failed: 0, skipped: 0, total: 0 }
}

function pushActivity(type, text) {
  progress.activity.push({ type, text, ts: Date.now() })
  if (progress.activity.length > 40) progress.activity.shift()
}

function parseLine(line) {
  // Suite header  ━━━  icon  Name
  const suiteMatch = line.match(/^\s{2}([^\s─━]+)\s{2}(.+)$/)
  if (line.includes('━━━') && suiteMatch) {
    progress.currentSuite = suiteMatch[2].trim()
    progress.currentStep  = null
    pushActivity('suite', progress.currentSuite)
    return
  }
  // Step start  ▸ Step name
  const stepMatch = line.match(/^\s{2}▸\s+(.+)$/)
  if (stepMatch) {
    progress.currentStep = stepMatch[1].trim()
    progress.lastResult  = null
    pushActivity('step', progress.currentStep)
    return
  }
  // Finding  · text
  const findMatch = line.match(/^\s{6}·\s+(.+)$/)
  if (findMatch) { pushActivity('find', findMatch[1].trim()); return }
  // Warning  ⚠ text
  const warnMatch = line.match(/^\s{6}⚠\s+(.+)$/)
  if (warnMatch) { pushActivity('warn', warnMatch[1].trim()); return }
  // Result  → PASS / FAIL / SKIP
  const passMatch = line.match(/→ PASS/)
  const failMatch = line.match(/→ FAIL:\s*(.+)/)
  const skipMatch = line.match(/→ SKIP:\s*(.+)/)
  if (passMatch || failMatch || skipMatch) {
    const status = passMatch ? 'pass' : failMatch ? 'fail' : 'skip'
    const error  = failMatch ? failMatch[1].trim() : skipMatch ? skipMatch[1].trim() : null
    progress.lastResult = status
    pushActivity(status, error || status.toUpperCase())
    if (progress.currentStep) {
      progress.steps.push({ suite: progress.currentSuite, step: progress.currentStep, status, error })
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
      running:      running !== null,
      job:          running,
      currentSuite: progress.currentSuite,
      currentStep:  progress.currentStep,
      lastResult:   progress.lastResult,
      activity:     progress.activity,
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

  if (req.method === 'POST' && req.url === '/api/run/flows') {
    const started = runSuite('flows.mjs')
    res.writeHead(started ? 200 : 409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: started, message: started ? 'Flow tests started' : 'Already running' }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`[e2e-server] Listening on http://localhost:${PORT}`)
})
