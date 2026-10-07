import React, { useState, useEffect, useRef } from 'react'
import { Clock, Plus, AlertTriangle, Upload, FileText, BarChart3, TrendingUp, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import CategoryBarChart from '../common/charts/CategoryBarChart'
import ZoomableCarbonChart from '../charts/ZoomableCarbonChart'
import ProjectSwitcher from './ProjectSwitcher'
import ChatBar from './ChatBar'

/**
 * UX refinement (Phase D): "merge tracking & chat with phase 5, so this
 * can be the place where I can upload the bills regularly and see
 * everything about a project." TrackingChatHub replaces both the old
 * Phase3View (dashboard + baseline + chat) and Phase5View (COP-PDF bill
 * reconciliation) with one screen. Nothing about the underlying data
 * model changes -- every call here hits the exact same
 * /phase3/projects/{id}/* endpoints those two screens already used.
 *
 * What actually changed:
 *  - One project switcher up top (searchable by name, Phase A), instead
 *    of picking a project from the sidebar and hoping it's the same one
 *    Phase 3 and Phase 5 are both looking at.
 *  - One "Add Bill" action and one modal that takes either an .xlsx BOQ-
 *    shaped bill or a .pdf Certificate of Payment -- the backend already
 *    auto-detects which; there is no longer a reason to make the user
 *    pick the right screen first.
 *  - The bills table is unified with a source badge per row (Excel BOQ
 *    vs COP PDF), matching what Phase 5 already showed.
 *  - The old fixed-viewport line chart is replaced with
 *    ZoomableCarbonChart (Recharts + a Brush control), so bills can be
 *    read like a stock chart -- zoom into any date range, zoom back out.
 *  - The chat panel moves from a side column into a sticky bar pinned to
 *    the bottom of the page, per the "keep the chat bar at the bottom"
 *    request.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

// Bug fix support: best-effort free-text -> ISO-date guesser for the
// "Period Label" field (e.g. "sept", "Sept 2026", "2026-09", "Q3 2026",
// "2026-09-30"), used to auto-fill "Billed Date" so the two fields stay
// in sync instead of the date silently defaulting to -- and staying at
// -- today for every bill. Returns the LAST day of the matched month
// (a billed_date is an "as of" date, and a billing period is usually
// reported as of its own month-end), or null if nothing recognizable is
// found, in which case the date field is left exactly as the user set
// it. Deliberately conservative: this only ever helps a field that
// hasn't been touched yet (see billDateTouched) -- it never overrides an
// explicit date the user picked.
function guessDateFromPeriod(text) {
  if (!text) return null
  const t = text.trim().toLowerCase()

  // Already a real date, e.g. "2026-09-30" or "2026-09"
  const isoMatch = t.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    if (month >= 1 && month <= 12) {
      const day = isoMatch[3] ? Number(isoMatch[3]) : new Date(year, month, 0).getDate()
      return `${isoMatch[1]}-${isoMatch[2]}-${String(day).padStart(2, '0')}`
    }
  }

  // A quarter label, e.g. "2026-Q3" or "Q3 2026"
  const quarterMatch = t.match(/q([1-4])[^0-9]*(\d{4})/) || t.match(/(\d{4})[^0-9]*q([1-4])/)
  if (quarterMatch) {
    const [, a, b] = quarterMatch
    const year = a.length === 4 ? Number(a) : Number(b)
    const quarter = a.length === 4 ? Number(b) : Number(a)
    const endMonth = quarter * 3 // 1-indexed month that ends that quarter
    const day = new Date(year, endMonth, 0).getDate()
    return `${year}-${String(endMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // A "M03-2026"-style month-number label -- matches the Period Label
  // field's own placeholder text, so it has to be recognized too.
  const mLabelMatch = t.match(/\bm(\d{1,2})[^0-9]*(\d{4})\b/)
  if (mLabelMatch) {
    const month = Number(mLabelMatch[1])
    const year = Number(mLabelMatch[2])
    if (month >= 1 && month <= 12) {
      const day = new Date(year, month, 0).getDate()
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  // A month name (full or abbreviated), optionally with a year --
  // e.g. "sept", "september 2026", "sep-26".
  const monthIdx = MONTH_NAMES.findIndex((name) => t.includes(name) || t.includes(name.slice(0, 3)))
  if (monthIdx !== -1) {
    const yearMatch = t.match(/(\d{4})/) || t.match(/\b(\d{2})\b/)
    const currentYear = new Date().getFullYear()
    let year = currentYear
    if (yearMatch) {
      year = yearMatch[1].length === 4 ? Number(yearMatch[1]) : 2000 + Number(yearMatch[1])
    }
    const month = monthIdx + 1
    const day = new Date(year, month, 0).getDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

export default function TrackingChatHub() {
  const { activeCompanyId, activeProjectId, loadProjects, addToast } = useProject()

  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [chatTools, setChatTools] = useState({})

  const [showBaselineModal, setShowBaselineModal] = useState(false)
  // 'wo' is now the ONLY baseline source this modal offers -- Phase 1
  // Concept Estimate was removed as a selectable baseline per product
  // decision (Work Orders are finalized documents; a conceptual estimate
  // isn't). Kept as state (rather than a plain constant) only because
  // handleRecordBaselineSubmit and the API payload below still read it by
  // name -- nothing in this file sets it to anything else anymore.
  const [baselineSourceType] = useState('wo')
  const [baselineFile, setBaselineFile] = useState(null)
  const [baselineFloorArea, setBaselineFloorArea] = useState('25000')
  const [baselineFloorAreaBasis, setBaselineFloorAreaBasis] = useState('built_up_total')
  const [isRecordingBaseline, setIsRecordingBaseline] = useState(false)

  const [showBillModal, setShowBillModal] = useState(false)
  const [billPeriod, setBillPeriod] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  // Bug fix: "the dates seem to be hardcoded" / "graph plots are mixed
  // up" -- billDate used to NEVER get reset after a successful submit,
  // so logging three present-period bills (Sept, Oct, Nov) back to back
  // without manually re-picking the date each time silently logged all
  // three against the SAME billed_date (whichever one was last set, or
  // today's date by default). billed_date is the real chart-ordering key
  // (see phase3.py's list_bill_periods docstring), so identical dates
  // made the plotted order fall back to arbitrary filesystem order
  // instead of upload order -- and the x-axis, which labels each point
  // from billed_date, showed the same date three times over.
  // billDateTouched tracks whether THIS modal session's date was
  // deliberately picked by the user; while it's false, typing a period
  // label that looks like a month/date auto-fills billDate to match (see
  // guessDateFromPeriod below) so the two stay in sync without extra
  // clicks, but the moment the user touches the date picker themselves
  // their choice always wins.
  const [billDateTouched, setBillDateTouched] = useState(false)
  const [billStatedPct, setBillStatedPct] = useState('')
  const [billFile, setBillFile] = useState(null)
  // "Phase 5" quantity-basis toggle -- only meaningful for a .pdf
  // (Certificate of Payment) bill, which states Previous/Present/Cummu.
  // for both Quantity and Value (see cop_bill_parser.py). Defaults to
  // 'cummulative' (this bill's total quantity to date) to match the
  // original/pre-existing behavior; 'present' uses just this billing
  // period's quantity instead.
  const [billQuantityBasis, setBillQuantityBasis] = useState('cummulative')
  const [isLoggingBill, setIsLoggingBill] = useState(false)

  // Phase E: the chat bar reports its live pending chat-proposed
  // substitution up here (or null once confirmed/discarded/switched
  // away from), so it can be overlaid on the chart as a dashed
  // "Proposed" reference line -- a real computed number, purely a
  // client-side preview until Confirm is actually clicked.
  const [pendingRecommendation, setPendingRecommendation] = useState(null)

  // Stale-response guard: loadData() is async and can be in flight when
  // the user switches projects via ProjectSwitcher before it resolves.
  // Without this, a slow /dashboard response for the PREVIOUS project
  // can land after the switch and silently overwrite the new project's
  // just-loaded state with the old project's numbers -- reproduced live
  // (switch A -> B while A's dashboard fetch is still pending: B's
  // correct baseline briefly shows, then A's delayed response clobbers
  // it). Same pattern ProjectContext.jsx's own job-poller effect already
  // uses a `cancelled` flag for.
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) {
      setDashboard(null)
      setBills([])
      return
    }
    loadData()
    loadChatTools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeCompanyId])

  const loadData = async () => {
    const requestedProjectId = activeProjectId
    setIsLoading(true)
    try {
      const dash = await api.getDashboard(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return // a newer project switch has already superseded this response
      setDashboard(dash)
      const bList = await api.getBills(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setBills(bList)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('No dashboard yet for project:', err.message)
      setDashboard(null)
      setBills([])
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoading(false)
    }
  }

  const loadChatTools = async () => {
    try {
      const tools = await api.getChatTools()
      setChatTools(tools)
    } catch (err) {
      console.warn('Could not load chat tools:', err.message)
    }
  }

  const handleRecordBaselineSubmit = async (e) => {
    e.preventDefault()
    if (!baselineFile) {
      addToast('Please select a Work Order file', 'error')
      return
    }
    setIsRecordingBaseline(true)
    try {
      await api.recordBaseline(activeProjectId, {
        companyId: activeCompanyId,
        sourceType: baselineSourceType,
        file: baselineFile,
        floorAreaSqm: baselineFloorArea ? Number(baselineFloorArea) : undefined,
        floorAreaBasis: baselineFloorAreaBasis,
        overwrite: true,
      })
      addToast('Baseline recorded successfully', 'success')
      setShowBaselineModal(false)
      setBaselineFile(null)
      loadData()
    } catch (err) {
      addToast(`Failed to record baseline: ${err.message}`, 'error')
    } finally {
      setIsRecordingBaseline(false)
    }
  }

  // Quantity-basis choice only applies to a .pdf (COP) bill -- an .xlsx
  // BOQ-shaped bill has no Previous/Present/Cummu. split (see
  // cop_bill_parser.py's module docstring), so the toggle is hidden and
  // never sent for that format.
  const isBillFilePdf = !!billFile && billFile.name.toLowerCase().endsWith('.pdf')

  // Bug fix: a second, independent safety net against the "all my bills
  // ended up on the same date" report -- even with the period->date
  // auto-fill and the post-submit reset (see guessDateFromPeriod and
  // handleLogBillSubmit above), the user can still type or pick a date
  // by hand that collides with a bill already on file for this project
  // (e.g. typo'ing the year). Flagging it here, before submit, is
  // cheaper than noticing it after the chart renders out of order.
  const duplicateDateBill = billDate ? bills.find((b) => b.billed_date === billDate && b.period !== billPeriod.trim()) : null

  const handleLogBillSubmit = async (e) => {
    e.preventDefault()
    if (!billFile) {
      addToast('Please select a bill document (.xlsx or .pdf)', 'error')
      return
    }
    setIsLoggingBill(true)
    try {
      await api.logBill(activeProjectId, {
        companyId: activeCompanyId,
        period: billPeriod.trim() || billDate,
        billedDate: billDate,
        file: billFile,
        statedPercentComplete: billStatedPct ? Number(billStatedPct) : undefined,
        quantityBasis: isBillFilePdf ? billQuantityBasis : undefined,
      })
      addToast(`Bill logged for ${billPeriod || billDate} — the project now shows in Projects with this update`, 'success', 6000)
      setShowBillModal(false)
      setBillFile(null)
      setBillPeriod('')
      // Bug fix: billDate used to be left exactly as it was for the NEXT
      // bill, so logging several periods back to back without manually
      // re-picking the date each time silently stamped them all with the
      // same billed_date (see guessDateFromPeriod's comment above and
      // list_bill_periods' docstring for the full chain this caused).
      // Resetting both the date and the "touched" flag means the next
      // bill starts fresh -- today's date by default, or auto-filled
      // again from whatever period label is typed next.
      setBillDate(new Date().toISOString().split('T')[0])
      setBillDateTouched(false)
      setBillStatedPct('')
      setBillQuantityBasis('cummulative')
      loadData()
      loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Failed to log bill: ${err.message}`, 'error')
    } finally {
      setIsLoggingBill(false)
    }
  }

  // UX refinement: "should have option to remove an uploaded bill in the
  // graph" -- a bill logged under the wrong period, from the wrong file,
  // or on the wrong quantity basis previously had no way back out short
  // of re-uploading over it with overwrite=True under the exact same
  // period label. deleteBillTarget holds the bill pending confirmation
  // (its own small modal, matching ProjectsOverview.jsx's project-delete
  // dialog, not a native confirm()) -- null when none is pending.
  const [deleteBillTarget, setDeleteBillTarget] = useState(null) // BillPeriod | null
  const [isDeletingBill, setIsDeletingBill] = useState(false)

  const handleConfirmDeleteBill = async () => {
    if (!deleteBillTarget) return
    setIsDeletingBill(true)
    try {
      await api.deleteBill(activeProjectId, deleteBillTarget.period, activeCompanyId)
      addToast(`Removed bill for period "${deleteBillTarget.period}"`, 'success')
      setDeleteBillTarget(null)
      loadData()
      loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Failed to remove bill: ${err.message}`, 'error')
    } finally {
      setIsDeletingBill(false)
    }
  }

  const baselineTonnes = dashboard?.baseline ? dashboard.baseline.total_gwp_kg_co2e / 1000 : null
  const projectedTonnes = dashboard?.projected_total_gwp_kg_co2e ? dashboard.projected_total_gwp_kg_co2e / 1000 : null
  const isExceedingBaseline = dashboard?.projected_vs_baseline_pct != null && dashboard.projected_vs_baseline_pct > 0
  const billStatus = dashboard
    ? {
        percentComplete: dashboard.percent_complete,
        percentCompleteSource: dashboard.percent_complete_source,
        latestPeriod: dashboard.latest_period,
        projectedVsBaselinePct: dashboard.projected_vs_baseline_pct,
      }
    : null
  const latestBill = bills.length > 0 ? bills[bills.length - 1] : null

  // UX refinement: cumulative-basis and present-basis points now go to
  // two genuinely separate charts (see ZoomableCarbonChart's own
  // docstring) instead of being overlaid on one shared axis. A point
  // with no quantity_basis recorded at all (an xlsx_boq bill, or any
  // bill saved before this option existed) was always cumulative by
  // construction -- same convention compute_dashboard() already uses.
  const dashboardPoints = dashboard?.points || []
  const cumulativePoints = dashboardPoints.filter((p) => p.quantity_basis !== 'present')
  const presentOnlyPoints = dashboardPoints.filter((p) => p.quantity_basis === 'present')

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 'calc(100vh - 180px)' }}>
      {/* Header: project switcher + primary actions.
          Root cause of the ProjectSwitcher "ghosting"/unclickable-row bug
          (confirmed live via document.elementFromPoint(), not guessed):
          .glass-panel's `backdrop-filter` makes THIS header its own CSS
          stacking context, same as the "No project selected" / baseline
          empty-state panels below it. None of these panels sets a
          z-index, so they all land in the same "z-index:auto" paint
          bucket and simply paint in DOM order -- meaning the empty-state
          panel, coming later in the markup, paints ON TOP of this
          header's entire stacking context whenever the two visually
          overlap. ProjectSwitcher's dropdown has `zIndex: 200`, but that
          only wins inside THIS header's own stacking context -- it can't
          reach past the header's stacking-context boundary to beat a
          sibling stacking context, which is exactly why the dropdown's
          rows appeared faded/doubled (the empty-state panel's background
          painting over them) and intercepted clicks in that overlapping
          region, while the search input higher up (outside the overlap)
          stayed sharp. Giving the header an explicit, positive z-index
          moves its whole stacking context into the "positive z-index"
          paint layer, which always paints above the z-index:auto layer
          the sibling panels are in -- fixing this without touching the
          shared .glass-panel class every other panel in the app relies
          on. */}
      <div className="glass-panel" style={{ position: 'relative', zIndex: 10, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', borderLeft: '4px solid var(--accent-amber)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <ProjectSwitcher />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className="badge badge-amber">Tracking & Chat</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', maxWidth: 480 }}>
              Every bill you upload here is measured against this project's fixed baseline. Ask the assistant anything about it below.
            </p>
          </div>
        </div>

        {activeProjectId && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowBaselineModal(true)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
              <Clock size={15} />
              <span>{dashboard?.baseline ? 'Update Baseline' : 'Set Baseline'}</span>
            </button>
            {dashboard?.baseline && (
              <button
                onClick={() => {
                  // Always start a fresh modal session with today's date
                  // and the "touched" flag cleared, regardless of what a
                  // previous bill (or a cancelled attempt) left behind.
                  setBillDate(new Date().toISOString().split('T')[0])
                  setBillDateTouched(false)
                  setShowBillModal(true)
                }}
                className="btn-primary"
                style={{ fontSize: '0.8125rem' }}
              >
                <Plus size={15} />
                <span>Add Bill</span>
              </button>
            )}
          </div>
        )}
      </div>

      {!activeProjectId ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={28} color="#f59e0b" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>No project selected</h3>
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', maxWidth: 420 }}>
            Use the project switcher above to pick or search for a project by name.
          </p>
        </div>
      ) : !dashboard?.baseline ? (
        <div className="glass-panel" style={{ padding: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={32} color="#f59e0b" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc' }}>No Fixed Baseline Recorded Yet</h3>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: 440 }}>
            Before you can log bills and track running carbon, record this project's initial full-scope baseline.
          </p>
          <button onClick={() => setShowBaselineModal(true)} className="btn-primary" style={{ marginTop: 6 }}>
            Set Project Baseline
          </button>
        </div>
      ) : (
        <>
          {/* Baseline status strip */}
          <div style={{ background: 'rgba(12, 22, 16, 0.75)', border: '1px solid rgba(49, 130, 206, 0.16)', borderRadius: 'var(--radius-md)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${dashboard.baseline.is_estimated ? 'badge-amber' : 'badge-mint'}`}>
                {dashboard.baseline.is_estimated ? 'Estimated Baseline' : `Priced Baseline (${dashboard.baseline.source_type.toUpperCase()})`}
              </span>
              <span style={{ color: '#f8fafc', fontWeight: 500 }}>Baseline: {(dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)} tCO₂e</span>
              <span style={{ color: '#64748b' }}>•</span>
              <span style={{ color: '#94a3b8' }}>Recorded {new Date(dashboard.baseline.recorded_at).toLocaleDateString()} from {dashboard.baseline.source_file}</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#3182CE' }}>{bills.length} {bills.length === 1 ? 'Bill' : 'Bills'} Logged</span>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {/* "Billed to Date" was hardcoded to always claim 'Cumulative',
                and always read billed_to_date_gwp_kg_co2e -- which the
                backend deliberately only ever derives from a cumulative-
                basis bill (needed for percent-complete/projection to stay
                correct, see compute_dashboard's own comment). That meant a
                project tracked via 'present' (per-month) bills showed a
                stale or zero figure here with no sign the user's own
                latest upload wasn't reflected at all. Now this card
                follows whichever basis the MOST RECENT bill actually used
                (dashboard.latest_bill_quantity_basis), labeled honestly:
                'Present' shows that bill's own period-only figure, never
                mislabeled as a running total. */}
            <StatCard
              title="Billed to Date"
              value={
                dashboard.latest_bill_quantity_basis === 'present'
                  ? (dashboard.latest_bill_gwp_kg_co2e ? (dashboard.latest_bill_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
                  : (dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
              }
              unit="tCO₂e"
              subtitle={
                dashboard.latest_bill_quantity_basis === 'present'
                  ? `Latest period: ${dashboard.latest_bill_period} (this period only, not a running total)`
                  : `Latest period: ${dashboard.latest_period || 'None yet'}`
              }
              accent="amber"
              badge={
                !dashboard.latest_bill_period ? 'Pending' : dashboard.latest_bill_quantity_basis === 'present' ? 'Present' : 'Cumulative'
              }
              badgeType="amber"
            />
            <StatCard
              title="Project Completion"
              value={dashboard.percent_complete ? `${dashboard.percent_complete.toFixed(1)}%` : '0%'}
              subtitle={dashboard.percent_complete_source?.replace(/_/g, ' ') || 'Awaiting bills'}
              accent="mint"
              badge="Progress"
              badgeType="mint"
            />
            <StatCard
              title="Projected at Completion"
              value={dashboard.projected_total_gwp_kg_co2e ? (dashboard.projected_total_gwp_kg_co2e / 1000).toFixed(1) : (dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)}
              unit="tCO₂e"
              subtitle={
                dashboard.projected_vs_baseline_pct !== null && dashboard.projected_vs_baseline_pct !== undefined
                  ? `${dashboard.projected_vs_baseline_pct > 0 ? '+' : ''}${dashboard.projected_vs_baseline_pct.toFixed(1)}% vs Baseline`
                  : 'At baseline estimate'
              }
              accent={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'rose' : 'lime'}
              badge={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'Exceeding' : 'On Track'}
              badgeType={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
            />
            {dashboard.cost_per_kg_co2e_to_date && (
              <StatCard
                title="Cost per kg CO₂e"
                value={`₹${dashboard.cost_per_kg_co2e_to_date.toFixed(1)}`}
                subtitle="Billed Rs value / Billed kg CO₂e"
                accent="cyan"
                badge="Efficiency"
                badgeType="cyan"
              />
            )}
          </div>

          {/* Benchmark comparison */}
          {dashboard.benchmark_available && (
            <div className="glass-panel" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8' }}>
                  Typical Building Benchmark
                </span>
                <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>{dashboard.benchmark_floor_band_used}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="tabular-nums" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
                  {dashboard.projected_carbon_per_sqm?.toFixed(1) || '-'}
                </span>
                <span style={{ fontSize: '0.8125rem', color: '#3182CE' }}>kgCO₂e / m²</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>(Typical is {dashboard.typical_carbon_per_sqm?.toFixed(1)} kg/m²)</span>
              </div>
            </div>
          )}

          {/* Zoomable chart -- full width, ~75% of the viewport tall so a
              long bill history reads like a real stock chart instead of a
              cramped sidebar tile. Shows the previously-set baseline, the
              projected total extrapolated from bills to date, and (while
              chat has a pending what-if) the proposed total -- three fixed
              reference lines against the one real measured series -- plus
              a status readout (percent complete, source, latest period)
              right above the plot.

              Only CUMULATIVE-basis points go on this chart now -- see
              ZoomableCarbonChart's own docstring for why mixing a
              present-basis point (one billing period's own quantity, a
              naturally much smaller number) onto the same axis as a
              baseline/projected-scale running total was reported live as
              confusing and is now a real, separate chart below instead. */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <TrendingUp size={16} color="#3182CE" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Cumulative Carbon vs Baseline</h3>
            </div>
            <ZoomableCarbonChart
              points={cumulativePoints}
              baselineTonnes={baselineTonnes}
              projectedTonnes={projectedTonnes}
              isExceedingBaseline={isExceedingBaseline}
              proposedTonnes={pendingRecommendation ? pendingRecommendation.carbon_kg_after / 1000 : null}
              billStatus={billStatus}
              onPointClick={(point) => setDeleteBillTarget(point)}
              emptyMessage={
                presentOnlyPoints.length > 0
                  ? 'No cumulative-basis bill logged yet -- see Present-Period Bills below for what has been logged so far.'
                  : undefined
              }
              height="75vh"
            />
          </div>

          {/* UX refinement: present-basis bills get their own chart,
              genuinely separate from the cumulative one above -- not just
              differently colored on the same canvas. Each point here is
              one billing period's own quantity (never summed with any
              other). Only rendered at all once there's at least one
              present-basis bill.

              Post-delivery correction: briefly passed baselineTonnes/
              projectedTonnes/isExceedingBaseline through to this chart
              too (the amber baseline + red/lime projected reference
              lines), then asked to remove them again -- reverted back to
              no reference lines here. This chart stays exactly what the
              original design called for: the one real series, with
              nothing it isn't actually being measured against. */}
          {presentOnlyPoints.length > 0 && (
            <div className="glass-panel" style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <TrendingUp size={16} color="#fb923c" />
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Present-Period Bills (not cumulative)</h3>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 14, lineHeight: 1.4 }}>
                Each point is that billing period's own quantity only -- never a running total, and never added to
                the cumulative chart above.
              </p>
              <ZoomableCarbonChart
                points={presentOnlyPoints}
                onPointClick={(point) => setDeleteBillTarget(point)}
                height={240}
              />
            </div>
          )}

          {/* Latest-bill category breakdown -- its own row now that the
              chart above takes the full width. */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <BarChart3 size={16} color="#38bdf8" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Latest Bill · Carbon by Material</h3>
            </div>
            {latestBill ? (
              <CategoryBarChart categories={latestBill.category_breakdown || []} />
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                Add a bill to see its material breakdown here.
              </div>
            )}
          </div>

          {/* Unified bills table */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc', marginBottom: 14 }}>All Logged Bills</h3>
            {bills.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(49, 130, 206, 0.15)', color: '#3182CE', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '8px 12px' }}>Period</th>
                      <th style={{ padding: '8px 12px' }}>Billed Date</th>
                      <th style={{ padding: '8px 12px' }}>Source</th>
                      <th style={{ padding: '8px 12px' }}>GWP to Date (tCO₂e)</th>
                      <th style={{ padding: '8px 12px' }}>Billed Value</th>
                      <th style={{ padding: '8px 12px' }}>% Complete</th>
                      <th style={{ padding: '8px 12px' }}>Lines Computed</th>
                      <th style={{ padding: '8px 12px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.8125rem' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>{b.period}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{b.billed_date}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            {b.bill_source === 'pdf_cop' ? (
                              <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                                <FileText size={11} /> COP PDF
                              </span>
                            ) : (
                              <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>Excel BOQ</span>
                            )}
                            {/* Only a pdf_cop bill ever carries a quantity_basis (see
                                phase3.py's BillPeriod) -- surfaced so a project mixing
                                "cumulative to date" and "present period only" bills is
                                never mistaken for one continuous cumulative series. */}
                            {b.quantity_basis === 'present' && (
                              <span className="badge badge-amber" style={{ fontSize: '0.6rem' }} title="This bill reflects only its own billing period's quantities, not a running total.">
                                Present period only
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#3182CE', fontWeight: 600 }}>
                          {(b.total_gwp_kg_co2e_to_date / 1000).toFixed(1)}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#cbd5e1' }}>₹{(b.total_value_to_date / 100000).toFixed(1)}L</td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#3182CE' }}>
                          {b.stated_percent_complete ? `${b.stated_percent_complete.toFixed(1)}%` : '-'}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#94a3b8' }}>{b.n_lines_computed}/{b.n_lines_total}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <button
                            type="button"
                            onClick={() => setDeleteBillTarget(b)}
                            title={`Remove bill for period "${b.period}"`}
                            style={{
                              background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.2)',
                              borderRadius: 'var(--radius-sm)', color: '#fb7185', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 5,
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: '#64748b' }}>No bills logged yet. Click "Add Bill" above to record the first period.</p>
            )}
          </div>
        </>
      )}

      {/* Spacer so content never sits directly under the sticky chat bar */}
      <div style={{ flex: 1 }} />

      {/* Chat bar, pinned to the bottom */}
      <ChatBar chatTools={chatTools} onPendingChange={setPendingRecommendation} />

      {/* Set/Update Baseline Modal */}
      {showBaselineModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>Set Project Baseline</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 18 }}>
              This recorded baseline serves as the permanent benchmark point every subsequent bill is measured against.
            </p>
            <form onSubmit={handleRecordBaselineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Baseline Source Type</label>
                {/* Both BOQ and, per the newest product decision, "Existing
                    Phase 1 Concept Estimate" have been removed as
                    selectable baseline sources here -- Work Order is now
                    the only baseline this modal records (finalized
                    documents only; neither a BOQ upload nor a conceptual
                    estimate should seed a Phase 3 baseline). Since there's
                    only one source left, this is a fixed, non-editable
                    field rather than a single-option dropdown. The backend
                    still fully supports source_type='boq'/'phase1_estimate'
                    (Phase 4's swap/audit engine, and any project already
                    baselined that way, keep working) -- this UI change
                    alone doesn't remove that capability, it just stops
                    offering either for new baselines. */}
                <div className="form-input" style={{ display: 'flex', alignItems: 'center', color: '#f8fafc', cursor: 'default' }}>
                  Uploaded Work Order (.pdf)
                </div>
              </div>

              <div style={{ border: '2px dashed rgba(49, 130, 206, 0.25)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', background: 'rgba(9, 16, 11, 0.6)' }}>
                <input
                  type="file"
                  id="hub-baseline-file-input"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBaselineFile(e.target.files[0] || null)}
                />
                <label htmlFor="hub-baseline-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <Upload size={20} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#f8fafc' }}>
                    {baselineFile ? baselineFile.name : 'Select Work Order (.pdf) file'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowBaselineModal(false)} className="btn-secondary" disabled={isRecordingBaseline}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isRecordingBaseline}>
                  {isRecordingBaseline ? 'Recording...' : 'Record Baseline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Bill Modal -- unified: accepts .xlsx OR .pdf, backend auto-detects */}
      {showBillModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>Add a Bill</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 18 }}>
              Upload an Excel BOQ-shaped bill or a Certificate of Payment PDF — either works here, evaluated against the same baseline.
            </p>
            <form onSubmit={handleLogBillSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Period Label</label>
                  <input
                    type="text"
                    placeholder="e.g. 2026-Q1, M03-2026, Sept"
                    value={billPeriod}
                    onChange={(e) => {
                      const value = e.target.value
                      setBillPeriod(value)
                      // Bug fix: auto-sync Billed Date from the period
                      // label (e.g. typing "Sept" or "2026-09" fills in
                      // 2026-09-30) so the two fields can't quietly drift
                      // apart -- but only while the user hasn't
                      // deliberately picked a date of their own this time.
                      if (!billDateTouched) {
                        const guessed = guessDateFromPeriod(value)
                        if (guessed) setBillDate(guessed)
                      }
                    }}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Billed Date</label>
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={(e) => {
                      setBillDate(e.target.value)
                      setBillDateTouched(true)
                    }}
                    className="form-input"
                  />
                </div>
              </div>

              {duplicateDateBill && (
                <p style={{ fontSize: '0.75rem', color: '#f59e0b', margin: '-8px 0 0', lineHeight: 1.4 }}>
                  ⚠ Period "{duplicateDateBill.period}" is already logged with this same date. Logging another
                  bill on the same date can scramble the chart's left-to-right order -- pick a different date
                  if these are actually two separate periods.
                </p>
              )}

              <div className="form-group">
                <label className="form-label">
                  Stated % Complete <span className="form-label-optional">(Optional)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="e.g. 35.0 (derived from value if omitted)"
                  value={billStatedPct}
                  onChange={(e) => setBillStatedPct(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ border: '2px dashed rgba(49, 130, 206, 0.25)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', background: 'rgba(9, 16, 11, 0.6)' }}>
                <input
                  type="file"
                  id="hub-bill-file-input"
                  accept=".xlsx,.xls,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBillFile(e.target.files[0] || null)}
                />
                <label htmlFor="hub-bill-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <Upload size={20} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#f8fafc' }}>
                    {billFile ? billFile.name : 'Select Bill Document (.xlsx or .pdf)'}
                  </span>
                </label>
              </div>

              {isBillFilePdf && (
                <div className="form-group">
                  <label className="form-label">
                    Quantity Basis <span className="form-label-optional">(Certificate of Payment only)</span>
                  </label>
                  <select
                    value={billQuantityBasis}
                    onChange={(e) => setBillQuantityBasis(e.target.value)}
                    className="form-select"
                  >
                    <option value="cummulative">Cumulative to date (Cummu. column)</option>
                    <option value="present">This billing period only (Present column)</option>
                  </select>
                  <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                    {billQuantityBasis === 'present'
                      ? "Uses only this RA bill's Present-column quantities -- this bill will represent this period's work alone, not the running total."
                      : "Uses the Cummu. column -- this bill represents total work done on the project as of this date (the default)."}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowBillModal(false)} className="btn-secondary" disabled={isLoggingBill}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isLoggingBill || !billFile}>
                  {isLoggingBill ? 'Parsing & Computing...' : 'Add Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete-bill confirmation -- its own small modal, matching
          ProjectsOverview.jsx's project-delete dialog style, not a
          native confirm(). Removing a bill only drops that one period;
          the baseline and every other bill are untouched, and the
          dashboard/chart simply recompute without it on the next load. */}
      {deleteBillTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <AlertTriangle size={20} color="#fb7185" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Remove this bill?</h3>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 22, lineHeight: 1.5 }}>
              This permanently removes the bill logged for period{' '}
              <strong style={{ color: '#f8fafc' }}>"{deleteBillTarget.period}"</strong> (billed{' '}
              {deleteBillTarget.billed_date}). The baseline and every other bill are untouched. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setDeleteBillTarget(null)} className="btn-secondary" disabled={isDeletingBill}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDeleteBill} className="btn-danger" disabled={isDeletingBill}>
                {isDeletingBill ? 'Removing...' : 'Remove Bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}