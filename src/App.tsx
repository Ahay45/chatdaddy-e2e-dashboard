import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Box, Typography, Chip, LinearProgress, IconButton,
  Tooltip, alpha, ThemeProvider, createTheme, CssBaseline, Collapse, Button,
} from '@mui/material'
import {
  CheckCircle2, XCircle, SkipForward, RefreshCw, Clock,
  Globe, FlaskConical, Terminal, AlertTriangle, ChevronDown,
  ChevronUp, Camera, TrendingUp, Activity, Zap, Info, Play, Loader,
} from 'lucide-react'

const API = 'http://localhost:3101'

// ─── Theme ────────────────────────────────────────────────────────────────────

// inject spin keyframes once
const style = document.createElement('style')
style.textContent = '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'
document.head.appendChild(style)

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0A0A0F', paper: '#13131A' },
    primary: { main: '#0F5BFF' },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif' },
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  name: string
  status: 'pass' | 'fail' | 'skip'
  duration: number
  findings: string[]
  errors: string[]
  screenshot: string | null
}

interface Suite {
  name: string
  icon: string
  durationMs: number
  summary: { passed: number; failed: number; skipped: number; total: number }
  steps: Step[]
}

interface Results {
  url: string
  runAt: string | null
  mode: string
  durationMs: number
  summary: { passed: number; failed: number; skipped: number; total: number }
  suites: Suite[]
}

// ─── Status config ─────────────────────────────────────────────────────────

const S = {
  pass: { color: '#10B981', bg: alpha('#10B981', 0.1), label: 'Pass', icon: <CheckCircle2 size={14} /> },
  fail: { color: '#EF4444', bg: alpha('#EF4444', 0.1), label: 'Fail', icon: <XCircle size={14} /> },
  skip: { color: '#F59E0B', bg: alpha('#F59E0B', 0.1), label: 'Skip', icon: <SkipForward size={14} /> },
} as const

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: React.ReactNode }) {
  return (
    <Box sx={{
      flex: '1 1 100px', p: 2, borderRadius: '14px',
      bgcolor: 'background.paper', border: '1px solid', borderColor: alpha(color, 0.2),
    }}>
      <Box sx={{ color, display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</Typography>
    </Box>
  )
}

// ─── Step Row ────────────────────────────────────────────────────────────────

function StepRow({ step, idx }: { step: Step; idx: number }) {
  const [open, setOpen] = useState(step.status !== 'pass')
  const s = S[step.status]
  const hasDetails = step.findings.length > 0 || step.errors.length > 0 || step.screenshot
  // first non-warning finding shown inline as subtitle
  const subtitle = step.findings.find(f => !f.startsWith('⚠')) ?? step.findings[0]

  return (
    <Box sx={{
      borderBottom: '1px solid', borderColor: alpha('#fff', 0.04),
      '&:last-child': { borderBottom: 'none' },
    }}>
      {/* Row header */}
      <Box
        onClick={() => hasDetails && setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1.5,
          px: 2.5, py: 1.25,
          cursor: hasDetails ? 'pointer' : 'default',
          transition: 'background 0.1s',
          '&:hover': hasDetails ? { bgcolor: alpha('#fff', 0.015) } : {},
        }}
      >
        <Typography sx={{ fontSize: '0.5625rem', fontFamily: 'monospace', color: alpha('#fff', 0.2), minWidth: 18, flexShrink: 0, pt: 0.15 }}>
          {String(idx + 1).padStart(2, '0')}
        </Typography>
        <Box sx={{ color: s.color, flexShrink: 0, pt: 0.1 }}>{s.icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.4 }}>
            {step.name}
          </Typography>
          {/* inline subtitle — first finding shown always */}
          {subtitle && !open && (
            <Typography sx={{ fontSize: '0.6875rem', color: alpha('#fff', 0.28), lineHeight: 1.4, mt: 0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle.replace(/^⚠\s?/, '')}
            </Typography>
          )}
          {/* warnings shown inline even when closed */}
          {!open && step.findings.filter(f => f.startsWith('⚠')).map((f, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <AlertTriangle size={10} color="#F59E0B" />
              <Typography sx={{ fontSize: '0.6875rem', color: '#F59E0B', lineHeight: 1.4 }}>
                {f.replace(/^⚠\s?/, '')}
              </Typography>
            </Box>
          ))}
        </Box>
        {step.screenshot && (
          <Tooltip title="Screenshot captured">
            <Box sx={{ color: alpha('#fff', 0.25) }}><Camera size={12} /></Box>
          </Tooltip>
        )}
        <Typography sx={{ fontSize: '0.5625rem', color: alpha('#fff', 0.2), fontFamily: 'monospace', flexShrink: 0 }}>
          {step.duration > 0 ? `${step.duration}ms` : '—'}
        </Typography>
        <Chip label={s.label} size="small"
          sx={{ height: 18, fontSize: '0.5rem', fontWeight: 800, bgcolor: s.bg, color: s.color, borderRadius: '5px', flexShrink: 0 }} />
        {hasDetails && (
          <Box sx={{ color: alpha('#fff', 0.2), flexShrink: 0 }}>
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </Box>
        )}
      </Box>

      {/* Expanded details */}
      <Collapse in={open}>
        <Box sx={{ px: 3, pb: 1.5, borderTop: `1px solid ${alpha('#fff', 0.04)}` }}>
          {/* Findings */}
          {step.findings.length > 0 && (
            <Box sx={{ mt: 1.25 }}>
              <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: alpha('#fff', 0.3), mb: 0.75 }}>
                Findings
              </Typography>
              {step.findings.map((f, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 0.4 }}>
                  <Box sx={{ mt: 0.15, flexShrink: 0 }}>
                    {f.startsWith('⚠') ? <AlertTriangle size={11} color="#F59E0B" /> : <Info size={11} color={alpha('#fff', 0.3)} />}
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: f.startsWith('⚠') ? '#F59E0B' : alpha('#fff', 0.55), lineHeight: 1.5 }}>
                    {f.replace(/^⚠\s?/, '')}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* Errors */}
          {step.errors.length > 0 && (
            <Box sx={{ mt: 1.25, p: 1.25, borderRadius: '8px', bgcolor: alpha('#EF4444', 0.06), border: `1px solid ${alpha('#EF4444', 0.15)}` }}>
              <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#EF4444', mb: 0.75 }}>
                Errors
              </Typography>
              {step.errors.map((e, i) => (
                <Typography key={i} sx={{ fontSize: '0.75rem', color: '#EF4444', fontFamily: 'monospace', lineHeight: 1.5 }}>
                  {e}
                </Typography>
              ))}
            </Box>
          )}

          {/* Screenshot */}
          {step.screenshot && (
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: alpha('#fff', 0.3), mb: 0.75 }}>
                Screenshot
              </Typography>
              <Box
                component="a"
                href={step.screenshot}
                target="_blank"
                sx={{ display: 'inline-block', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${alpha('#fff', 0.08)}`, maxWidth: 480, width: '100%' }}
              >
                <Box
                  component="img"
                  src={step.screenshot}
                  alt={step.name}
                  sx={{ width: '100%', display: 'block' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                />
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Suite Card ──────────────────────────────────────────────────────────────

function SuiteCard({ suite }: { suite: Suite }) {
  const [open, setOpen] = useState(true)
  const s = suite.summary
  const pct = s.total ? Math.round((s.passed / s.total) * 100) : 0
  const color = s.failed > 0 ? '#EF4444' : s.skipped === s.total ? '#F59E0B' : '#10B981'

  return (
    <Box sx={{ borderRadius: '16px', border: '1px solid', borderColor: alpha(color, 0.2), bgcolor: 'background.paper', overflow: 'hidden', mb: 2 }}>
      {/* Suite header */}
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          px: 2.5, py: 1.75, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5,
          borderBottom: open ? `1px solid ${alpha('#fff', 0.05)}` : 'none',
          '&:hover': { bgcolor: alpha('#fff', 0.015) },
        }}
      >
        <Typography sx={{ fontSize: '1.125rem', flexShrink: 0 }}>{suite.icon}</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9375rem' }}>{suite.name}</Typography>
            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: alpha('#fff', 0.25), bgcolor: alpha('#fff', 0.06), px: 0.75, py: 0.2, borderRadius: '5px', flexShrink: 0 }}>
              {s.total} step{s.total !== 1 ? 's' : ''}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinearProgress variant="determinate" value={pct}
              sx={{ flex: 1, height: 5, borderRadius: 3, bgcolor: alpha('#fff', 0.06),
                '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 } }} />
            <Typography sx={{ fontSize: '0.625rem', fontWeight: 800, color, minWidth: 30, textAlign: 'right' }}>{pct}%</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
          <Chip label={`✓ ${s.passed}`} size="small"
            sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#10B981', 0.1), color: '#10B981', borderRadius: '5px' }} />
          {s.failed > 0 && <Chip label={`✗ ${s.failed}`} size="small"
            sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#EF4444', 0.1), color: '#EF4444', borderRadius: '5px' }} />}
          {s.skipped > 0 && <Chip label={`~ ${s.skipped}`} size="small"
            sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#F59E0B', 0.1), color: '#F59E0B', borderRadius: '5px' }} />}
          <Chip label={`${(suite.durationMs / 1000).toFixed(1)}s`} size="small"
            sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#6B7280', 0.1), color: '#9CA3AF', borderRadius: '5px' }} />
        </Box>
        <Box sx={{ color: alpha('#fff', 0.2), flexShrink: 0 }}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Box>
      </Box>

      {/* Steps list */}
      <Collapse in={open}>
        {suite.steps.map((step, i) => <StepRow key={i} step={step} idx={i} />)}
      </Collapse>
    </Box>
  )
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Box sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Box sx={{ color: alpha('#fff', 0.1) }}><FlaskConical size={52} /></Box>
      <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: alpha('#fff', 0.35) }}>No test results yet</Typography>
      <Typography sx={{ fontSize: '0.8125rem', color: alpha('#fff', 0.2), textAlign: 'center', maxWidth: 340, lineHeight: 1.7 }}>
        Run the E2E agent to start testing theo.chatdaddy.tech
      </Typography>
      <Box sx={{ mt: 1, p: 1.75, borderRadius: '10px', bgcolor: alpha('#fff', 0.03), border: `1px solid ${alpha('#fff', 0.07)}`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Terminal size={13} color={alpha('#fff', 0.3)} />
        <Typography sx={{ fontSize: '0.75rem', fontFamily: 'monospace', color: alpha('#fff', 0.45) }}>
          npm run e2e
        </Typography>
      </Box>
    </Box>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState<Results | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail' | 'skip'>('all')
  const [testRunning, setTestRunning] = useState(false)
  const [serverOnline, setServerOnline] = useState(false)
  const [liveProgress, setLiveProgress] = useState<{
    currentSuite: string | null
    currentStep: string | null
    lastResult: string | null
    log: string[]
    steps: { suite: string; step: string; status: string }[]
    summary: { passed: number; failed: number; skipped: number; total: number }
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(import.meta.env.BASE_URL + 'e2e-results.json?t=' + Date.now())
      setData(await r.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
      setLastRefresh(Date.now())
    }
  }, [])

  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/status`, { signal: AbortSignal.timeout(1500) })
      const json = await r.json()
      setServerOnline(true)
      const wasRunning = testRunning
      setTestRunning(json.running)
      if (wasRunning && !json.running) { setLiveProgress(null); load() }
    } catch {
      setServerOnline(false)
      setTestRunning(false)
    }
  }, [testRunning, load])

  const pollProgress = useCallback(async () => {
    if (!testRunning) return
    try {
      const r = await fetch(`${API}/api/progress`, { signal: AbortSignal.timeout(1500) })
      setLiveProgress(await r.json())
    } catch { /* ignore */ }
  }, [testRunning])

  const triggerRun = async (suite: 'all' | 'inbox' | 'flows') => {
    if (testRunning) return
    try {
      const url = suite === 'inbox' ? `${API}/api/run/inbox` : suite === 'flows' ? `${API}/api/run/flows` : `${API}/api/run`
      await fetch(url, { method: 'POST' })
      setTestRunning(true)
    } catch {
      alert('Could not reach local test server. Make sure you ran: npm run dev:full')
    }
  }

  useEffect(() => { load() }, [load])

  useEffect(() => {
    pollStatus()
    const id = setInterval(pollStatus, 3000)
    return () => clearInterval(id)
  }, [pollStatus])

  useEffect(() => {
    if (!testRunning) return
    pollProgress()
    const id = setInterval(pollProgress, 2000)
    return () => clearInterval(id)
  }, [testRunning, pollProgress])

  const s = data?.summary ?? { passed: 0, failed: 0, skipped: 0, total: 0 }
  const hasRun = !!data?.runAt && s.total > 0
  const passPct = s.total ? Math.round((s.passed / s.total) * 100) : 0
  const barColor = s.failed > 0 ? '#EF4444' : s.total === 0 ? '#374151' : '#10B981'

  const filteredSuites = useMemo(() => {
    if (!data) return []
    if (filter === 'all') return data.suites
    return data.suites
      .map(suite => ({ ...suite, steps: suite.steps.filter(st => st.status === filter) }))
      .filter(suite => suite.steps.length > 0)
  }, [data, filter])

  const filterCounts = useMemo(() => ({
    all:  data?.suites.flatMap(s => s.steps).length ?? 0,
    pass: data?.suites.flatMap(s => s.steps).filter(st => st.status === 'pass').length ?? 0,
    fail: data?.suites.flatMap(s => s.steps).filter(st => st.status === 'fail').length ?? 0,
    skip: data?.suites.flatMap(s => s.steps).filter(st => st.status === 'skip').length ?? 0,
  }), [data])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', px: { xs: 2, md: 5 }, py: 5, maxWidth: 900, mx: 'auto' }}>

        {/* ── Header ── */}
        <Box sx={{ mb: 3.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ p: 0.875, borderRadius: '12px', bgcolor: alpha('#0F5BFF', 0.12), color: '#0F5BFF', display: 'flex', flexShrink: 0 }}>
            <FlaskConical size={22} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              E2E Test Results
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.3 }}>
              <Globe size={11} color={alpha('#fff', 0.3)} />
              <Typography sx={{ fontSize: '0.75rem', color: alpha('#fff', 0.3) }}>
                {data?.url ?? 'https://theo.chatdaddy.tech'}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Run buttons — only shown when local server is reachable */}
            {serverOnline && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  disabled={testRunning}
                  onClick={() => triggerRun('all')}
                  startIcon={testRunning ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />}
                  sx={{
                    fontSize: '0.6875rem', fontWeight: 700, textTransform: 'none',
                    bgcolor: testRunning ? alpha('#0F5BFF', 0.4) : '#0F5BFF',
                    '&:hover': { bgcolor: '#1a68ff' },
                    '&:disabled': { bgcolor: alpha('#0F5BFF', 0.35), color: alpha('#fff', 0.5) },
                    borderRadius: '8px', py: 0.5, px: 1.5, minWidth: 0,
                  }}
                >
                  {testRunning ? 'Running…' : 'Run All Tests'}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={testRunning}
                  onClick={() => triggerRun('inbox')}
                  startIcon={<Play size={13} />}
                  sx={{
                    fontSize: '0.6875rem', fontWeight: 700, textTransform: 'none',
                    borderColor: alpha('#10B981', 0.5), color: '#10B981',
                    '&:hover': { borderColor: '#10B981', bgcolor: alpha('#10B981', 0.08) },
                    '&:disabled': { borderColor: alpha('#10B981', 0.2), color: alpha('#10B981', 0.3) },
                    borderRadius: '8px', py: 0.5, px: 1.5, minWidth: 0,
                  }}
                >
                  Inbox Tests
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={testRunning}
                  onClick={() => triggerRun('flows')}
                  startIcon={<Play size={13} />}
                  sx={{
                    fontSize: '0.6875rem', fontWeight: 700, textTransform: 'none',
                    borderColor: alpha('#A855F7', 0.5), color: '#A855F7',
                    '&:hover': { borderColor: '#A855F7', bgcolor: alpha('#A855F7', 0.08) },
                    '&:disabled': { borderColor: alpha('#A855F7', 0.2), color: alpha('#A855F7', 0.3) },
                    borderRadius: '8px', py: 0.5, px: 1.5, minWidth: 0,
                  }}
                >
                  User Flows
                </Button>
              </>
            )}
            {data?.mode && (
              <Chip label={data.mode} size="small"
                sx={{ height: 20, fontSize: '0.5625rem', fontWeight: 700, bgcolor: alpha('#6B7280', 0.12), color: '#9CA3AF', borderRadius: '6px' }} />
            )}
            {hasRun && data?.durationMs && (
              <Chip
                label={`${(data.durationMs / 1000).toFixed(1)}s total`}
                size="small"
                icon={<Zap size={10} color="#F59E0B" style={{ marginLeft: 6 }} />}
                sx={{ height: 20, fontSize: '0.5625rem', fontWeight: 700, bgcolor: alpha('#F59E0B', 0.1), color: '#F59E0B', borderRadius: '6px' }}
              />
            )}
            <Tooltip title="Refresh results">
              <IconButton onClick={load} size="small"
                sx={{ color: 'text.secondary', border: '1px solid', borderColor: alpha('#fff', 0.08), borderRadius: '8px', p: 0.75 }}>
                <RefreshCw size={14} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* ── Live progress panel ── */}
        {testRunning && liveProgress && (
          <Box sx={{ mb: 3, borderRadius: '16px', border: `1px solid ${alpha('#0F5BFF', 0.3)}`, bgcolor: alpha('#0F5BFF', 0.04), overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${alpha('#0F5BFF', 0.15)}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Loader size={14} color="#0F5BFF" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F5BFF' }}>
                  {liveProgress.currentSuite ?? 'Starting…'}
                </Typography>
                {liveProgress.currentStep && (
                  <Typography sx={{ fontSize: '0.6875rem', color: alpha('#fff', 0.45), mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ▸ {liveProgress.currentStep}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                <Chip label={`✓ ${liveProgress.summary.passed}`} size="small" sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#10B981', 0.1), color: '#10B981', borderRadius: '5px' }} />
                {liveProgress.summary.failed > 0 && <Chip label={`✗ ${liveProgress.summary.failed}`} size="small" sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#EF4444', 0.1), color: '#EF4444', borderRadius: '5px' }} />}
                {liveProgress.summary.skipped > 0 && <Chip label={`~ ${liveProgress.summary.skipped}`} size="small" sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#F59E0B', 0.1), color: '#F59E0B', borderRadius: '5px' }} />}
                <Chip label={`${liveProgress.summary.total} steps`} size="small" sx={{ height: 18, fontSize: '0.5rem', fontWeight: 700, bgcolor: alpha('#6B7280', 0.1), color: '#9CA3AF', borderRadius: '5px' }} />
              </Box>
            </Box>

            {/* Completed steps list */}
            {liveProgress.steps.length > 0 && (
              <Box sx={{ maxHeight: 220, overflowY: 'auto', px: 2.5, py: 1 }}>
                {[...liveProgress.steps].reverse().map((s, i) => {
                  const color = s.status === 'pass' ? '#10B981' : s.status === 'fail' ? '#EF4444' : '#F59E0B'
                  const icon  = s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '~'
                  return (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4, borderBottom: `1px solid ${alpha('#fff', 0.03)}`, '&:last-child': { borderBottom: 'none' } }}>
                      <Typography sx={{ fontSize: '0.625rem', fontWeight: 800, color, flexShrink: 0, width: 12 }}>{icon}</Typography>
                      <Typography sx={{ fontSize: '0.6875rem', color: alpha('#fff', 0.35), flexShrink: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                        {s.suite}
                      </Typography>
                      <Typography sx={{ fontSize: '0.6875rem', color: i === 0 ? alpha('#fff', 0.75) : alpha('#fff', 0.45), flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.step}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            )}

            {/* Progress bar */}
            <Box sx={{ px: 2.5, pt: 0.5, pb: 1.5 }}>
              <LinearProgress variant="indeterminate"
                sx={{ height: 3, borderRadius: 2, bgcolor: alpha('#0F5BFF', 0.1),
                  '& .MuiLinearProgress-bar': { bgcolor: '#0F5BFF' } }} />
            </Box>
          </Box>
        )}

        {/* simple spinner when running but no progress data yet */}
        {testRunning && !liveProgress && (
          <Box sx={{ mb: 3, p: 2, borderRadius: '16px', border: `1px solid ${alpha('#0F5BFF', 0.2)}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Loader size={14} color="#0F5BFF" style={{ animation: 'spin 1s linear infinite' }} />
            <Typography sx={{ fontSize: '0.8125rem', color: alpha('#fff', 0.5) }}>Starting test run…</Typography>
          </Box>
        )}

        {/* ── Stat cards ── */}
        {hasRun && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
            <StatCard label="Passed"   value={s.passed}  color="#10B981" icon={<CheckCircle2 size={12} />} />
            <StatCard label="Failed"   value={s.failed}  color="#EF4444" icon={<XCircle size={12} />} />
            <StatCard label="Skipped"  value={s.skipped} color="#F59E0B" icon={<SkipForward size={12} />} />
            <StatCard label="Total"    value={s.total}   color="#6366F1" icon={<Activity size={12} />} />
            <StatCard label="Suites"   value={data?.suites.length ?? 0} color="#0EA5E9" icon={<TrendingUp size={12} />} />
          </Box>
        )}

        {/* ── Progress bar ── */}
        {hasRun && (
          <Box sx={{ p: 2.5, borderRadius: '16px', bgcolor: 'background.paper', border: '1px solid', borderColor: alpha('#fff', 0.06), mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: alpha('#fff', 0.6) }}>Overall Pass Rate</Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: barColor, lineHeight: 1 }}>{passPct}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={passPct}
              sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#fff', 0.06),
                '& .MuiLinearProgress-bar': { bgcolor: barColor, borderRadius: 5 } }} />
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.25, gap: 1 }}>
              <Clock size={11} color={alpha('#fff', 0.25)} />
              <Typography sx={{ fontSize: '0.6875rem', color: alpha('#fff', 0.25) }}>
                {data?.runAt ? new Date(data.runAt).toLocaleString() : '—'}
              </Typography>
              {s.failed > 0 && (
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AlertTriangle size={12} color="#EF4444" />
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#EF4444' }}>
                    {s.failed} step{s.failed > 1 ? 's' : ''} failed
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* ── Filters ── */}
        {hasRun && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
            {(['all', 'pass', 'fail', 'skip'] as const).map(f => {
              const color = f === 'all' ? '#0F5BFF' : f === 'pass' ? '#10B981' : f === 'fail' ? '#EF4444' : '#F59E0B'
              const active = filter === f
              return (
                <Box key={f} onClick={() => setFilter(f)} sx={{
                  px: 1.75, py: 0.625, borderRadius: '9px', cursor: 'pointer',
                  border: '1px solid', borderColor: active ? color : alpha('#fff', 0.08),
                  bgcolor: active ? alpha(color, 0.1) : 'transparent',
                  transition: 'all 0.15s', userSelect: 'none',
                  '&:hover': { borderColor: active ? color : alpha('#fff', 0.18) },
                }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'capitalize', color: active ? color : alpha('#fff', 0.4) }}>
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}{' '}
                    <span style={{ opacity: 0.65 }}>({filterCounts[f]})</span>
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}

        {/* ── Main content ── */}
        {loading ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography sx={{ color: alpha('#fff', 0.3) }}>Loading…</Typography>
          </Box>
        ) : !hasRun ? (
          <EmptyState />
        ) : filteredSuites.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ color: alpha('#fff', 0.3), fontSize: '0.875rem' }}>No steps match this filter.</Typography>
          </Box>
        ) : (
          filteredSuites.map((suite, i) => <SuiteCard key={i} suite={suite} />)
        )}

        {/* ── Footer ── */}
        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${alpha('#fff', 0.05)}`, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Terminal size={12} color={alpha('#fff', 0.2)} />
          <Typography sx={{ fontSize: '0.6875rem', color: alpha('#fff', 0.2), fontFamily: 'monospace' }}>
            Auto-runs every hour · Pushes live to GitHub Pages
          </Typography>
          <Typography sx={{ ml: 'auto', fontSize: '0.5625rem', color: alpha('#fff', 0.15) }}>
            refreshed {new Date(lastRefresh).toLocaleTimeString()}
          </Typography>
        </Box>

      </Box>
    </ThemeProvider>
  )
}
