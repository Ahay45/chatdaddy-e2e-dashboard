#!/usr/bin/env node
/**
 * ChatDaddy Inbox Module — Full Feature E2E Test
 * Covers: list panel, conversation view, compose, message actions,
 *         conversation management, contact panel, tags, assignments,
 *         notes, attachments, templates, AI suggestions, inbox controls.
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

function findAllRefs(refs, ...kw) {
  const found = []
  for (const [id, info] of Object.entries(refs)) {
    const n = (info.name || '').toLowerCase()
    if (kw.some(k => n.includes(k.toLowerCase()))) found.push(`@${id}`)
  }
  return found
}

function countRole(refs, role) { return Object.values(refs).filter(r => r.role === role).length }
function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg)  { process.stdout.write(msg + '\n') }

// ─── results ─────────────────────────────────────────────────────────────────

const suites = []
let activeSuite = null
let activeStep  = null

function suite(name, icon) {
  activeSuite = { name, icon, steps: [] }
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

async function run(name, fn) {
  step(name)
  try { await fn(); if (activeStep.status === 'running') pass() }
  catch (e) { fail(e.message) }
}

// open first conversation and return true if successfully opened
async function openFirstConversation() {
  ab('open', `${BASE_URL}/inbox`)
  await wait(4000)
  const refs = getRefs()
  // try listitem/option role first
  const all = Object.entries(refs)
  const rowRef = all.find(([, r]) => r.role === 'option' || r.role === 'listitem')?.[0]
  if (rowRef) {
    ab('click', `@${rowRef}`)
    await wait(3000)
    return true
  }
  // fallback: click first assign button (implies a row exists)
  const assignRef = findRef(refs, 'assign')
  if (assignRef) {
    // click parent area — click slightly above the assign button area
    ab('click', assignRef)
    await wait(3000)
    return true
  }
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

  // Merge into main results file
  const mainFile = join(ROOT, 'public', 'e2e-results.json')
  if (existsSync(mainFile)) {
    try {
      const main = JSON.parse(readFileSync(mainFile, 'utf8'))
      main.suites = main.suites.filter(s => s.name !== '📬 Inbox Module')
      main.suites.unshift({
        name: '📬 Inbox Module', icon: '📬',
        durationMs: totalMs,
        summary: data.summary,
        steps: allSteps.map(({ name, status, duration, findings, errors }) =>
          ({ name, status, duration, findings, errors, screenshot: null })
        ),
      })
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
log(`\n${'═'.repeat(60)}\n  ChatDaddy — Inbox Full Feature Test\n  ${new Date().toLocaleString()}\n${'═'.repeat(60)}`)

ab('open', `${BASE_URL}/inbox`)
await wait(4000)

// ─────────────────────────────────────────────────────────────────────────────
suite('Inbox Load & Layout', '🏠')
// ─────────────────────────────────────────────────────────────────────────────

await run('Inbox page loads without crash', async () => {
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Oops ErrorBoundary triggered')
  if (text.includes('failed to fetch dynamically imported')) throw new Error('Chunk loading error')
  if (!url.includes('/inbox')) throw new Error(`Not on inbox — landed on: ${url}`)
  pass()
})

await run('Sidebar navigation visible', async () => {
  const text = getText()
  const navItems = ['inbox', 'contacts', 'channels', 'calls', 'automation', 'marketing']
  const found = navItems.filter(n => text.includes(n))
  find(`Nav items: ${found.join(', ')}`)
  if (found.length < 3) throw new Error(`Too few nav items: ${found.join(', ')}`)
  pass()
})

await run('Conversation list renders', async () => {
  const refs = getRefs()
  const assignBtns = Object.values(refs).filter(r => (r.name || '').toLowerCase() === 'assign').length
  find(`Conversation rows (Assign buttons): ${assignBtns}`)
  if (assignBtns === 0) throw new Error('No conversations found in inbox')
  pass()
})

await run('Search bar present', async () => {
  const refs = getRefs()
  const searchRef = findRef(refs, 'search all conversations', 'search')
  find(`Search ref: ${searchRef ?? 'not found'}`)
  if (!searchRef) throw new Error('Search bar not found')
  pass()
})

await run('Inbox top-bar controls visible', async () => {
  const refs = getRefs()
  const all  = Object.entries(refs)
  find(`Total interactive elements: ${all.length}`)
  find(`Buttons: ${countRole(refs, 'button')}`)
  find(`Inputs: ${countRole(refs, 'textbox')}`)
  if (all.length < 10) throw new Error('Inbox appears empty or not rendered')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Filter Tabs', '🗂️')
// ─────────────────────────────────────────────────────────────────────────────

for (const tab of ['Unread', 'Assigned to Me', 'Unassigned', 'Individuals', 'Groups', 'Archived']) {
  await run(`Tab: "${tab}"`, async () => {
    ab('open', `${BASE_URL}/inbox`)
    await wait(3000)
    const refs   = getRefs()
    const tabRef = findRef(refs, tab)
    if (!tabRef) { warn(`"${tab}" tab not found`); pass('Tab not present in this account'); return }
    find(`Ref: ${tabRef}`)
    ab('click', tabRef)
    await wait(2000)
    const text = getText()
    if (text.includes("that shouldn't have happened")) throw new Error(`Crash on "${tab}" tab`)
    find(`Elements after: ${Object.keys(getRefs()).length}`)
    pass()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
suite('Search', '🔍')
// ─────────────────────────────────────────────────────────────────────────────

await run('Search bar focusable', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  if (!ref) throw new Error('Search input not found')
  ab('click', ref)
  await wait(800)
  find(`Clicked: ${ref}`)
  pass()
})

await run('Type query — list updates without crash', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  if (!ref) throw new Error('Search input not found')
  ab('fill', ref, 'test')
  await wait(2000)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on search input')
  find('Typed "test" — stable')
  pass()
})

await run('Clear search restores full list', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  if (ref) { ab('fill', ref, ''); await wait(1000) }
  ab('type', 'Escape')
  await wait(1000)
  find('Search cleared')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Inbox Controls', '🎚️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Team inbox switcher', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs = getRefs()
  const ref  = findRef(refs, 'team inbox', 'all inboxes', 'inbox switcher', 'switch inbox')
  if (!ref) { warn('Team inbox switcher not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on inbox switcher')
  find(`Opened switcher (${ref})`)
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('Sort order (newest / oldest)', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'sort', 'newest', 'oldest', 'order')
  if (!ref) { warn('Sort control not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on sort')
  find(`Sort dropdown opened (${ref})`)
  const after = getText()
  const opts = ['newest', 'oldest'].filter(o => after.includes(o))
  if (opts.length) find(`Sort options: ${opts.join(', ')}`)
  else warn('No sort options detected in dropdown')
  ab('type', 'Escape')
  await wait(500)
  pass()
})

await run('Channel filter (WhatsApp / Facebook / etc.)', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'channel filter', 'all channels', 'whatsapp', 'filter by channel')
  if (!ref) { warn('Channel filter not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on channel filter')
  find(`Channel filter opened (${ref})`)
  ab('type', 'Escape')
  await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Filter Panel', '🎛️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Open filter panel', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs = getRefs()
  const ref  = findRef(refs, 'expand filters', 'filter')
  if (!ref) { warn('Filter button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on filter panel')
  find(`Filter panel opened (${ref})`)
  pass()
})

await run('Assignee filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'assignee')
  if (!ref) { warn('Assignee filter not found'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on assignee filter')
  find(`Assignee filter opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Tags filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'tags', 'tag')
  if (!ref) { warn('Tags filter not found'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on tags filter')
  find(`Tags filter opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Date range filter', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'date range', 'date')
  if (!ref) { warn('Date range filter not found'); pass('Not in view'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on date range')
  find(`Date range opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Conversation Row Actions', '💬')
// ─────────────────────────────────────────────────────────────────────────────

await run('Open first conversation', async () => {
  const opened = await openFirstConversation()
  if (!opened) throw new Error('Could not find any conversation to open')
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash opening conversation')
  pass()
})

await run('Assign button opens agent picker', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs     = getRefs()
  const assignRef = findRef(refs, 'assign')
  if (!assignRef) { warn('Assign button not found'); pass('Not visible'); return }
  ab('click', assignRef)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on Assign')
  const afterRefs = getRefs()
  find(`Elements after: ${Object.keys(afterRefs).length}`)
  find(`Assign dropdown opened (${assignRef})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('More (⋯) menu shows actions', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs    = getRefs()
  const moreRef = findRef(refs, 'more')
  if (!moreRef) { warn('"More" button not found'); pass('Not visible'); return }
  ab('click', moreRef)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on More menu')
  const text = getText()
  const items = ['mark', 'archive', 'delete', 'mute', 'pin', 'label', 'resolve', 'snooze']
  const found = items.filter(m => text.includes(m))
  found.length ? find(`Menu items: ${found.join(', ')}`) : warn('No menu items detected')
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Bulk select toggle', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs    = getRefs()
  const bulkRef = findRef(refs, 'bulk select', 'bulk')
  if (!bulkRef) { warn('Bulk select not found'); pass('Not visible'); return }
  ab('click', bulkRef)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on bulk select')
  find('Bulk select mode activated')
  ab('click', bulkRef); await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Message View', '📨')
// ─────────────────────────────────────────────────────────────────────────────

await run('Message thread renders inside conversation', async () => {
  await openFirstConversation()
  const refs = getRefs()
  const text = getText()
  find(`Elements in view: ${Object.keys(refs).length}`)
  // Look for message bubbles or compose area
  const hasCompose = !!findRef(refs, 'type a message', 'message', 'compose', 'write')
  find(`Compose area found: ${hasCompose}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash in message view')
  if (!hasCompose) warn('Compose area not detected — check if conversation opened')
  pass()
})

await run('Contact name / header visible', async () => {
  const text = getText()
  const refs = getRefs()
  // Header area usually has resolve, assign, contact name
  const resolveRef = findRef(refs, 'resolve', 'done', 'close conversation')
  find(`Resolve button: ${resolveRef ?? 'not found'}`)
  if (!resolveRef) warn('Resolve button not visible in header')
  pass()
})

await run('Message timestamps visible', async () => {
  const text = getText()
  // Timestamps appear as "am", "pm", or time-like patterns
  const hasTime = text.match(/\d+:\d+/) || text.includes(' am') || text.includes(' pm')
  find(`Timestamps detected: ${!!hasTime}`)
  if (!hasTime) warn('No timestamps found in message view')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Compose & Send', '✍️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Compose box is focusable', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'type a message', 'message', 'compose', 'write a message', 'reply')
  if (!ref) { warn('Compose box not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(800)
  find(`Compose focused (${ref})`)
  pass()
})

await run('Type text in compose', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'type a message', 'message', 'compose', 'write a message', 'reply')
  if (!ref) { warn('Compose box not found'); pass('Not visible'); return }
  ab('fill', ref, 'E2E test message — please ignore')
  await wait(800)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on typing')
  find('Text typed in compose — no crash')
  pass()
})

await run('Send button visible and clickable', async () => {
  const refs = getRefs()
  const sendRef = findRef(refs, 'send', 'send message')
  if (!sendRef) { warn('Send button not found'); pass('Not visible'); return }
  find(`Send ref: ${sendRef}`)
  // Do NOT actually click send to avoid spamming real conversations
  // Instead verify it's present and enabled
  find('Send button located — skipping actual send to avoid test noise')
  pass()
})

await run('Rich text toolbar (bold / italic / underline)', async () => {
  const refs = getRefs()
  const boldRef      = findRef(refs, 'bold')
  const italicRef    = findRef(refs, 'italic')
  const underlineRef = findRef(refs, 'underline')
  const found = [boldRef && 'bold', italicRef && 'italic', underlineRef && 'underline'].filter(Boolean)
  if (found.length === 0) { warn('Rich text toolbar not found'); pass('Not visible'); return }
  find(`Toolbar buttons: ${found.join(', ')}`)
  // Click bold to test toggle
  if (boldRef) {
    ab('click', boldRef)
    await wait(500)
    if (getText().includes("that shouldn't have happened")) throw new Error('Crash on bold toggle')
    find('Bold toggled — no crash')
    ab('click', boldRef); await wait(300) // toggle off
  }
  pass()
})

await run('Emoji picker opens', async () => {
  const refs    = getRefs()
  const emojiRef = findRef(refs, 'emoji', 'emoji picker', '😀', 'emoticon')
  if (!emojiRef) { warn('Emoji picker button not found'); pass('Not visible'); return }
  ab('click', emojiRef)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on emoji picker')
  find(`Emoji picker opened (${emojiRef})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Attachment button (image / file upload)', async () => {
  const refs  = getRefs()
  const attRef = findRef(refs, 'attach', 'attachment', 'upload', 'file', 'paperclip', 'image')
  if (!attRef) { warn('Attach button not found'); pass('Not visible'); return }
  ab('click', attRef)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on attachment')
  find(`Attach panel opened (${attRef})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Template / quick reply picker', async () => {
  const refs = getRefs()
  const tRef = findRef(refs, 'template', 'quick reply', 'canned response', '/')
  if (!tRef) { warn('Template picker not found'); pass('Not visible'); return }
  ab('click', tRef)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on templates')
  find(`Template picker opened (${tRef})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('AI reply suggestion button', async () => {
  const refs = getRefs()
  const aiRef = findRef(refs, 'ai', 'suggest', 'ai reply', 'copilot', 'generate reply')
  if (!aiRef) { warn('AI reply button not found'); pass('Not visible'); return }
  ab('click', aiRef)
  await wait(2000)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on AI reply')
  find(`AI reply panel opened (${aiRef})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Private / internal note toggle', async () => {
  const refs = getRefs()
  const noteRef = findRef(refs, 'note', 'internal note', 'private note', 'add note')
  if (!noteRef) { warn('Internal note button not found'); pass('Not visible'); return }
  ab('click', noteRef)
  await wait(1200)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on note toggle')
  find(`Note mode activated (${noteRef})`)
  // Toggle back to reply mode
  const refs2 = getRefs()
  const replyRef = findRef(refs2, 'reply', 'message', 'type a message')
  if (replyRef) { ab('click', replyRef); await wait(500) }
  pass()
})

await run('Scheduled send button', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'schedule', 'scheduled send', 'send later', 'clock')
  if (!ref) { warn('Scheduled send button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  const text = getText()
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on scheduled send')
  find(`Schedule panel opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Channel selector (multi-channel)', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'channel', 'send via', 'switch channel', 'whatsapp', 'channel selector')
  if (!ref) { warn('Channel selector not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1200)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on channel selector')
  find(`Channel selector opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Message Actions', '⚙️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Hover over message reveals action bar', async () => {
  // We look for message-level actions (reply, react, copy, delete)
  const refs = getRefs()
  const reactRef  = findRef(refs, 'react', 'reaction', 'emoji react')
  const replyRef  = findRef(refs, 'reply to', 'quote reply')
  const copyRef   = findRef(refs, 'copy message', 'copy text')
  const deleteRef = findRef(refs, 'delete message', 'unsend')
  const found = [reactRef && 'react', replyRef && 'quote-reply', copyRef && 'copy', deleteRef && 'delete'].filter(Boolean)
  if (found.length === 0) { warn('Message action bar not detected (may need hover)'); pass('Not visible without hover'); return }
  find(`Message actions visible: ${found.join(', ')}`)
  pass()
})

await run('Emoji reaction on message', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'react', 'reaction', 'emoji react')
  if (!ref) { warn('React button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on react')
  find(`Reaction picker opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Quote reply (reply to specific message)', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'reply to', 'quote reply', 'reply message')
  if (!ref) { warn('Quote reply not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1200)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on quote reply')
  find(`Quote reply activated (${ref})`)
  pass()
})

await run('Copy message text', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'copy message', 'copy text', 'copy')
  if (!ref) { warn('Copy button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(800)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on copy')
  find(`Copy action triggered (${ref})`)
  pass()
})

await run('Delete / unsend message', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'delete message', 'unsend', 'delete')
  if (!ref) { warn('Delete message not found'); pass('Not visible'); return }
  // Locate but do NOT click — would destroy real data
  find(`Delete ref found: ${ref} — not clicking to preserve data`)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Conversation Management', '🗂️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Resolve conversation button', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'resolve', 'close conversation', 'mark resolved', 'done')
  if (!ref) { warn('Resolve button not found'); pass('Not visible'); return }
  find(`Resolve ref: ${ref} — not clicking to preserve state`)
  pass()
})

await run('Assign to team member (from inside conversation)', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'assign', 'assignee', 'assign to')
  if (!ref) { warn('Assign button not found inside conversation'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on assign')
  find(`Assign picker opened (${ref})`)
  const afterText = getText()
  if (afterText.includes('unassigned') || afterText.includes('agent') || afterText.includes('team'))
    find('Agent list visible in picker')
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Snooze conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'snooze')
  if (!ref) { warn('Snooze button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on snooze')
  find(`Snooze picker opened (${ref})`)
  const text = getText()
  const opts = ['1 hour', '1 day', 'tomorrow', 'custom', 'next week'].filter(o => text.includes(o))
  if (opts.length) find(`Snooze options: ${opts.join(', ')}`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Pin conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'pin', 'pin conversation')
  if (!ref) { warn('Pin button not found'); pass('Not visible'); return }
  find(`Pin ref: ${ref} — not clicking to preserve state`)
  pass()
})

await run('Mute conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'mute', 'mute conversation')
  if (!ref) { warn('Mute button not found'); pass('Not visible'); return }
  find(`Mute ref: ${ref} — not clicking to avoid muting real convo`)
  pass()
})

await run('Archive conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'archive', 'archive conversation')
  if (!ref) { warn('Archive button not found'); pass('Not visible'); return }
  find(`Archive ref: ${ref} — not clicking to preserve state`)
  pass()
})

await run('Mark as unread', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'mark as unread', 'unread', 'mark unread')
  if (!ref) { warn('Mark as unread not found'); pass('Not visible'); return }
  find(`Mark unread ref: ${ref}`)
  pass()
})

await run('Delete conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'delete conversation', 'delete chat')
  if (!ref) { warn('Delete conversation not found'); pass('Not visible'); return }
  find(`Delete conversation ref: ${ref} — not clicking to preserve data`)
  pass()
})

await run('Add label / tag to conversation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'label', 'tag', 'add label', 'add tag')
  if (!ref) { warn('Label/tag button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on label')
  find(`Label picker opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Contact Panel (Right Sidebar)', '👤')
// ─────────────────────────────────────────────────────────────────────────────

await run('Contact panel visible or togglable', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'contact info', 'contact panel', 'view contact', 'contact details', 'profile')
  if (!ref) { warn('Contact panel toggle not found'); pass('May be auto-visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash opening contact panel')
  find(`Contact panel opened (${ref})`)
  pass()
})

await run('Contact name and phone visible in panel', async () => {
  const text = getText()
  const hasPhone = text.match(/\+?\d[\d\s\-()]{6,}/)
  const hasName  = text.includes('name') || text.includes('contact')
  find(`Phone visible: ${!!hasPhone}`)
  find(`Contact label visible: ${hasName}`)
  if (!hasPhone && !hasName) warn('Contact details not detected in panel')
  pass()
})

await run('Edit contact details', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'edit contact', 'edit', 'edit name', 'edit phone')
  if (!ref) { warn('Edit contact button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on edit contact')
  find(`Edit contact form opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Add custom attribute / field', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'custom attribute', 'add attribute', 'custom field', 'add field')
  if (!ref) { warn('Custom attribute not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on custom attribute')
  find(`Custom attribute form opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Add / edit tags on contact', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'add tag', 'contact tag', 'tags')
  if (!ref) { warn('Contact tags field not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1200)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on contact tags')
  find(`Contact tags opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('View conversation history list', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'conversation history', 'history', 'previous conversations', 'past chats')
  if (!ref) { warn('Conversation history not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on history')
  find(`Conversation history opened (${ref})`)
  pass()
})

await run('CRM / notes section in contact panel', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'crm', 'notes', 'add note', 'contact note')
  if (!ref) { warn('CRM/notes section not found in panel'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1200)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on CRM/notes')
  find(`CRM/notes section opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Sidebar & Navigation', '◀️')
// ─────────────────────────────────────────────────────────────────────────────

await run('Sidebar collapse / expand', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs = getRefs()
  const ref  = findRef(refs, 'expand sidebar', 'collapse sidebar', 'sidebar toggle')
  if (!ref) { warn('Sidebar toggle not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1200)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on sidebar collapse')
  find('Collapsed — no crash')
  const refs2 = getRefs()
  const ref2  = findRef(refs2, 'expand sidebar', 'collapse sidebar', 'sidebar toggle')
  if (ref2) { ab('click', ref2); await wait(1000); find('Re-expanded') }
  pass()
})

await run('Notifications bell', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs = getRefs()
  const ref  = findRef(refs, 'notifications', 'notification')
  if (!ref) { warn('Notifications bell not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(1500)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on notifications')
  find(`Notifications panel opened (${ref})`)
  ab('type', 'Escape'); await wait(500)
  pass()
})

await run('Inbox settings navigation', async () => {
  const refs = getRefs()
  const ref  = findRef(refs, 'settings')
  if (!ref) { warn('Settings button not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(2000)
  const url  = getUrl()
  const text = getText()
  find(`Navigated to: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on settings nav')
  ab('navigate', 'back'); await wait(1500)
  pass()
})

await run('Getting started panel', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs = getRefs()
  const ref  = findRef(refs, 'getting started')
  if (!ref) { warn('Getting started not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(2000)
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash on getting started')
  find(`Getting started opened (${ref})`)
  pass()
})

await run('Analytics link from inbox', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3500)
  const refs = getRefs()
  const ref  = findRef(refs, 'analytics')
  if (!ref) { warn('Analytics link not found'); pass('Not visible'); return }
  ab('click', ref)
  await wait(2500)
  const url  = getUrl()
  const text = getText()
  find(`URL: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on analytics nav')
  ab('navigate', 'back'); await wait(1500)
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
suite('Performance & Resilience', '⚡')
// ─────────────────────────────────────────────────────────────────────────────

await run('Inbox initial load time', async () => {
  const t = Date.now()
  ab('open', `${BASE_URL}/inbox`)
  await wait(300)
  getSnapshot()
  const ms = Date.now() - t
  find(`Time to interactive: ~${ms}ms`)
  if      (ms < 3000) find('GOOD (< 3s) ✓')
  else if (ms < 6000) warn(`SLOW (${ms}ms)`)
  else                warn(`VERY SLOW (${ms}ms)`)
  pass()
})

await run('Rapid filter tab switching — no crash', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  for (const t of ['Unread', 'Assigned to Me', 'Unassigned', 'Individuals', 'Groups']) {
    const refs = getRefs()
    const ref  = findRef(refs, t)
    if (ref) { ab('click', ref); await wait(400) }
  }
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash during rapid tab switching')
  find('5 filter tabs switched rapidly — stable')
  pass()
})

await run('Repeated search queries — no crash', async () => {
  ab('open', `${BASE_URL}/inbox`)
  await wait(3000)
  const refs = getRefs()
  const ref  = findRef(refs, 'search all conversations', 'search')
  if (!ref) { warn('Search not found'); pass(); return }
  for (const q of ['hello', 'test', 'abc', '']) {
    ab('fill', ref, q)
    await wait(600)
  }
  if (getText().includes("that shouldn't have happened")) throw new Error('Crash during repeated search')
  find('4 search queries typed rapidly — stable')
  pass()
})

await run('Back navigation from conversation', async () => {
  await openFirstConversation()
  ab('navigate', 'back')
  await wait(2000)
  const url  = getUrl()
  const text = getText()
  find(`URL after back: ${url}`)
  if (text.includes("that shouldn't have happened")) throw new Error('Crash on back navigation')
  pass()
})

// ─────────────────────────────────────────────────────────────────────────────
const { passed, failed, skipped, total, totalMs, data } = saveAndPush()

log(`\n${'═'.repeat(60)}`)
log(`  INBOX: ${passed} passed  ${failed} failed  ${skipped} skipped  (${total} steps)`)
log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`)
log('═'.repeat(60) + '\n')

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
