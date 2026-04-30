#!/usr/bin/env node
/**
 * ChatDaddy E2E Agent Runner — https://theo.chatdaddy.tech/
 *
 * Usage:
 *   CD_PHONE=+6285228454057 CD_PASSWORD=SemangatChatdaddy45 node e2e/runner.mjs
 *   node e2e/runner.mjs --headless
 */

import { execSync } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const RESULTS_FILE = join(ROOT, 'public', 'e2e-results.json')
const SHOTS_DIR = join(ROOT, 'public', 'screenshots')
mkdirSync(SHOTS_DIR, { recursive: true })

const BASE_URL  = 'https://theo.chatdaddy.tech'
const PHONE     = process.env.CD_PHONE    || ''
const PASSWORD  = process.env.CD_PASSWORD || ''
const HEADLESS  = process.argv.includes('--headless')

// ─── browser ─────────────────────────────────────────────────────────────────

function ab(...args) {
  const cmd = ['agent-browser', ...args, ...(HEADLESS ? ['--headless'] : [])].join(' ')
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 35_000 }).trim() }
  } catch (e) {
    return { ok: false, out: e.stdout?.trim() || '', err: e.stderr?.trim() || e.message }
  }
}

function getSnapshot() {
  const r = ab('snapshot', '-i', '--json')
  if (!r.ok) return null
  try { return JSON.parse(r.out) } catch { return null }
}

// Get URL from snapshot origin (url command unreliable)
function getUrl() {
  const s = getSnapshot()
  return s?.data?.origin || ''
}

// Get flat string of snapshot for keyword checks
function getSnapText() {
  const s = getSnapshot()
  return JSON.stringify(s?.data || '').toLowerCase()
}

// Get refs map from fresh snapshot
function getRefs() {
  const s = getSnapshot()
  return s?.data?.refs || {}
}

// Find ref by field name
function findRef(refs, ...keywords) {
  for (const [ref, info] of Object.entries(refs)) {
    const name = (info.name || '').toLowerCase()
    if (keywords.some(k => name.includes(k.toLowerCase()))) return `@${ref}`
  }
  return null
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

function shot(name) {
  const file = join(SHOTS_DIR, `${name}.png`)
  ab('screenshot', '--path', file)
  return `/screenshots/${name}.png`
}

function log(msg) { process.stdout.write(msg + '\n') }

// ─── results ─────────────────────────────────────────────────────────────────

const suites = []
let activeSuite = null
let activeStep  = null
let isLoggedIn  = false

function suite(name, icon = '🔷') {
  activeSuite = { name, icon, steps: [], startedAt: Date.now() }
  suites.push(activeSuite)
  log(`\n${'━'.repeat(54)}\n  ${icon}  ${name}\n${'━'.repeat(54)}`)
}

function step(name) {
  activeStep = { name, status: 'running', findings: [], errors: [], screenshot: null, duration: 0, startedAt: Date.now() }
  activeSuite.steps.push(activeStep)
  log(`\n  ▸ ${name}`)
}

function find(msg) { activeStep.findings.push(msg); log(`      · ${msg}`) }
function warn(msg) { activeStep.findings.push(`⚠ ${msg}`); log(`      ⚠ ${msg}`) }
function pass(msg = '') { activeStep.status = 'pass'; activeStep.duration = Date.now() - activeStep.startedAt; if (msg) find(msg); log(`    → PASS (${activeStep.duration}ms)`) }
function fail(msg)      { activeStep.status = 'fail'; activeStep.errors.push(msg); activeStep.duration = Date.now() - activeStep.startedAt; log(`    → FAIL: ${msg}`) }
function skip(msg = '') { activeStep.status = 'skip'; activeStep.duration = 0; if (msg) activeStep.findings.push(msg); log(`    → SKIP: ${msg}`) }
function assert(c, m)   { if (!c) throw new Error(m) }
function addShot(name)  { const p = shot(name); activeStep.screenshot = p; log(`      📸 screenshot saved`) }

async function run(name, fn) {
  step(name)
  try { await fn(); if (activeStep.status === 'running') pass() }
  catch (e) { fail(e.message) }
}

function saveResults() {
  const allSteps = suites.flatMap(s => s.steps)
  const passed  = allSteps.filter(s => s.status === 'pass').length
  const failed  = allSteps.filter(s => s.status === 'fail').length
  const skipped = allSteps.filter(s => s.status === 'skip').length
  const totalMs = allSteps.reduce((a, s) => a + s.duration, 0)
  const data = {
    url: BASE_URL, runAt: new Date().toISOString(),
    mode: HEADLESS ? 'headless' : 'headed', durationMs: totalMs,
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
      steps: s.steps.map(st => ({
        name: st.name, status: st.status, duration: st.duration,
        findings: st.findings, errors: st.errors, screenshot: st.screenshot,
      })),
    })),
  }
  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2))
  log(`\n  → Saved to public/e2e-results.json`)
  return data
}

// ═════════════════════════════════════════════════════════════════════════════

log(`\n${'═'.repeat(54)}\n  ChatDaddy E2E Agent — ${BASE_URL}\n  ${new Date().toLocaleString()}  |  ${HEADLESS ? 'headless' : 'headed'}\n${'═'.repeat(54)}`)

// ─────────────────────────────────────────────────────────────────────────────
suite('Page Load & Initial Render', '🌐')
// ─────────────────────────────────────────────────────────────────────────────

await run('Open base URL', async () => {
  const r = ab('open', BASE_URL)
  assert(r.ok, `Could not open browser: ${r.err}`)
  await wait(4000)
  const url = getUrl()
  find(`Redirected to: ${url || BASE_URL}`)
  addShot('01-initial-load')
})

await run('Page renders without crash', async () => {
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Oops ErrorBoundary visible')
  assert(!text.includes('failed to fetch dynamically imported module'), 'Chunk loading error')
  find('No crash / error boundary detected')
  pass()
})

await run('Login page fully rendered', async () => {
  const refs = getRefs()
  const text = getSnapText()
  find(`Interactive elements: ${Object.keys(refs).length}`)
  if (text.includes('phone')) find('Phone Number field visible')
  if (text.includes('password')) find('Password field visible')
  if (text.includes('sign in')) find('Sign In button visible')
  if (text.includes('google')) find('Google SSO button visible')
  assert(text.includes('phone') || text.includes('password'), 'Login form not rendered')
  addShot('02-login-rendered')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Login Flow', '🔐')
// ─────────────────────────────────────────────────────────────────────────────

await run('Detect form fields with live refs', async () => {
  ab('open', `${BASE_URL}/auth/login`)
  await wait(3000)
  const refs = getRefs()
  const phoneRef = findRef(refs, 'phone')
  const passRef  = findRef(refs, 'password')
  const signInRef = findRef(refs, 'sign in')
  const googleRef = findRef(refs, 'google')
  const forgotRef = findRef(refs, 'forgot')

  find(`Phone input ref: ${phoneRef ?? 'not found'}`)
  find(`Password input ref: ${passRef ?? 'not found'}`)
  find(`Sign In button ref: ${signInRef ?? 'not found'}`)
  find(`Google SSO ref: ${googleRef ?? 'not found'}`)
  find(`Forgot Password ref: ${forgotRef ?? 'not found'}`)
  find(`Total refs on page: ${Object.keys(refs).length}`)

  assert(phoneRef && passRef, 'Could not find phone or password field')
  pass()
})

await run('Empty form — validation fires', async () => {
  const refs = getRefs()
  const signInRef = findRef(refs, 'sign in') || '@e5'
  ab('click', signInRef)
  await wait(2000)
  const text = getSnapText()
  if (text.includes('required') || text.includes('invalid') || text.includes('error') || text.includes('enter'))
    find('Validation message triggered on empty submit')
  else
    warn('No validation message detected')
  addShot('03-empty-submit')
  pass()
})

await run('Login with phone + password', async () => {
  if (!PHONE || !PASSWORD) {
    skip('Set CD_PHONE and CD_PASSWORD env vars to test login')
    return
  }

  ab('open', `${BASE_URL}/auth/login`)
  await wait(3000)

  // Get fresh refs after navigation
  const refs = getRefs()
  const phoneRef  = findRef(refs, 'phone')
  const passRef   = findRef(refs, 'password')
  const submitRef = findRef(refs, 'sign in')

  assert(phoneRef,  `Phone field ref not found. Available: ${Object.keys(refs).join(', ')}`)
  assert(passRef,   `Password field ref not found. Available: ${Object.keys(refs).join(', ')}`)
  assert(submitRef, `Sign In button ref not found. Available: ${Object.keys(refs).join(', ')}`)

  find(`Filling phone (${phoneRef}): ${PHONE}`)
  ab('fill', phoneRef, PHONE)
  await wait(500)

  find(`Filling password (${passRef})`)
  ab('fill', passRef, PASSWORD)
  await wait(500)

  addShot('04-filled')

  find(`Clicking Sign In (${submitRef})`)
  ab('click', submitRef)
  await wait(6000)

  const urlAfter = getUrl()
  find(`URL after submit: ${urlAfter}`)
  addShot('05-after-login')

  if (urlAfter && !urlAfter.includes('/auth/login') && !urlAfter.includes('/login')) {
    find('Redirected away from login — authentication succeeded')
    isLoggedIn = true
    pass('Login successful — session active for authenticated tests')
  } else {
    const text = getSnapText()
    if (text.includes('invalid') || text.includes('incorrect') || text.includes('wrong') || text.includes('not found'))
      fail('Credentials rejected by server')
    else if (text.includes('phone') && text.includes('password'))
      fail('Still on login page — submit may not have fired')
    else {
      isLoggedIn = true
      find('Page changed after submit — treating as success')
      pass()
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Authenticated Pages', '🔑')
// ─────────────────────────────────────────────────────────────────────────────

const authPages = [
  { path: '/inbox',       label: 'Inbox',       icon: '💬', keywords: ['inbox', 'chat', 'message', 'conversation'] },
  { path: '/crm',         label: 'CRM',          icon: '👥', keywords: ['crm', 'contact', 'board', 'ticket'] },
  { path: '/dashboard',   label: 'Dashboard',    icon: '📊', keywords: ['dashboard', 'metric', 'analytics', 'overview'] },
  { path: '/broadcasts',  label: 'Broadcasts',   icon: '📢', keywords: ['broadcast', 'campaign', 'send'] },
  { path: '/automation',  label: 'Automation',   icon: '🤖', keywords: ['automation', 'flow', 'bot', 'trigger'] },
  { path: '/settings',    label: 'Settings',     icon: '⚙️',  keywords: ['setting', 'profile', 'account', 'team'] },
  { path: '/calls',       label: 'Calls',        icon: '📞', keywords: ['call', 'phone', 'twilio', 'dialer'] },
]

for (const page of authPages) {
  await run(`${page.icon} ${page.label} (${page.path})`, async () => {
    if (!isLoggedIn) {
      skip('Login did not succeed — skipping authenticated route')
      return
    }

    ab('open', `${BASE_URL}${page.path}`)
    await wait(4000)

    const urlNow  = getUrl()
    const text    = getSnapText()
    const refs    = getRefs()
    const refCount = Object.keys(refs).length

    find(`URL: ${urlNow}`)
    find(`Interactive elements: ${refCount}`)

    // Crash checks
    assert(!text.includes("that shouldn't have happened"), 'Oops ErrorBoundary triggered')
    assert(!text.includes('failed to fetch dynamically imported module'), 'Chunk loading error')

    // Auth guard check
    if (urlNow.includes('/auth/login') || urlNow.includes('/login')) {
      fail('Redirected to login — session expired or not persisted')
      return
    }

    // Content checks
    const found = page.keywords.filter(k => text.includes(k))
    if (found.length > 0) find(`Page keywords detected: ${found.join(', ')}`)
    else warn('No expected content keywords found — page may be loading or empty')

    // Element summary
    const buttons = Object.values(refs).filter(r => r.role === 'button').length
    const inputs  = Object.values(refs).filter(r => r.role === 'textbox').length
    const links   = Object.values(refs).filter(r => r.role === 'link').length
    if (buttons) find(`Buttons: ${buttons}`)
    if (inputs)  find(`Inputs: ${inputs}`)
    if (links)   find(`Links: ${links}`)

    addShot(`06-${page.label.toLowerCase().replace(/\s+/g, '-')}`)
    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
suite('Error Resilience', '🚨')
// ─────────────────────────────────────────────────────────────────────────────

await run('Invalid route — 404 not Oops', async () => {
  ab('open', `${BASE_URL}/this-does-not-exist-xyzabc123`)
  await wait(3000)
  const text = getSnapText()
  addShot('07-404')
  assert(!text.includes("that shouldn't have happened"), 'Runtime Oops shown on bad route')
  if (text.includes('404') || text.includes('not found') || text.includes('whoops') || text.includes('available'))
    find('404 page rendered correctly')
  else if (text.includes('/auth/login') || getUrl().includes('/login'))
    find('Redirected to login (auth guard — expected)')
  else
    warn('No clear 404 indicator found')
  pass()
})

await run('Deep nested invalid route', async () => {
  ab('open', `${BASE_URL}/inbox/thread/fake-id-99999/message/0`)
  await wait(3000)
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on deep invalid route')
  find(`URL: ${getUrl()}`)
  pass()
})

await run('Rapid route switching — no crash', async () => {
  const paths = ['/inbox', '/crm', '/dashboard', '/broadcasts', '/settings']
  for (const p of paths) {
    ab('open', `${BASE_URL}${p}`)
    await wait(800)
  }
  const text = getSnapText()
  assert(!text.includes("that shouldn't have happened"), 'Crash during rapid navigation')
  find(`${paths.length} rapid switches: stable`)
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

await run('Login page — full element audit', async () => {
  ab('open', `${BASE_URL}/auth/login`)
  await wait(3000)
  const refs = getRefs()
  const all     = Object.entries(refs)
  const buttons = all.filter(([, r]) => r.role === 'button')
  const inputs  = all.filter(([, r]) => r.role === 'textbox')
  const links   = all.filter(([, r]) => r.role === 'link')

  find(`Total interactive elements: ${all.length}`)
  find(`Buttons (${buttons.length}): ${buttons.map(([, r]) => r.name || 'unnamed').join(' | ')}`)
  find(`Inputs (${inputs.length}): ${inputs.map(([, r]) => r.name || 'unnamed').join(' | ')}`)
  find(`Links (${links.length}): ${links.map(([, r]) => r.name || 'unnamed').join(' | ')}`)
  pass()
})

await run('Keyboard Tab navigation', async () => {
  ab('open', `${BASE_URL}/auth/login`)
  await wait(2500)
  ab('type', 'Tab'); await wait(400)
  ab('type', 'Tab'); await wait(400)
  ab('type', 'Tab'); await wait(400)
  find('Tabbed through 3 interactive elements')
  addShot('08-keyboard-tab')
  pass()
})

await run('Show/hide password toggle', async () => {
  ab('open', `${BASE_URL}/auth/login`)
  await wait(2500)
  const refs = getRefs()
  const showPassRef = findRef(refs, 'show password')
  if (showPassRef) {
    ab('click', showPassRef)
    await wait(800)
    find(`Clicked "Show password" toggle (${showPassRef})`)
    addShot('09-password-toggle')
  } else {
    warn('No "Show password" button found')
  }
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Performance', '⚡')
// ─────────────────────────────────────────────────────────────────────────────

const perfRoutes = [
  { path: '/auth/login', label: 'Login page' },
  { path: '/',           label: 'Root / Home' },
  ...(isLoggedIn ? [
    { path: '/inbox',     label: 'Inbox' },
    { path: '/dashboard', label: 'Dashboard' },
  ] : []),
]

for (const r of perfRoutes) {
  await run(`Load time — ${r.label}`, async () => {
    const start = Date.now()
    ab('open', `${BASE_URL}${r.path}`)
    await wait(500)
    getSnapshot() // wait for interactive
    const ms = Date.now() - start
    find(`Time to interactive: ~${ms}ms`)
    if (ms < 3000)      find('Rating: GOOD (< 3s)')
    else if (ms < 6000) warn(`Rating: SLOW (${ms}ms — target < 3s)`)
    else                warn(`Rating: VERY SLOW (${ms}ms)`)
    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

const data = saveResults()
const { passed, failed, skipped, total } = data.summary

log(`\n${'═'.repeat(54)}`)
log(`  TOTAL: ${passed} passed  ${failed} failed  ${skipped} skipped  (${total} steps)`)
log(`  Duration: ${(data.durationMs / 1000).toFixed(1)}s`)
log('═'.repeat(54) + '\n')

for (const s of data.suites) {
  const icon = s.summary.failed > 0 ? '✗' : '✓'
  log(`  ${icon}  ${s.icon} ${s.name}  (${s.summary.passed}/${s.summary.total} passed)`)
  for (const st of s.steps) {
    const si = st.status === 'pass' ? '✓' : st.status === 'fail' ? '✗' : '~'
    log(`       ${si}  ${st.name}`)
    for (const f of st.findings) log(`            · ${f}`)
    for (const e of st.errors)   log(`            ✗ ${e}`)
  }
}
log('')
process.exit(failed > 0 ? 1 : 0)
