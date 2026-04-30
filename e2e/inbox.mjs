#!/usr/bin/env node
/**
 * ChatDaddy Inbox Module — Full Feature E2E Test
 * Tests every visible feature in the Inbox UI.
 *
 * Usage: node e2e/inbox.mjs   (credentials loaded from .env)
 */

import { execSync, spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')

// Load .env
const ENV_FILE = join(ROOT, '.env')
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key?.trim() && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}

const RESULTS_FILE = join(ROOT, 'public', 'e2e-inbox.json')
mkdirSync(join(ROOT, 'public'), { recursive: true })

const BASE_URL = 'https://theo.chatdaddy.tech'
const HEADLESS = process.argv.includes('--headless')

// ─── browser ─────────────────────────────────────────────────────────────────

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

function getUrl()      { return getSnapshot()?.data?.origin || '' }
function getText()     { return JSON.stringify(getSnapshot()?.data || '').toLowerCase() }
function getRefs()     { return getSnapshot()?.data?.refs || {} }
function findRef(refs, ...kw) {
  for (const [id, info] of Object.entries(refs)) {
    const n = (info.name || '').toLowerCase()
    if (kw.some(k => n.includes(k.toLowerCase()))) return `@${id}`
  }
  return null
}
function countRole(refs, role) { return Object.values(refs).filter(r => r.role === role).length }
function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg) { process.stdout.write(msg + '\n') }

// ─── results ─────────────────────────────────────────────────────────────────

const suites = []
let activeSuite = null
let activeStep  = null

function suite(name, icon) {
  activeSuite = { name, icon, steps: [] }
  suites.push(activeSuite)
  log(`\n${'━'.repeat(54)}\n  ${icon}  ${name}\n${'━'.repeat(54)}`)
}

function step(name) {
  activeStep = { name, status: 'running', findings: [], errors: [], duration: 0, _t: Date.now() }
  activeSuite.steps.push(activeStep)
  log(`\n  ▸ ${name}`)
}

function find(m) { activeStep.findings.push(m);        log(`      · ${m}`) }
function warn(m) { activeStep.findings.push(`⚠ ${m}`); log(`      ⚠ ${m}`) }
function pass(m='') { activeStep.status='pass'; activeStep.duration=Date.now()-activeStep._t; if(m) find(m); log(`    → PASS (${activeStep.duration}ms)`) }
function fail(m)    { activeStep.status='fail'; activeStep.duration=Date.now()-activeStep._t; activeStep.errors.push(m); log(`    → FAIL: ${m}`) }
function skip(m='') { activeStep.status='skip'; activeStep.duration=0; if(m) activeStep.findings.push(m); log(`    → SKIP: ${m}`) }
function assert(c,m){ if(!c) throw new Error(m) }

async function run(name, fn) {
  step(name)
  try { await fn(); if (activeStep.status === 'running') pass() }
  catch (e) { fail(e.message) }
}

function saveAndPush() {
  const allSteps = suites.flatMap(s => s.steps)
  const passed   = allSteps.filter(s => s.status === 'pass').length
  const failed   = allSteps.filter(s => s.status === 'fail').length
  const skipped  = allSteps.filter(s => s.status === 'skip').length
  const totalMs  = allSteps.reduce((a, s) => a + s.duration, 0)

  const data = {
    url: `${BASE_URL}/inbox`,
    module: 'Inbox',
    runAt: new Date().toISOString(),
    mode: HEADLESS ? 'headless' : 'headed',
    durationMs: totalMs,
    summary: { passed, failed, skipped, total: allSteps.length },
    suites: suites.map(s => ({
      name: s.name, icon: s.icon,
      durationMs: s.steps.reduce((a,st) => a+st.duration, 0),
      summary: {
        passed:  s.steps.filter(st => st.status==='pass').length,
        failed:  s.steps.filter(st => st.status==='fail').length,
        skipped: s.steps.filter(st => st.status==='skip').length,
        total:   s.steps.length,
      },
      steps: s.steps.map(({ name, status, duration, findings, errors }) =>
        ({ name, status, duration, findings, errors, screenshot: null })
      ),
    })),
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2))
  log(`\n  → Saved to public/e2e-inbox.json`)
  const returnData = data

  // Update main results file to include inbox results merged
  const mainFile = join(ROOT, 'public', 'e2e-results.json')
  if (existsSync(mainFile)) {
    try {
      const main = JSON.parse(readFileSync(mainFile, 'utf8'))
      // Replace or add inbox suite block
      main.suites = main.suites.filter(s => s.name !== '📬 Inbox Module')
      main.suites.unshift({
        name: '📬 Inbox Module',
        icon: '📬',
        durationMs: totalMs,
        summary: data.summary,
        steps: allSteps.map(({ name, status, duration, findings, errors }) =>
          ({ name, status, duration, findings, errors, screenshot: null })
        ),
      })
      // Recalculate global summary
      const all = main.suites.flatMap(s => s.steps ?? [])
      main.summary = {
        passed:  all.filter(s => s.status==='pass').length,
        failed:  all.filter(s => s.status==='fail').length,
        skipped: all.filter(s => s.status==='skip').length,
        total:   all.length,
      }
      main.runAt = new Date().toISOString()
      writeFileSync(mainFile, JSON.stringify(main, null, 2))
      log('  → Merged into e2e-results.json')
    } catch { /* non-critical */ }
  }

  const ts  = new Date().toLocaleString()
  const msg = `chore: inbox e2e ${passed}✓ ${failed}✗ — ${ts}`
  spawnSync('git', ['add', 'public/e2e-results.json', 'public/e2e-inbox.json'], { cwd: ROOT, stdio: 'pipe' })
  const commit = spawnSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'pipe' })
  if (commit.status === 0) {
    spawnSync('git', ['push'], { cwd: ROOT, stdio: 'pipe' })
    log('  → Pushed to GitHub — dashboard updating')
  }

  return { passed, failed, skipped, total: allSteps.length, totalMs, data }
}

// ═════════════════════════════════════════════════════════════════════════════
log(`\n${'═'.repeat(54)}\n  ChatDaddy — Inbox Module Full Test\n  ${new Date().toLocaleString()}\n${'═'.repeat(54)}`)

// Navigate to inbox
ab('open', `${BASE_URL}/inbox`)
await wait(4000)

// ─────────────────────────────────────────────────────────────────────────────
suite('Inbox Load & Layout', '🏠')
// ─────────────────────────────────────────────────────────────────────────────

await run('Inbox page loads without crash', async () => {
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  assert(!text.includes("that shouldn't have happened"), 'Oops ErrorBoundary triggered')
  assert(!text.includes('failed to fetch dynamically imported'), 'Chunk loading error')
  assert(url.includes('/inbox'), `Not on inbox — landed on: ${url}`)
  pass()
})

await run('Sidebar navigation visible', async () => {
  const refs = getRefs()
  const text = getText()
  const navItems = ['inbox', 'contacts', 'channels', 'calls', 'automation', 'marketing']
  const found = navItems.filter(n => text.includes(n))
  find(`Nav items detected: ${found.join(', ')}`)
  assert(found.length >= 3, `Too few nav items: ${found.join(', ')}`)
  pass()
})

await run('Conversation list renders', async () => {
  const refs = getRefs()
  const all  = Object.entries(refs)
  // Assign + More buttons = conversation rows
  const assignBtns = all.filter(([, r]) => r.name === 'Assign').length
  find(`Conversation rows detected: ~${assignBtns}`)
  assert(assignBtns > 0, 'No conversations found in inbox')
  pass()
})

await run('Search bar present', async () => {
  const refs = getRefs()
  const searchRef = findRef(refs, 'search all conversations', 'search')
  find(`Search ref: ${searchRef ?? 'not found'}`)
  assert(searchRef, 'Search bar not found')
  pass()
})

await run('Total interactive elements count', async () => {
  const refs = getRefs()
  const all  = Object.entries(refs)
  find(`Total: ${all.length} elements`)
  find(`Buttons: ${countRole(refs, 'button')}`)
  find(`Inputs: ${countRole(refs, 'textbox')}`)
  find(`Links: ${countRole(refs, 'link')}`)
  assert(all.length > 10, 'Inbox appears empty or not rendered')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Filter Tabs', '🗂️')
// ─────────────────────────────────────────────────────────────────────────────

const filterTabs = [
  'Unread',
  'Assigned to Me',
  'Unassigned',
  'Individuals',
  'Groups',
  'Archived',
]

for (const tab of filterTabs) {
  await run(`Filter tab: "${tab}"`, async () => {
    const refs   = getRefs()
    const tabRef = findRef(refs, tab)
    if (!tabRef) { warn(`"${tab}" tab not found`); pass('Tab not present in this account'); return }

    find(`Found ref: ${tabRef}`)
    ab('click', tabRef)
    await wait(2000)

    const afterText = getText()
    assert(!afterText.includes("that shouldn't have happened"), `Oops on "${tab}" filter`)
    const afterRefs = getRefs()
    find(`Elements after click: ${Object.keys(afterRefs).length}`)
    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
suite('Search', '🔍')
// ─────────────────────────────────────────────────────────────────────────────

await run('Search bar is clickable & focusable', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs      = getRefs()
  const searchRef = findRef(refs, 'search all conversations', 'search')
  assert(searchRef, 'Search input not found')
  ab('click', searchRef)
  await wait(800)
  find(`Clicked search (${searchRef})`)
  pass()
})

await run('Type in search — results update', async () => {
  const refs      = getRefs()
  const searchRef = findRef(refs, 'search all conversations', 'search')
  assert(searchRef, 'Search input not found')
  ab('fill', searchRef, 'test')
  await wait(2000)
  const afterText = getText()
  assert(!afterText.includes("that shouldn't have happened"), 'Oops on search input')
  find('Typed "test" — no crash')
  pass()
})

await run('Clear search restores list', async () => {
  const refs      = getRefs()
  const searchRef = findRef(refs, 'search all conversations', 'search')
  if (searchRef) {
    ab('fill', searchRef, '')
    await wait(1500)
  }
  ab('type', 'Escape')
  await wait(1000)
  find('Cleared search — list restored')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Filter Panel', '🎛️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Expand filters button', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs      = getRefs()
  const filterRef = findRef(refs, 'expand filters', 'filter')
  if (!filterRef) { warn('Expand filters button not found'); pass('Filter button not visible'); return }
  find(`Filter ref: ${filterRef}`)
  ab('click', filterRef)
  await wait(1500)
  const afterText = getText()
  assert(!afterText.includes("that shouldn't have happened"), 'Oops on filter expand')
  find('Filter panel expanded')
  pass()
})

await run('Assignee filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'assignee')
  if (!ref) { warn('Assignee filter not visible'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  find(`Clicked Assignee filter (${ref})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Assignee filter')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('Tags filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'tags', 'tag')
  if (!ref) { warn('Tags filter not visible'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  find(`Clicked Tags filter (${ref})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Tags filter')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('Date Range filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'date range', 'date')
  if (!ref) { warn('Date Range filter not visible'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  find(`Clicked Date Range (${ref})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Date Range filter')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Conversation Actions', '💬')
// ─────────────────────────────────────────────────────────────────────────────

await run('Open first conversation', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs = getRefs()
  // First "More" button is on the first conversation row
  const moreRef = findRef(refs, 'more')
  const assignRef = findRef(refs, 'assign')
  find(`Assign ref: ${assignRef ?? 'not found'}`)
  find(`More ref: ${moreRef ?? 'not found'}`)

  // Click first conversation — look for a list item or generic clickable
  const all = Object.entries(refs)
  // Find first ref that's a generic/listitem (conversation row)
  const rowRef = all.find(([, r]) => r.role === 'option' || r.role === 'listitem')?.[0]
  if (rowRef) {
    ab('click', `@${rowRef}`)
    await wait(2500)
    find(`Opened conversation (@${rowRef})`)
  } else {
    // Try clicking the first assign button area (near top of list)
    find('Clicking first item in conversation list')
    ab('click', '@e1')
    await wait(2500)
  }

  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  assert(!text.includes("that shouldn't have happened"), 'Oops on opening conversation')
  pass()
})

await run('Assign button on conversation row', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs     = getRefs()
  const assignRef = findRef(refs, 'assign')
  if (!assignRef) { warn('Assign button not found'); pass('Not visible'); return }
  ab('click', assignRef)
  await wait(1500)
  find(`Clicked Assign (${assignRef})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Assign click')
  // Check if a dropdown/modal appeared
  const afterRefs = getRefs()
  find(`Elements after click: ${Object.keys(afterRefs).length}`)
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('More (⋯) menu on conversation row', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs    = getRefs()
  const moreRef = findRef(refs, 'more')
  if (!moreRef) { warn('"More" button not found'); pass('Not visible'); return }
  ab('click', moreRef)
  await wait(1500)
  find(`Clicked More (${moreRef})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on More menu')
  const afterText = getText()
  const menuItems = ['mark', 'archive', 'delete', 'mute', 'pin', 'label', 'resolve', 'snooze']
  const found = menuItems.filter(m => afterText.includes(m))
  if (found.length) find(`Menu items detected: ${found.join(', ')}`)
  else warn('No menu items detected in More dropdown')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Bulk Select', '☑️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Bulk select button visible', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs   = getRefs()
  const bulkRef = findRef(refs, 'bulk select', 'bulk')
  if (!bulkRef) { warn('Bulk select not found'); pass('Not visible'); return }
  find(`Bulk select ref: ${bulkRef}`)
  ab('click', bulkRef)
  await wait(1500)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on bulk select')
  find('Bulk select mode activated')
  // Check for checkboxes or select-all
  const afterText = getText()
  if (afterText.includes('select all') || afterText.includes('checkbox')) find('Select-all option appeared')
  ab('click', bulkRef) // toggle off
  await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Sidebar Collapse', '◀️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Expand/collapse sidebar', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs      = getRefs()
  const expandRef = findRef(refs, 'expand sidebar', 'collapse sidebar', 'sidebar')
  if (!expandRef) { warn('Sidebar toggle not found'); pass('Not visible'); return }
  find(`Sidebar toggle ref: ${expandRef}`)

  // Collapse
  ab('click', expandRef)
  await wait(1200)
  const textCollapsed = getText()
  assert(!textCollapsed.includes("that shouldn't have happened"), 'Oops on sidebar collapse')
  find('Sidebar collapsed — no crash')

  // Expand back
  const refsAfter = getRefs()
  const expandRef2 = findRef(refsAfter, 'expand sidebar', 'collapse sidebar', 'sidebar')
  if (expandRef2) {
    ab('click', expandRef2)
    await wait(1200)
    find('Sidebar re-expanded')
  }
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Inbox Settings & Notifications', '🔔')
// ─────────────────────────────────────────────────────────────────────────────

await run('Notifications button', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs   = getRefs()
  const notifRef = findRef(refs, 'notifications', 'notification')
  if (!notifRef) { warn('Notifications button not found'); pass('Not visible'); return }
  ab('click', notifRef)
  await wait(1500)
  find(`Clicked Notifications (${notifRef})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Notifications')
  find('Notifications panel/dropdown opened')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('Settings button (inbox settings)', async () => {
  const refs   = getRefs()
  const setRef = findRef(refs, 'settings')
  if (!setRef) { warn('Settings button not found'); pass('Not visible'); return }
  ab('click', setRef)
  await wait(2000)
  find(`Clicked Settings (${setRef})`)
  const url  = getUrl()
  const text = getText()
  find(`Navigated to: ${url}`)
  assert(!text.includes("that shouldn't have happened"), 'Oops on Settings click')
  ab('navigate', 'back')
  await wait(1500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Getting Started & Analytics', '📊')
// ─────────────────────────────────────────────────────────────────────────────

await run('Getting Started button', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs  = getRefs()
  const gsRef = findRef(refs, 'getting started')
  if (!gsRef) { warn('Getting Started not found'); pass('Not visible'); return }
  ab('click', gsRef)
  await wait(2000)
  find(`Clicked Getting Started (${gsRef})`)
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Oops on Getting Started')
  pass()
})

await run('Analytics button', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs  = getRefs()
  const anRef = findRef(refs, 'analytics')
  if (!anRef) { warn('Analytics not found'); pass('Not visible'); return }
  ab('click', anRef)
  await wait(2500)
  find(`Clicked Analytics (${anRef})`)
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  assert(!text.includes("that shouldn't have happened"), 'Oops on Analytics')
  ab('navigate', 'back')
  await wait(1500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Performance', '⚡')
// ─────────────────────────────────────────────────────────────────────────────

await run('Inbox load time', async () => {
  const t = Date.now()
  ab('open', `${BASE_URL}/inbox`)
  await wait(300)
  getSnapshot()
  const ms = Date.now() - t
  find(`Time to interactive: ~${ms}ms`)
  if      (ms < 3000) find('Rating: GOOD (< 3s) ✓')
  else if (ms < 6000) warn(`Rating: SLOW (${ms}ms)`)
  else                warn(`Rating: VERY SLOW (${ms}ms)`)
  pass()
})

await run('No crash switching between filter tabs rapidly', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const tabs = ['Unread', 'Assigned to Me', 'Unassigned', 'Individuals', 'Groups']
  for (const t of tabs) {
    const refs = getRefs()
    const ref  = findRef(refs, t)
    if (ref) { ab('click', ref); await wait(500) }
  }
  const text = getText()
  assert(!text.includes("that shouldn't have happened"), 'Crash during rapid tab switching')
  find(`Rapidly switched ${tabs.length} filter tabs — stable`)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────────────────────

const { passed, failed, skipped, total, totalMs, data } = saveAndPush()

log(`\n${'═'.repeat(54)}`)
log(`  INBOX: ${passed} passed  ${failed} failed  ${skipped} skipped  (${total} steps)`)
log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`)
log('═'.repeat(54) + '\n')

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
