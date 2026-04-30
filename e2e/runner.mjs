#!/usr/bin/env node
/**
 * ChatDaddy E2E Agent Runner — https://theo.chatdaddy.tech/
 *
 * Usage:
 *   CD_PHONE=+6285228454057 CD_PASSWORD=SemangatChatdaddy45 node e2e/runner.mjs
 *   node e2e/runner.mjs --headless
 */

import { execSync, spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const ROOT   = join(__dir, '..')
const RESULTS_FILE = join(ROOT, 'public', 'e2e-results.json')
mkdirSync(join(ROOT, 'public'), { recursive: true })

// Auto-load .env so no manual env vars needed
const ENV_FILE = join(ROOT, '.env')
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}

const BASE_URL = 'https://theo.chatdaddy.tech'
const PHONE    = process.env.CD_PHONE    || ''
const PASSWORD = process.env.CD_PASSWORD || ''
const HEADLESS = process.argv.includes('--headless')

// ─── browser helpers ─────────────────────────────────────────────────────────

function ab(...args) {
  const cmd = ['agent-browser', ...args, ...(HEADLESS ? ['--headless'] : [])].join(' ')
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 20_000 }).trim() }
  } catch (e) {
    return { ok: false, out: e.stdout?.trim() || '', err: e.stderr?.trim() || e.message }
  }
}

function getSnapshot() {
  const r = ab('snapshot', '-i', '--json')
  if (!r.ok) return null
  try { return JSON.parse(r.out) } catch { return null }
}

function getUrl() {
  const s = getSnapshot()
  return s?.data?.origin || ''
}

function getSnapText() {
  const s = getSnapshot()
  return JSON.stringify(s?.data || '').toLowerCase()
}

function getRefs() {
  const s = getSnapshot()
  return s?.data?.refs || {}
}

function findRef(refs, ...keywords) {
  for (const [id, info] of Object.entries(refs)) {
    const name = (info.name || '').toLowerCase()
    if (keywords.some(k => name.includes(k.toLowerCase()))) return `@${id}`
  }
  return null
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg) { process.stdout.write(msg + '\n') }

// ─── results engine ──────────────────────────────────────────────────────────

const suites = []
let activeSuite = null
let activeStep  = null
let isLoggedIn  = false

function suite(name, icon = '🔷') {
  activeSuite = { name, icon, steps: [] }
  suites.push(activeSuite)
  log(`\n${'━'.repeat(52)}\n  ${icon}  ${name}\n${'━'.repeat(52)}`)
}

function step(name) {
  activeStep = { name, status: 'running', findings: [], errors: [], duration: 0, _start: Date.now() }
  activeSuite.steps.push(activeStep)
  log(`\n  ▸ ${name}`)
}

function find(msg) { activeStep.findings.push(msg);         log(`      · ${msg}`) }
function warn(msg) { activeStep.findings.push(`⚠ ${msg}`);  log(`      ⚠ ${msg}`) }

function pass(msg = '') {
  activeStep.status   = 'pass'
  activeStep.duration = Date.now() - activeStep._start
  if (msg) find(msg)
  log(`    → PASS (${activeStep.duration}ms)`)
}
function fail(msg) {
  activeStep.status   = 'fail'
  activeStep.duration = Date.now() - activeStep._start
  activeStep.errors.push(msg)
  log(`    → FAIL: ${msg}`)
}
function skip(msg = '') {
  activeStep.status   = 'skip'
  activeStep.duration = 0
  if (msg) activeStep.findings.push(msg)
  log(`    → SKIP: ${msg}`)
}
function assert(c, m) { if (!c) throw new Error(m) }

async function run(name, fn) {
  step(name)
  try { await fn(); if (activeStep.status === 'running') pass() }
  catch (e) { fail(e.message) }
}

// ─── save & push ─────────────────────────────────────────────────────────────

function saveAndPush() {
  const allSteps = suites.flatMap(s => s.steps)
  const passed   = allSteps.filter(s => s.status === 'pass').length
  const failed   = allSteps.filter(s => s.status === 'fail').length
  const skipped  = allSteps.filter(s => s.status === 'skip').length
  const totalMs  = allSteps.reduce((a, s) => a + s.duration, 0)

  const data = {
    url: BASE_URL,
    runAt: new Date().toISOString(),
    mode: HEADLESS ? 'headless' : 'headed',
    durationMs: totalMs,
    summary: { passed, failed, skipped, total: allSteps.length },
    suites: suites.map(s => ({
      name: s.name, icon: s.icon,
      durationMs: s.steps.reduce((a, st) => a + st.duration, 0),
      summary: {
        passed:  s.steps.filter(st => st.status === 'pass').length,
        failed:  s.steps.filter(st => st.status === 'fail').length,
        skipped: s.steps.filter(st => st.status === 'skip').length,
        total:   s.steps.length,
      },
      steps: s.steps.map(({ name, status, duration, findings, errors }) =>
        ({ name, status, duration, findings, errors, screenshot: null })
      ),
    })),
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2))
  log(`\n  → Saved results`)

  // Auto-push to GitHub → triggers Pages rebuild → live dashboard updates
  const ts  = new Date().toLocaleString()
  const msg = `chore: e2e results ${passed}✓ ${failed}✗ ${skipped}~ — ${ts}`
  spawnSync('git', ['add', 'public/e2e-results.json'], { cwd: ROOT, stdio: 'pipe' })
  const commit = spawnSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'pipe' })
  if (commit.status === 0) {
    spawnSync('git', ['push'], { cwd: ROOT, stdio: 'pipe' })
    log('  → Pushed to GitHub — live dashboard updating now (~1 min)')
  } else {
    log('  → No changes to push (results unchanged)')
  }

  return { data, passed, failed, skipped }
}

// ═════════════════════════════════════════════════════════════════════════════
log(`\n${'═'.repeat(52)}\n  ChatDaddy E2E — ${BASE_URL}\n  ${new Date().toLocaleString()}  |  ${HEADLESS ? 'headless' : 'headed'}\n${'═'.repeat(52)}`)

// ─────────────────────────────────────────────────────────────────────────────
suite('Page Load & Session Check', '🌐')
// ─────────────────────────────────────────────────────────────────────────────

await run('Open site and detect session', async () => {
  const r = ab('open', `${BASE_URL}/auth/login`)
  assert(r.ok, `Could not open browser: ${r.err}`)
  await wait(3500)

  const snap = getSnapshot()
  const url  = snap?.data?.origin || ''
  const text = JSON.stringify(snap?.data || '').toLowerCase()

  find(`URL: ${url || '(loading)'}`)
  find(`Elements: ${Object.keys(snap?.data?.refs || {}).length}`)

  if (!url.includes('/auth/login') && !url.includes('/login')) {
    find('Active session detected — already logged in')
    isLoggedIn = true
  } else {
    find('On login page — no active session')
  }
})

await run('No crash on load', async () => {
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Oops ErrorBoundary visible')
  assert(!text.includes('failed to fetch dynamically imported module'), 'Chunk loading error')
  find('No error boundary / chunk errors')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Login Flow', '🔐')
// ─────────────────────────────────────────────────────────────────────────────

await run('Detect login form fields', async () => {
  if (isLoggedIn) { find('Already authenticated'); pass('Session active'); return }

  const refs = getRefs()
  const text = getSnapText()
  const phoneRef  = findRef(refs, 'phone')
  const passRef   = findRef(refs, 'password')
  const submitRef = findRef(refs, 'sign in')

  find(`Phone input:   ${phoneRef  ?? '✗ not found'}`)
  find(`Password:      ${passRef   ?? '✗ not found'}`)
  find(`Sign In btn:   ${submitRef ?? '✗ not found'}`)
  if (text.includes('google'))  find('Google SSO button present')
  if (text.includes('forgot'))  find('Forgot Password link present')
  find(`Total elements: ${Object.keys(refs).length}`)

  assert(phoneRef && passRef, 'Login form fields not found')
  pass()
})

await run('Empty submit — validation check', async () => {
  if (isLoggedIn) { pass('Session active — skipping'); return }

  const refs      = getRefs()
  const submitRef = findRef(refs, 'sign in') || '@e5'
  ab('click', submitRef)
  await wait(2000)

  const text = getSnapText()
  if (text.includes('required') || text.includes('invalid') || text.includes('error') || text.includes('enter'))
    find('Validation message shown on empty submit')
  else
    warn('No validation message detected')
  pass()
})

await run('Login with phone + password', async () => {
  if (isLoggedIn) {
    find('Already authenticated — session reused')
    pass()
    return
  }
  if (!PHONE || !PASSWORD) {
    skip('Set CD_PHONE and CD_PASSWORD env vars')
    return
  }

  // Navigate fresh to get clean refs
  ab('open', `${BASE_URL}/auth/login`)
  await wait(3000)

  const refs      = getRefs()
  const phoneRef  = findRef(refs, 'phone')
  const passRef   = findRef(refs, 'password')
  const submitRef = findRef(refs, 'sign in')

  assert(phoneRef,  `Phone field not found. Refs: ${Object.keys(refs).join(', ')}`)
  assert(passRef,   `Password field not found. Refs: ${Object.keys(refs).join(', ')}`)
  assert(submitRef, `Sign In not found. Refs: ${Object.keys(refs).join(', ')}`)

  find(`Filling phone (${phoneRef}): ${PHONE}`)
  ab('fill', phoneRef, PHONE)
  await wait(400)

  find(`Filling password (${passRef})`)
  ab('fill', passRef, PASSWORD)
  await wait(400)

  find(`Clicking Sign In (${submitRef})`)
  ab('click', submitRef)
  await wait(5000)

  const url = getUrl()
  find(`After submit URL: ${url}`)

  if (url && !url.includes('/auth/login') && !url.includes('/login')) {
    find('Redirected away from login — auth succeeded ✓')
    isLoggedIn = true
    pass('Login successful')
  } else {
    const text = getSnapText()
    if (text.includes('invalid') || text.includes('incorrect') || text.includes('wrong'))
      fail('Server rejected credentials')
    else
      fail('Still on login page after submit')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Authenticated Pages', '🔑')
// ─────────────────────────────────────────────────────────────────────────────

const authPages = [
  { path: '/inbox',      label: 'Inbox',      icon: '💬', keywords: ['inbox', 'chat', 'conversation', 'message'] },
  { path: '/crm',        label: 'CRM',         icon: '👥', keywords: ['crm', 'contact', 'board', 'ticket'] },
  { path: '/dashboard',  label: 'Dashboard',   icon: '📊', keywords: ['dashboard', 'metric', 'analytics'] },
  { path: '/broadcasts', label: 'Broadcasts',  icon: '📢', keywords: ['broadcast', 'campaign', 'send'] },
  { path: '/automation', label: 'Automation',  icon: '🤖', keywords: ['automation', 'flow', 'bot'] },
  { path: '/settings',   label: 'Settings',    icon: '⚙️',  keywords: ['setting', 'profile', 'team', 'account'] },
  { path: '/calls',      label: 'Calls',       icon: '📞', keywords: ['call', 'phone', 'dialer'] },
]

for (const page of authPages) {
  await run(`${page.icon} ${page.label} (${page.path})`, async () => {
    if (!isLoggedIn) { skip('Login did not succeed'); return }

    ab('open', `${BASE_URL}${page.path}`)
    await wait(4000)

    const snap = getSnapshot()
    const url  = snap?.data?.origin || ''
    const text = JSON.stringify(snap?.data || '').toLowerCase()
    const refs = snap?.data?.refs || {}

    find(`URL: ${url}`)
    find(`Interactive elements: ${Object.keys(refs).length}`)

    assert(!text.includes("that shouldn't have happened"), 'Oops ErrorBoundary triggered')
    assert(!text.includes('failed to fetch dynamically imported module'), 'Chunk loading error')

    if (url.includes('/auth/login') || url.includes('/login')) {
      fail('Redirected to login — session lost')
      return
    }

    const foundKeywords = page.keywords.filter(k => text.includes(k))
    if (foundKeywords.length) find(`Content detected: ${foundKeywords.join(', ')}`)
    else warn('No expected content keywords — page may still be loading')

    const buttons = Object.values(refs).filter(r => r.role === 'button').length
    const inputs  = Object.values(refs).filter(r => r.role === 'textbox').length
    if (buttons) find(`Buttons: ${buttons}`)
    if (inputs)  find(`Inputs: ${inputs}`)

    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
suite('Error Resilience', '🚨')
// ─────────────────────────────────────────────────────────────────────────────

await run('Invalid route — 404 not Oops', async () => {
  ab('open', `${BASE_URL}/xyzabc-does-not-exist-999`)
  await wait(3000)
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Runtime Oops shown on bad route')
  const url = getUrl()
  find(`Landed: ${url}`)
  if (text.includes('404') || text.includes('not found') || text.includes('whoops') || text.includes('available'))
    find('404 page rendered correctly')
  else if (url.includes('/auth/login')) find('Redirected to login (auth guard)')
  else warn('No 404 indicator — may redirect elsewhere')
  pass()
})

await run('Deep nested invalid route — no crash', async () => {
  ab('open', `${BASE_URL}/inbox/thread/fake-id-99999/message/0`)
  await wait(3000)
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on deep route')
  find(`URL: ${getUrl()}`)
  pass()
})

await run('Rapid route switching — stable', async () => {
  for (const p of ['/inbox', '/crm', '/dashboard', '/broadcasts', '/settings']) {
    ab('open', `${BASE_URL}${p}`)
    await wait(700)
  }
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Crash during rapid navigation')
  find('5 rapid switches: no crash')
  pass()
})

await run('No chunk loading errors', async () => {
  ab('open', BASE_URL)
  await wait(3500)
  const text = getSnapText()
  assert(!text.includes('failed to fetch dynamically imported module'), 'Chunk error detected')
  find('No chunk loading errors on reload')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('UI & Accessibility', '♿')
// ─────────────────────────────────────────────────────────────────────────────

await run('Login page element audit', async () => {
  ab('open', `${BASE_URL}/auth/login`)
  await wait(3000)
  const refs = getRefs()
  const all  = Object.entries(refs)
  const btns = all.filter(([, r]) => r.role === 'button')
  const inps = all.filter(([, r]) => r.role === 'textbox')
  const lnks = all.filter(([, r]) => r.role === 'link')
  find(`Total elements: ${all.length}`)
  find(`Buttons (${btns.length}): ${btns.map(([, r]) => r.name || 'unnamed').join(' | ') || 'none'}`)
  find(`Inputs  (${inps.length}): ${inps.map(([, r]) => r.name || 'unnamed').join(' | ') || 'none'}`)
  find(`Links   (${lnks.length}): ${lnks.map(([, r]) => r.name || 'unnamed').join(' | ') || 'none'}`)
  pass()
})

await run('Show/hide password toggle', async () => {
  const refs        = getRefs()
  const showPassRef = findRef(refs, 'show password')
  if (showPassRef) {
    ab('click', showPassRef)
    await wait(600)
    find(`Clicked "Show password" toggle (${showPassRef})`)
  } else {
    warn('"Show password" button not found on page')
  }
  pass()
})

await run('Inbox sidebar nav items', async () => {
  if (!isLoggedIn) { skip('Requires login'); return }
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs = getRefs()
  const all  = Object.entries(refs)
  const btns = all.filter(([, r]) => r.role === 'button')
  find(`Total elements: ${all.length}`)
  find(`Nav buttons: ${btns.map(([, r]) => r.name).filter(Boolean).join(' | ')}`)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Performance', '⚡')
// ─────────────────────────────────────────────────────────────────────────────

const perfPages = [
  { path: '/auth/login', label: 'Login page' },
  ...(isLoggedIn ? [
    { path: '/inbox',     label: 'Inbox' },
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/crm',       label: 'CRM' },
  ] : []),
]

for (const p of perfPages) {
  await run(`Load time — ${p.label}`, async () => {
    const start = Date.now()
    ab('open', `${BASE_URL}${p.path}`)
    await wait(300)
    getSnapshot()
    const ms = Date.now() - start
    find(`Time to interactive: ~${ms}ms`)
    if      (ms < 3000) find('Rating: GOOD (< 3s) ✓')
    else if (ms < 6000) warn(`Rating: SLOW (${ms}ms) — target < 3s`)
    else                warn(`Rating: VERY SLOW (${ms}ms)`)
    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────────────────────

const { data, passed, failed, skipped } = saveAndPush()

log(`\n${'═'.repeat(52)}`)
log(`  TOTAL: ${passed} passed  ${failed} failed  ${skipped} skipped  (${data.summary.total} steps)`)
log(`  Duration: ${(data.durationMs / 1000).toFixed(1)}s`)
log('═'.repeat(52) + '\n')

for (const s of data.suites) {
  const icon = s.summary.failed > 0 ? '✗' : '✓'
  log(`  ${icon}  ${s.icon} ${s.name}  (${s.summary.passed}/${s.summary.total})`)
  for (const st of s.steps) {
    const si = st.status === 'pass' ? '✓' : st.status === 'fail' ? '✗' : '~'
    log(`       ${si}  ${st.name}`)
    for (const f of st.findings) log(`            · ${f}`)
    for (const e of st.errors)   log(`            ✗ ${e}`)
  }
}
log('')
process.exit(failed > 0 ? 1 : 0)
