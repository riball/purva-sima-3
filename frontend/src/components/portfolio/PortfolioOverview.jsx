import React, { useState, useEffect, useMemo } from 'react'
import {
  Building2, TrendingUp, TrendingDown, Layers, ArrowUpDown, ChevronRight, Search, Pencil,
  BarChart3, PieChart as PieChartIcon, FileSpreadsheet, Sparkles, Gauge,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import { aggregateCategories, CATEGORY_COLORS, CATEGORY_LABELS, FALLBACK_COLOR } from '../common/charts/MaterialBreakdownChart'
import ProjectProfileModal, { ARCHETYPE_OPTIONS } from './ProjectProfileModal'

/**
 * Phase 2 -- Portfolio Overview, rebuilt to match the user's original
 * Google AI Studio mockup's structure and feel (two KPI rows, a
 * toggleable bar/pie chart section, a filterable/sortable table) while
 * using ONLY real data -- see the approved plan
 * ("Portfolio Overview frontend rebuild") for the full design.
 *
 * No single backend endpoint aggregates "all my projects" into
 * portfolio-wide KPIs -- GET /phase3/projects (ProjectSummary) only
 * returns per-project list-to-pick-from fields. Every portfolio-wide
 * number here is computed client-side from two real per-project
 * fan-outs: GET /phase3/projects/{id}/dashboard (same figures the
 * Project Dashboard page shows for one project) and GET
 * /phase3/projects/{id}/bills (for the by-category breakdown, reusing
 * MaterialBreakdownChart's own aggregateCategories() rather than
 * re-deriving its cumulative-vs-present-basis math a second time). A
 * project with no baseline yet contributes to the project count but not
 * to any carbon total or chart (there is nothing real to show).
 *
 * "Unreviewed Bills" / bill review-approval status (a mockup-only concept
 * with no backend analog) was dropped from scope per explicit user
 * decision -- the "Status" column/filter here is a derived
 * on-track/above-baseline state from real variance, never a review
 * status.
 */

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'baseline', label: 'Baseline (t)' },
  { key: 'completion', label: 'Completion' },
  { key: 'variance', label: 'vs Baseline' },
  { key: 'bills', label: 'Bills' },
]

const STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'on_track', label: 'On Track' },
  { value: 'above_baseline', label: 'Above Baseline' },
]

// Baseline=amber, Billed to Date=lime, Projected=cyan -- this app's own
// already-established per-series convention (see CarbonDataExplorer.jsx's
// SERIES map: baseline is always amber, cumulative/billed is always lime),
// reused here rather than inventing a new one for this one chart.
const SERIES_COLORS = { baseline: 'var(--accent-amber)', billed: 'var(--accent-lime)', projected: 'var(--accent-cyan)' }

export default function PortfolioOverview() {
  const { projects, activeCompanyId, selectProject, navigate, isLoading: projectsLoading, loadProjects } = useProject()

  const [dashboards, setDashboards] = useState({}) // project_id -> dashboard | 'error' | undefined
  const [billsByProject, setBillsByProject] = useState({}) // project_id -> bills[] | 'error' | undefined
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [sortKey, setSortKey] = useState('variance')
  const [sortDir, setSortDir] = useState('desc')
  const [chartMode, setChartMode] = useState('comparison') // 'comparison' | 'distribution'
  const [searchQuery, setSearchQuery] = useState('')
  const [archetypeFilter, setArchetypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingProject, setEditingProject] = useState(null) // project_id, or null

  useEffect(() => {
    let cancelled = false
    const baselined = projects.filter((p) => p.has_baseline)
    if (baselined.length === 0) {
      setDashboards({})
      setBillsByProject({})
      return
    }
    setIsLoadingDetail(true)
    Promise.allSettled(baselined.map((p) => api.getDashboard(p.project_id, activeCompanyId))).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((res, i) => {
        next[baselined[i].project_id] = res.status === 'fulfilled' ? res.value : 'error'
      })
      setDashboards(next)
    })
    Promise.allSettled(baselined.map((p) => api.getBills(p.project_id, activeCompanyId))).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((res, i) => {
        next[baselined[i].project_id] = res.status === 'fulfilled' ? res.value : 'error'
      })
      setBillsByProject(next)
      setIsLoadingDetail(false)
    })
    return () => {
      cancelled = true
    }
  }, [projects, activeCompanyId])

  // One row per project -- real dashboard/bill figures where available,
  // nulls otherwise (rendered as "--", never a fabricated zero).
  const rows = useMemo(() => {
    return projects.map((p) => {
      const dash = dashboards[p.project_id]
      const hasDash = dash && dash !== 'error' && dash.baseline
      const bills = billsByProject[p.project_id]
      const categoryTotals = Array.isArray(bills) ? aggregateCategories(bills).rows : []
      const largestCategory = categoryTotals.length > 0 ? categoryTotals[0] : null

      return {
        project: p,
        dashboard: hasDash ? dash : null,
        categoryTotals,
        largestCategory,
        baselineT: hasDash ? dash.baseline.total_gwp_kg_co2e / 1000 : null,
        billedT: hasDash && dash.billed_to_date_gwp_kg_co2e != null ? dash.billed_to_date_gwp_kg_co2e / 1000 : null,
        projectedT: hasDash && dash.projected_total_gwp_kg_co2e ? dash.projected_total_gwp_kg_co2e / 1000 : hasDash ? dash.baseline.total_gwp_kg_co2e / 1000 : null,
        floorAreaSqm: hasDash ? dash.baseline.floor_area_sqm : null,
        completionPct: hasDash ? dash.percent_complete : null,
        variancePct: hasDash ? dash.projected_vs_baseline_pct : null,
        bills: p.n_bills || 0,
      }
    })
  }, [projects, dashboards, billsByProject])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((r) => {
      const p = r.project
      const matchesSearch =
        !q ||
        (p.project_name || '').toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
      const matchesArchetype = archetypeFilter === 'all' || p.archetype === archetypeFilter
      const exceeding = r.variancePct !== null && r.variancePct > 0
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'above_baseline' && exceeding) ||
        (statusFilter === 'on_track' && r.variancePct !== null && !exceeding)
      return matchesSearch && matchesArchetype && matchesStatus
    })
  }, [rows, searchQuery, archetypeFilter, statusFilter])

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const withValue = (r) => {
      switch (sortKey) {
        case 'name': return r.project.project_name || ''
        case 'baseline': return r.baselineT ?? -Infinity
        case 'completion': return r.completionPct ?? -Infinity
        case 'variance': return r.variancePct ?? -Infinity
        case 'bills': return r.bills
        default: return 0
      }
    }
    return [...filteredRows].sort((a, b) => {
      const av = withValue(a)
      const bv = withValue(b)
      if (typeof av === 'string') return av.localeCompare(bv) * dir
      return (av - bv) * dir
    })
  }, [filteredRows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Portfolio-wide aggregates -- plain sums over whichever rows have real
  // data loaded. A project with no baseline simply isn't part of any total.
  const tracked = rows.filter((r) => r.dashboard)
  const totalBilledT = tracked.reduce((sum, r) => sum + (r.billedT || 0), 0)
  const totalBaselineT = tracked.reduce((sum, r) => sum + (r.baselineT || 0), 0)
  const totalProjectedT = tracked.reduce((sum, r) => sum + (r.projectedT || 0), 0)
  const portfolioVariancePct = totalBaselineT > 0 ? ((totalProjectedT - totalBaselineT) / totalBaselineT) * 100 : null
  const exceedingCount = tracked.filter((r) => r.variancePct !== null && r.variancePct > 0).length
  const untrackedCount = projects.length - tracked.length

  const totalFloorArea = tracked.reduce((sum, r) => sum + (r.floorAreaSqm || 0), 0)
  const portfolioIntensity = totalFloorArea > 0 ? (totalProjectedT * 1000) / totalFloorArea : null

  // Portfolio-wide material distribution -- sum every tracked project's
  // own per-category totals (each already correctly basis-handled by
  // aggregateCategories()) into one cross-project total per category.
  const portfolioCategoryTotals = useMemo(() => {
    const totals = new Map()
    tracked.forEach((r) => {
      r.categoryTotals.forEach((c) => {
        totals.set(c.category, (totals.get(c.category) || 0) + c.total)
      })
    })
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }, [tracked])

  const largestPortfolioCategory = portfolioCategoryTotals[0] || null

  const comparisonChartData = tracked
    .map((r) => ({
      name: (r.project.project_name || r.project.project_id).length > 16
        ? (r.project.project_name || r.project.project_id).substring(0, 14) + '…'
        : (r.project.project_name || r.project.project_id),
      baseline: r.baselineT ? Math.round(r.baselineT * 10) / 10 : 0,
      billed: r.billedT ? Math.round(r.billedT * 10) / 10 : 0,
      projected: r.projectedT ? Math.round(r.projectedT * 10) / 10 : 0,
    }))

  function openProject(projectId) {
    selectProject(projectId)
    // 'project' is now the Directory grid, not a single project's
    // dashboard (see the "Projects & Embodied Carbon Directory + Project
    // Dashboard rebuild" plan) -- 'project-dashboard' is where
    // ProjectDashboard itself lives now.
    navigate('project-dashboard')
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || (category ? category.replace(/_/g, ' ') : 'Uncategorized')
  }
  function categoryColor(category) {
    return CATEGORY_COLORS[category] || FALLBACK_COLOR
  }

  const editingRow = editingProject ? rows.find((r) => r.project.project_id === editingProject) : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header + quick actions */}
      <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(var(--c-blue), 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)' }}>
            <Layers size={18} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Portfolio Overview</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} in this workspace · {tracked.length} with a recorded baseline
              {isLoadingDetail && <span style={{ color: 'var(--text-muted)' }}> · loading real figures…</span>}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('project')} className="btn-primary" style={{ fontSize: '0.78rem', padding: '7px 12px' }}>
            <Building2 size={14} />
            <span>Browse All Projects</span>
          </button>
          <button onClick={() => navigate('tracking')} className="btn-secondary" style={{ fontSize: '0.78rem', padding: '7px 12px' }}>
            <TrendingUp size={14} />
            <span>Carbon Tracking</span>
          </button>
          <button onClick={() => navigate('analyze-boq')} className="btn-secondary" style={{ fontSize: '0.78rem', padding: '7px 12px' }}>
            <FileSpreadsheet size={14} />
            <span>Analyze BOQ</span>
          </button>
          <button onClick={() => navigate('conceptual-estimate')} className="btn-secondary" style={{ fontSize: '0.78rem', padding: '7px 12px' }}>
            <Sparkles size={14} />
            <span>Conceptual Estimate</span>
          </button>
        </div>
      </div>

      {/* Row 1 -- Primary Portfolio Performance */}
      <div>
        <div style={{ fontSize: '0.69rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Primary Portfolio Performance
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <StatCard
            title="Total Billed to Date"
            value={totalBilledT.toFixed(1)}
            unit="tCO₂e"
            subtitle="Sum of every tracked project's latest cumulative bill"
            accent="cyan"
          />
          <StatCard
            title="Portfolio Baseline Target"
            value={totalBaselineT.toFixed(1)}
            unit="tCO₂e"
            subtitle="Sum of every tracked project's recorded baseline"
            accent="amber"
            badge="Fixed"
            badgeType="amber"
          />
          <StatCard
            title="Projected Final Carbon"
            value={totalProjectedT.toFixed(1)}
            unit="tCO₂e"
            subtitle={portfolioVariancePct !== null ? `${portfolioVariancePct > 0 ? '+' : ''}${portfolioVariancePct.toFixed(1)}% vs portfolio baseline` : 'No tracked projects yet'}
            accent="lime"
            icon={portfolioVariancePct && portfolioVariancePct > 0 ? TrendingUp : TrendingDown}
          />
          <StatCard
            title="Portfolio Deviation"
            value={portfolioVariancePct !== null ? `${portfolioVariancePct > 0 ? '+' : ''}${portfolioVariancePct.toFixed(1)}%` : '--'}
            subtitle={portfolioVariancePct !== null ? (portfolioVariancePct > 0 ? 'Exceeding target' : 'Within target') : 'No data yet'}
            accent={portfolioVariancePct && portfolioVariancePct > 0 ? 'amber' : 'lime'}
            badge={portfolioVariancePct && portfolioVariancePct > 0 ? 'Above Baseline' : 'On Track'}
            badgeType={portfolioVariancePct && portfolioVariancePct > 0 ? 'amber' : 'lime'}
          />
        </div>
      </div>

      {/* Row 2 -- Operational Metrics */}
      <div>
        <div style={{ fontSize: '0.69rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Operational Metrics
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <StatCard
            title="Portfolio Carbon Intensity"
            value={portfolioIntensity !== null ? Math.round(portfolioIntensity) : '--'}
            unit={portfolioIntensity !== null ? 'kgCO₂e/m²' : ''}
            subtitle={totalFloorArea > 0 ? `Across ${Math.round(totalFloorArea).toLocaleString()} m² gross floor area` : 'No floor area recorded yet'}
            accent="mint"
            icon={Gauge}
          />
          <StatCard
            title="Active Monitored Projects"
            value={tracked.length}
            subtitle={`${untrackedCount} without a baseline yet`}
            accent="mint"
            badge="Baseline Recorded"
            badgeType="mint"
            icon={Building2}
          />
          <StatCard
            title="Exceeding Baseline"
            value={exceedingCount}
            subtitle={`of ${tracked.length} tracked projects`}
            accent={exceedingCount > 0 ? 'amber' : 'cyan'}
            badge={exceedingCount > 0 ? 'Needs Attention' : 'All Clear'}
            badgeType={exceedingCount > 0 ? 'amber' : 'cyan'}
          />
          <StatCard
            title="Largest Portfolio Contributor"
            value={largestPortfolioCategory ? categoryLabel(largestPortfolioCategory.category) : '--'}
            subtitle={largestPortfolioCategory ? `${(largestPortfolioCategory.total / 1000).toFixed(1)} tCO₂e across the portfolio` : 'No material breakdown available yet'}
            accent="cyan"
          />
        </div>
      </div>

      {/* Chart section */}
      <div className="glass-panel" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {chartMode === 'comparison' ? 'Project Carbon Benchmarking' : 'Portfolio Material Distribution'}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {chartMode === 'comparison'
                ? 'Baseline vs. billed-to-date vs. projected, across every tracked project'
                : 'Embodied carbon by material category, summed across every tracked project'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 2, padding: 3, background: 'rgba(var(--c-overlay),0.05)', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setChartMode('comparison')}
              className="btn-secondary"
              style={{ fontSize: '0.74rem', padding: '6px 11px', border: 'none', ...(chartMode === 'comparison' ? { background: 'var(--glass-bg)', color: 'var(--text-primary)', fontWeight: 700 } : { background: 'transparent' }) }}
            >
              <BarChart3 size={13} />
              <span>Comparison</span>
            </button>
            <button
              onClick={() => setChartMode('distribution')}
              className="btn-secondary"
              style={{ fontSize: '0.74rem', padding: '6px 11px', border: 'none', ...(chartMode === 'distribution' ? { background: 'var(--glass-bg)', color: 'var(--text-primary)', fontWeight: 700 } : { background: 'transparent' }) }}
            >
              <PieChartIcon size={13} />
              <span>Distribution</span>
            </button>
          </div>
        </div>

        <div style={{ height: 320 }}>
          {tracked.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No tracked projects with a recorded baseline yet.
            </div>
          ) : chartMode === 'comparison' ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonChartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--c-overlay),0.08)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} unit=" t" />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                  formatter={(val) => [`${Number(val).toLocaleString()} tCO₂e`]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                <Bar dataKey="baseline" name="Baseline Target" fill={SERIES_COLORS.baseline} radius={[4, 4, 0, 0]} />
                <Bar dataKey="billed" name="Billed to Date" fill={SERIES_COLORS.billed} radius={[4, 4, 0, 0]} />
                <Bar dataKey="projected" name="Projected" fill={SERIES_COLORS.projected} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : portfolioCategoryTotals.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No category breakdown available yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={portfolioCategoryTotals} cx="50%" cy="50%" innerRadius={65} outerRadius={95} paddingAngle={3} dataKey="total">
                    {portfolioCategoryTotals.map((entry) => (
                      <Cell key={entry.category} fill={categoryColor(entry.category)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                    formatter={(val, _name, item) => [`${(val / 1000).toFixed(1)} tCO₂e`, categoryLabel(item.payload.category)]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px' }}>
                {portfolioCategoryTotals.map((c) => (
                  <div key={c.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: categoryColor(c.category), flexShrink: 0 }} />
                      {categoryLabel(c.category)}
                    </span>
                    <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{(c.total / 1000).toFixed(1)} t</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>All Projects</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} color="var(--text-muted)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Filter projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 28, fontSize: '0.75rem', padding: '6px 10px 6px 28px', width: 180 }}
              />
            </div>
            <select value={archetypeFilter} onChange={(e) => setArchetypeFilter(e.target.value)} className="form-select" style={{ fontSize: '0.75rem', padding: '6px 8px' }}>
              <option value="all">All Archetypes</option>
              {ARCHETYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-select" style={{ fontSize: '0.75rem', padding: '6px 8px' }}>
              {STATUS_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => toggleSort(opt.key)}
                  className="btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '5px 10px', ...(sortKey === opt.key ? { borderColor: 'var(--accent-lime)', color: 'var(--accent-lime)' } : {}) }}
                >
                  <span>{opt.label}</span>
                  {sortKey === opt.key && <ArrowUpDown size={11} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {projectsLoading ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading projects…</p>
        ) : sortedRows.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No projects match these filters.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedRows.map((r) => {
              const p = r.project
              const hasDash = !!r.dashboard
              const exceeding = r.variancePct !== null && r.variancePct > 0
              return (
                <div
                  key={p.project_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '12px 16px',
                    background: 'rgba(var(--c-surf-2), 0.6)',
                    border: '1px solid rgba(var(--c-blue), 0.12)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <button
                    onClick={() => openProject(p.project_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1.4, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    <Building2 size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.project_name || p.project_id}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {p.location || (hasDash ? `${r.dashboard.baseline.is_estimated ? 'Estimated' : r.dashboard.baseline.source_type.toUpperCase()} baseline` : p.has_baseline ? 'Baseline recorded' : 'No baseline yet')}
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setEditingProject(p.project_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 150, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                    title="Edit archetype / stage / location"
                  >
                    <div>
                      <div style={{ fontSize: '0.78rem', color: p.archetype ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {p.archetype || 'Set archetype'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{p.construction_stage || '--'}</div>
                    </div>
                    <Pencil size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right', minWidth: 68 }}>
                      <div className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.completionPct !== null ? `${r.completionPct.toFixed(0)}%` : '--'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>complete</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 72 }}>
                      <div className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.baselineT !== null ? r.baselineT.toFixed(1) : '--'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>baseline t</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 72 }}>
                      <div className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.billedT !== null ? r.billedT.toFixed(1) : '--'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>billed t</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 72 }}>
                      <div className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.projectedT !== null ? r.projectedT.toFixed(1) : '--'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>projected t</div>
                    </div>
                    <div style={{ minWidth: 86, textAlign: 'right' }}>
                      {r.variancePct !== null ? (
                        <span className={`badge ${exceeding ? 'badge-amber' : 'badge-lime'}`} style={{ fontSize: '0.7rem' }}>
                          {exceeding ? '+' : ''}{r.variancePct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>No data</span>
                      )}
                    </div>
                    <div style={{ minWidth: 110, fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                      {r.largestCategory ? categoryLabel(r.largestCategory.category) : '--'}
                    </div>
                    <button onClick={() => openProject(p.project_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <ChevronRight size={16} color="var(--text-muted)" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ProjectProfileModal
        isOpen={!!editingProject}
        onClose={() => setEditingProject(null)}
        projectId={editingProject}
        initialProfile={editingRow ? { archetype: editingRow.project.archetype, construction_stage: editingRow.project.construction_stage, location: editingRow.project.location } : {}}
        onSaved={() => loadProjects(activeCompanyId)}
      />
    </div>
  )
}
