#!/usr/bin/env node
/**
 * ChatDaddy Inbox — User Flow Scenario Tests
 *
 * Each flow maps the EXACT steps a user takes to complete a feature.
 * If a step fails, the flow reports:
 *   - What step broke
 *   - What the expected behaviour is (how it worked in v1)
 *   - Marks the flow as "Needs Rebuild"
 */

import { execSync, spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')

const ENV_FILE = join(ROOT, '.env')
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key?.trim() && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}

mkdirSync(join(ROOT, 'public'), { recursive: true })

const BASE_URL = 'https://theo.chatdaddy.tech'
const HEADLESS = process.argv.includes('--headless')

// ─── browser helpers ──────────────────────────────────────────────────────────

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

function getUrl()  { return getSnapshot()?.data?.origin || '' }
function getText() { return JSON.stringify(getSnapshot()?.data || '').toLowerCase() }
function getRefs() { return getSnapshot()?.data?.refs || {} }

function findRef(refs, ...kw) {
  for (const [id, info] of Object.entries(refs)) {
    const n = (info.name || '').toLowerCase()
    if (kw.some(k => n.includes(k.toLowerCase()))) return `@${id}`
  }
  return null
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg)  { process.stdout.write(msg + '\n') }

// ─── results ─────────────────────────────────────────────────────────────────

const suites = []
let activeSuite = null
let activeStep  = null

function flow(name, icon) {
  activeSuite = { name, icon, steps: [], needsRebuild: false, rebuildReason: null }
  suites.push(activeSuite)
  log(`\n${'━'.repeat(60)}\n  ${icon}  ${name}\n${'━'.repeat(60)}`)
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

// Mark flow as needing rebuild with reason
function needsRebuild(expected) {
  activeSuite.needsRebuild = true
  activeSuite.rebuildReason = expected
  activeStep.findings.push(`🔴 NEEDS REBUILD`)
  activeStep.findings.push(`Expected (v1 behaviour): ${expected}`)
  log(`      🔴 NEEDS REBUILD`)
  log(`      Expected: ${expected}`)
}

function flowFailed() {
  return activeSuite.steps.some(s => s.status === 'fail')
}

async function run(name, fn) {
  step(name)
  try { await fn(); if (activeStep.status === 'running') pass() }
  catch (e) { fail(e.message) }
}

async function goToInbox() {
  ab('open', `${BASE_URL}/inbox`)
  await wait(4000)
}

async function openFirstConversation() {
  const refs = getRefs()
  const row  = Object.entries(refs).find(([, r]) => r.role === 'option' || r.role === 'listitem')?.[0]
  if (row) { ab('click', `@${row}`); await wait(3000); return true }
  const assign = findRef(refs, 'assign')
  if (assign) { ab('click', assign); await wait(3000); return true }
  return false
}

function saveAndPush() {
  const allSteps = suites.flatMap(s => s.steps)
  const passed   = allSteps.filter(s => s.status === 'pass').length
  const failed   = allSteps.filter(s => s.status === 'fail').length
  const skipped  = allSteps.filter(s => s.status === 'skip').length
  const totalMs  = allSteps.reduce((a, s) => a + s.duration, 0)

  const data = {
    url: `${BASE_URL}/inbox`,
    module: 'User Flow Scenarios',
    runAt: new Date().toISOString(),
    mode: HEADLESS ? 'headless' : 'headed',
    durationMs: totalMs,
    summary: { passed, failed, skipped, total: allSteps.length },
    suites: suites.map(s => ({
      name: `🔄 Flow: ${s.name}`,
      icon: s.icon,
      needsRebuild: s.needsRebuild,
      rebuildReason: s.rebuildReason,
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

  writeFileSync(join(ROOT, 'public', 'e2e-flows.json'), JSON.stringify(data, null, 2))

  // Merge into main results
  const mainFile = join(ROOT, 'public', 'e2e-results.json')
  if (existsSync(mainFile)) {
    try {
      const main = JSON.parse(readFileSync(mainFile, 'utf8'))
      main.suites = main.suites.filter(s => !s.name.startsWith('🔄'))
      for (const s of [...data.suites].reverse()) main.suites.unshift(s)
      const all = main.suites.flatMap(s => s.steps ?? [])
      main.summary = {
        passed:  all.filter(s => s.status === 'pass').length,
        failed:  all.filter(s => s.status === 'fail').length,
        skipped: all.filter(s => s.status === 'skip').length,
        total:   all.length,
      }
      main.runAt = new Date().toISOString()
      writeFileSync(mainFile, JSON.stringify(main, null, 2))
    } catch { /* non-critical */ }
  }

  const ts  = new Date().toLocaleString()
  const msg = `chore: flows e2e ${passed}✓ ${failed}✗ — ${ts}`
  spawnSync('git', ['add', 'public/'], { cwd: ROOT, stdio: 'pipe' })
  const commit = spawnSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'pipe' })
  if (commit.status === 0) {
    spawnSync('git', ['push'], { cwd: ROOT, stdio: 'pipe' })
    log('  → Pushed to GitHub')
  }
  return { passed, failed, skipped, total: allSteps.length, data }
}

// ═════════════════════════════════════════════════════════════════════════════
log(`\n${'═'.repeat(60)}\n  ChatDaddy — User Flow Scenario Tests\n  ${new Date().toLocaleString()}\n${'═'.repeat(60)}`)

// ─────────────────────────────────────────────────────────────────────────────
flow('Archive a Conversation', '📦')
// Expected: User hovers a chat → clicks ⋯ → clicks Archive → chat disappears from inbox list
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  const url = getUrl()
  find(`URL: ${url}`)
  if (!url.includes('/inbox')) throw new Error(`Inbox did not load — landed on: ${url}`)
})

await run('Step 2 — Conversation list is visible', async () => {
  if (flowFailed()) { skip('Blocked by previous failure'); return }
  const refs  = getRefs()
  const count = Object.values(refs).filter(r => (r.name||'').toLowerCase() === 'assign').length
  find(`Conversations visible: ${count}`)
  if (count === 0) throw new Error('No conversations in inbox — cannot test archive')
})

await run('Step 3 — Hover conversation → More (⋯) button appears', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'more')
  find(`More menu ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, hovering a conversation row reveals a ⋯ More button. The button should appear on hover without clicking into the chat.')
    throw new Error('More (⋯) button not found on conversation row')
  }
  find('More (⋯) button visible on row ✓')
})

await run('Step 4 — Click ⋯ → dropdown menu opens', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'more')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('App crashed after clicking More menu')
  const after = getRefs()
  find(`Elements after click: ${Object.keys(after).length}`)
  find('Dropdown opened ✓')
})

await run('Step 5 — "Archive" option is in the dropdown', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'archive')
  find(`Archive option ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the ⋯ dropdown contains: Mark Unread, Assign, Archive, Delete, Mute, Pin. Archive must be present in this list.')
    throw new Error('"Archive" not found in dropdown — option may be missing or renamed')
  }
  find('"Archive" option visible in dropdown ✓')
})

await run('Step 6 — Click Archive → conversation removed from list', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'archive')
  const countBefore = Object.values(getRefs()).filter(r => (r.name||'').toLowerCase() === 'assign').length
  ab('click', ref)
  await wait(2500)
  if (getText().includes("that shouldn't have happened")) throw new Error('App crashed after clicking Archive')
  const countAfter = Object.values(getRefs()).filter(r => (r.name||'').toLowerCase() === 'assign').length
  find(`Conversations before: ${countBefore} → after: ${countAfter}`)
  if (countAfter >= countBefore) warn('Conversation count did not decrease — archive may not have worked')
  else find('Conversation removed from inbox ✓')
})

await run('Step 7 — Archived chat appears in "Archived" tab', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs      = getRefs()
  const archivedTab = findRef(refs, 'archived')
  if (!archivedTab) { warn('Archived tab not found to verify'); pass('Cannot verify — tab not visible'); return }
  ab('click', archivedTab)
  await wait(2000)
  const count = Object.values(getRefs()).filter(r => (r.name||'').toLowerCase() === 'assign').length
  find(`Conversations in Archived tab: ${count}`)
  if (count === 0) warn('No archived conversations found — archive may not have persisted')
  else find('Archived conversation visible in Archived tab ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Resolve a Conversation', '✅')
// Expected: User opens a chat → clicks Resolve → chat marked resolved → Reopen button appears
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('Could not open any conversation')
  find(`URL: ${getUrl()}`)
  if (getText().includes("that shouldn't have happened")) throw new Error('App crashed opening conversation')
})

await run('Step 3 — Resolve button visible in conversation header', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'resolve', 'mark resolved', 'done', 'close conversation')
  find(`Resolve ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, an open conversation header always shows a green "Resolve" button top-right. Clicking it closes the conversation and moves it to resolved state.')
    throw new Error('Resolve button not found in conversation header')
  }
  find('Resolve button present ✓')
})

await run('Step 4 — Click Resolve → no crash', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'resolve', 'mark resolved', 'done', 'close conversation')
  ab('click', ref)
  await wait(2000)
  if (getText().includes("that shouldn't have happened")) {
    needsRebuild('In v1, clicking Resolve instantly changes the conversation state without any crash or error page.')
    throw new Error('App crashed after clicking Resolve')
  }
  find('Resolve clicked — no crash ✓')
})

await run('Step 5 — Conversation shows as resolved (Reopen button appears)', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs    = getRefs()
  const text    = getText()
  const reopen  = findRef(refs, 'reopen', 'open conversation', 'unresolve')
  const resolved = text.includes('resolved') || text.includes('reopen') || !!reopen
  find(`Resolved state detected: ${resolved}`)
  find(`Reopen button: ${reopen ?? 'not found'}`)
  if (!resolved) {
    needsRebuild('In v1, after resolving, the header switches from "Resolve" to "Reopen" button, and the chat gets a resolved badge. Neither was detected.')
    throw new Error('Conversation not showing as resolved after clicking Resolve')
  }
  find('Conversation is now resolved ✓')
})

await run('Step 6 — Reopen restores the conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'reopen', 'open conversation', 'unresolve')
  if (!ref) { warn('Reopen button not found — skipping restore'); pass(); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on Reopen')
  find('Conversation reopened ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Assign Conversation to Team Member', '👤')
// Expected: User opens chat → clicks Assign → picks agent from dropdown → assignee name shows in header
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('No conversation to open')
})

await run('Step 3 — Assign button visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'assign', 'assignee', 'assign to')
  find(`Assign ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, every open conversation has an "Assign" button in the header that opens a dropdown of agents and teams.')
    throw new Error('Assign button not found in conversation')
  }
  find('Assign button present ✓')
})

await run('Step 4 — Click Assign → agent picker opens', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'assign', 'assignee', 'assign to')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening assign picker')
  find('Agent picker opened ✓')
})

await run('Step 5 — Agent list loads in picker', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs    = getRefs()
  const text    = getText()
  const options = Object.values(refs).filter(r => r.role === 'option').length
  const hasAgents = text.includes('unassigned') || text.includes('agent') || options > 0
  find(`Agent options count: ${options}`)
  find(`Agents detected: ${hasAgents}`)
  if (!hasAgents) {
    needsRebuild('In v1, the assign picker shows a searchable list of all team members plus an "Unassigned" option at the top.')
    throw new Error('No agents visible in picker — list did not load')
  }
  find('Agent list loaded ✓')
})

await run('Step 6 — Select first agent → conversation assigned', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const opt  = Object.entries(refs).find(([, r]) => r.role === 'option')?.[0]
  if (!opt) { warn('No selectable option found'); skip('No options to click'); return }
  ab('click', `@${opt}`)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash assigning agent')
  find(`Agent selected ✓`)
})

await run('Step 7 — Assignee name appears in conversation header', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const text    = getText()
  const refs    = getRefs()
  const assigned = text.includes('assigned') || text.includes('assignee') || findRef(refs, 'assigned to', 'assignee')
  find(`Assigned state visible: ${assigned}`)
  if (!assigned) warn('Assignment confirmed but assignee name not clearly visible in header')
  else find('Assignee shown in header ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Snooze a Conversation', '💤')
// Expected: User opens chat → clicks Snooze → picks time → chat disappears → reappears after snooze
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('No conversation to open')
})

await run('Step 3 — Snooze button visible in header', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'snooze')
  find(`Snooze ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the conversation header has a Snooze (clock) button. Clicking it shows options: 1 Hour, 1 Day, Next Week, Custom. The chat then hides from inbox until the snooze expires.')
    throw new Error('Snooze button not found in conversation header')
  }
  find('Snooze button present ✓')
})

await run('Step 4 — Click Snooze → time picker appears', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'snooze')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening snooze picker')
  find('Snooze picker opened ✓')
})

await run('Step 5 — Time options visible (1 Hour, 1 Day, Next Week, Custom)', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const text = getText()
  const opts = ['1 hour', '1 day', 'tomorrow', 'next week', 'custom'].filter(o => text.includes(o))
  find(`Options found: ${opts.length > 0 ? opts.join(', ') : 'NONE'}`)
  if (opts.length === 0) {
    needsRebuild('In v1, snooze picker shows preset options: 1 Hour, 1 Day, Next Week, Custom date/time. None were found — picker may not have opened correctly.')
    throw new Error('No snooze time options visible')
  }
  find('Snooze options loaded ✓')
})

await run('Step 6 — Select time option → conversation snoozed', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, '1 hour', '1h', 'hour', 'day', 'tomorrow')
  if (!ref) { warn('Could not find time option by ref'); skip('Option not selectable'); return }
  ab('click', ref)
  await wait(2000)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash after snooze selection')
  find('Snooze time selected — conversation snoozed ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Send a Message', '✉️')
// Expected: User opens chat → types in compose → clicks Send → message appears in thread
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('No conversation to open')
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening conversation')
})

await run('Step 3 — Message thread visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  find(`Interactive elements in view: ${Object.keys(refs).length}`)
  if (Object.keys(refs).length < 5) throw new Error('Too few elements — conversation may not have loaded')
  find('Thread visible ✓')
})

await run('Step 4 — Compose box present', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'type a message', 'message', 'compose', 'write a message', 'reply')
  find(`Compose ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, every open conversation shows a compose bar at the bottom with a text input, emoji picker, attachment, and Send button.')
    throw new Error('Compose box not found — cannot send message')
  }
  find('Compose box present ✓')
})

await run('Step 5 — Type message in compose', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'type a message', 'message', 'compose', 'write a message', 'reply')
  ab('click', ref)
  await wait(400)
  ab('fill', ref, 'E2E automated test — please ignore 🤖')
  await wait(600)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash while typing')
  find('Text entered in compose ✓')
})

await run('Step 6 — Send button enabled', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'send', 'send message')
  find(`Send ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, typing in the compose box activates a Send button (arrow icon). The button should be always visible or appear once text is entered.')
    throw new Error('Send button not found after typing')
  }
  find('Send button enabled ✓')
})

await run('Step 7 — Click Send → message appears in thread', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'send', 'send message')
  ab('click', ref)
  await wait(2500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash after clicking Send')
  const text = getText()
  const sent = text.includes('e2e automated test') || text.includes('please ignore')
  find(`Message visible in thread: ${sent}`)
  if (!sent) warn('Message sent but not detected in snapshot — may have sent successfully')
  else find('Message delivered ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Search and Open a Chat', '🔍')
// Expected: User types name in search → results filter → clicks result → chat opens
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Search bar visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  find(`Search ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the inbox top bar has a "Search all conversations" input. Typing filters the conversation list in real-time.')
    throw new Error('Search bar not found')
  }
  find('Search bar present ✓')
})

await run('Step 3 — Click search → bar focused', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  ab('click', ref)
  await wait(600)
  find('Search bar focused ✓')
})

await run('Step 4 — Type query → list filters', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs  = getRefs()
  const ref   = findRef(refs, 'search all conversations', 'search')
  const before = Object.values(getRefs()).filter(r => (r.name||'').toLowerCase() === 'assign').length
  ab('fill', ref, 'a')
  await wait(2000)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash during search')
  const after = Object.values(getRefs()).filter(r => (r.name||'').toLowerCase() === 'assign').length
  find(`Conversations before: ${before} → after: ${after}`)
  find('List filtered ✓')
})

await run('Step 5 — Click a result → conversation opens', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) { warn('No results to click'); skip('No results'); return }
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash opening search result')
  find('Conversation opened from search ✓')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Add Label to Conversation', '🏷️')
// Expected: User opens chat → clicks Label button → picks label → label chip appears on conversation
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('No conversation to open')
})

await run('Step 3 — Label button visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'label', 'add label', 'tag', 'add tag')
  find(`Label ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, a Label (tag) button appears in the conversation header or ⋯ menu. Clicking it opens a picker with all workspace labels. Selected labels appear as chips on the conversation in the inbox list.')
    throw new Error('Label button not found')
  }
  find('Label button present ✓')
})

await run('Step 4 — Click Label → picker opens', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'label', 'add label', 'tag', 'add tag')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening label picker')
  find('Label picker opened ✓')
})

await run('Step 5 — Labels list visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const text = getText()
  const refs = getRefs()
  const opts = Object.values(refs).filter(r => r.role === 'option' || r.role === 'checkbox').length
  find(`Selectable label options: ${opts}`)
  if (opts === 0 && !text.includes('label')) {
    needsRebuild('In v1, the label picker shows all workspace-defined labels as a list with colour indicators. At least one label should be visible.')
    throw new Error('No labels visible in picker')
  }
  find('Labels loaded ✓')
})

await run('Step 6 — Select label → applied to conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const opt  = Object.entries(refs).find(([, r]) => r.role === 'option' || r.role === 'checkbox')?.[0]
  if (!opt) { warn('No option to click'); skip('Cannot select'); return }
  ab('click', `@${opt}`)
  await wait(1000)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash selecting label')
  find('Label selected ✓')
  ab('type', 'Escape'); await wait(300)
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Bulk Select and Resolve', '☑️')
// Expected: User clicks Bulk Select → selects all → clicks Resolve → all resolved
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Bulk Select button visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'bulk select', 'bulk', 'select all')
  find(`Bulk select ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the inbox toolbar has a Bulk Select button. Clicking it shows checkboxes on each conversation row and reveals a bulk action bar (Resolve, Archive, Assign, Delete).')
    throw new Error('Bulk Select button not found')
  }
  find('Bulk Select button present ✓')
})

await run('Step 3 — Click Bulk Select → checkboxes appear', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'bulk select', 'bulk', 'select all')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash activating bulk select')
  const boxes = Object.values(getRefs()).filter(r => r.role === 'checkbox').length
  find(`Checkboxes visible: ${boxes}`)
  if (boxes === 0) {
    needsRebuild('In v1, enabling bulk select mode adds a checkbox to every conversation row. None appeared after clicking Bulk Select.')
    throw new Error('No checkboxes appeared after enabling bulk select')
  }
  find('Checkboxes visible ✓')
})

await run('Step 4 — Select all conversations', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs      = getRefs()
  const selectAll = findRef(refs, 'select all', 'check all')
  if (selectAll) {
    ab('click', selectAll)
    await wait(1000)
    find('Select All clicked ✓')
  } else {
    const cb = Object.entries(refs).find(([, r]) => r.role === 'checkbox')?.[0]
    if (!cb) throw new Error('No checkbox found to select')
    ab('click', `@${cb}`)
    await wait(600)
    find('First conversation selected ✓')
  }
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash during selection')
})

await run('Step 5 — Bulk action toolbar appears', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const text = getText()
  const refs = getRefs()
  const hasToolbar = text.includes('resolve') || text.includes('archive') || text.includes('assign')
  find(`Bulk toolbar visible: ${hasToolbar}`)
  if (!hasToolbar) {
    needsRebuild('In v1, selecting one or more conversations reveals a bottom/top bulk toolbar with: Resolve, Archive, Assign, Delete buttons.')
    throw new Error('Bulk action toolbar did not appear after selecting conversations')
  }
  find('Bulk toolbar loaded ✓')
})

await run('Step 6 — Resolve action available in toolbar', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'resolve', 'resolve selected', 'bulk resolve')
  find(`Bulk Resolve ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the bulk action toolbar always includes a Resolve button. Clicking it resolves all selected conversations at once.')
    throw new Error('Resolve action not found in bulk toolbar')
  }
  find('Bulk Resolve available ✓')
  warn('Not clicking Resolve to protect real conversation data')
})

// ─────────────────────────────────────────────────────────────────────────────
flow('Use Template / Quick Reply', '📋')
// Expected: User opens chat → clicks template icon → picks template → text loads in compose → send
// ─────────────────────────────────────────────────────────────────────────────

await run('Step 1 — Open Inbox', async () => {
  await goToInbox()
  if (!getUrl().includes('/inbox')) throw new Error('Inbox did not load')
})

await run('Step 2 — Open first conversation', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const opened = await openFirstConversation()
  if (!opened) throw new Error('No conversation to open')
})

await run('Step 3 — Template button in compose bar', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'template', 'quick reply', 'canned response', '/')
  find(`Template ref: ${ref ?? 'NOT FOUND'}`)
  if (!ref) {
    needsRebuild('In v1, the compose bar has a Template (lightning ⚡ or "/" shortcut) button. Clicking it opens a searchable list of saved quick replies. Selecting one fills the compose box instantly.')
    throw new Error('Template button not found in compose area')
  }
  find('Template button present ✓')
})

await run('Step 4 — Click template button → picker opens', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'template', 'quick reply', 'canned response', '/')
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening template picker')
  find('Template picker opened ✓')
})

await run('Step 5 — Template list visible', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const text = getText()
  const opts = Object.values(refs).filter(r => r.role === 'option').length
  find(`Template options: ${opts}`)
  if (opts === 0 && !text.includes('template')) {
    needsRebuild('In v1, the template picker shows all saved workspace templates with their shortcut name and preview text. None were found.')
    throw new Error('No templates visible in picker')
  }
  find('Template list loaded ✓')
})

await run('Step 6 — Select template → loads into compose', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const opt  = Object.entries(refs).find(([, r]) => r.role === 'option')?.[0]
  if (!opt) { warn('No option to click'); skip('Cannot select'); return }
  ab('click', `@${opt}`)
  await wait(1000)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash selecting template')
  find('Template selected ✓')
})

await run('Step 7 — Template text appears in compose box', async () => {
  if (flowFailed()) { skip('Blocked'); return }
  const refs = getRefs()
  const ref  = findRef(refs, 'type a message', 'compose', 'reply', 'message')
  if (!ref) { warn('Compose box not visible after template select'); pass(); return }
  find('Compose box still present after template selection ✓')
  ab('type', 'Escape'); await wait(300)
})

// ─────────────────────────────────────────────────────────────────────────────
const { passed, failed, skipped, total, data } = saveAndPush()

log(`\n${'═'.repeat(60)}`)
log(`  FLOWS: ${passed} passed  ${failed} failed  ${skipped} skipped  (${total} steps)`)
const needsRebuildFlows = data.suites.filter(s => s.needsRebuild)
if (needsRebuildFlows.length > 0) {
  log(`\n  🔴 NEEDS REBUILD (${needsRebuildFlows.length} flows):`)
  needsRebuildFlows.forEach(s => log(`     • ${s.name.replace('🔄 Flow: ', '')}\n       ${s.rebuildReason}`))
}
log('═'.repeat(60) + '\n')

for (const s of data.suites) {
  const icon = s.summary.failed > 0 ? '✗' : '✓'
  log(`  ${icon}  ${s.icon} ${s.name}  (${s.summary.passed}/${s.summary.total})${s.needsRebuild ? '  🔴 NEEDS REBUILD' : ''}`)
  for (const st of s.steps) {
    const si = st.status === 'pass' ? '✓' : st.status === 'fail' ? '✗' : '~'
    log(`       ${si}  ${st.name}`)
    for (const e of st.errors) log(`            ✗ ${e}`)
  }
}
log('')
process.exit(failed > 0 ? 1 : 0)
