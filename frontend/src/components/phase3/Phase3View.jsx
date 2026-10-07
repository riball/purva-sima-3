import React, { useState, useEffect, useRef } from 'react'
import { LineChart, MessageSquare, Plus, Clock, TrendingUp, AlertTriangle, Send, Sparkles, CheckCircle2, DollarSign, Building2, Upload } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import LineChartCarbon from '../common/charts/LineChartCarbon'

export default function Phase3View() {
  const { activeCompanyId, activeProjectId, projects, selectProject, addToast } = useProject()

  // Dashboard Data
  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false)

  // Baseline Form Modal
  const [showBaselineModal, setShowBaselineModal] = useState(false)
  const [baselineSourceType, setBaselineSourceType] = useState('phase1_estimate')
  const [baselineFile, setBaselineFile] = useState(null)
  const [baselineFloorArea, setBaselineFloorArea] = useState('25000')
  const [baselineFloorAreaBasis, setBaselineFloorAreaBasis] = useState('built_up_total')
  const [isRecordingBaseline, setIsRecordingBaseline] = useState(false)

  // Bill Logger Form Modal
  const [showBillModal, setShowBillModal] = useState(false)
  const [billPeriod, setBillPeriod] = useState('2026-Q1')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [billStatedPct, setBillStatedPct] = useState('')
  const [billFile, setBillFile] = useState(null)
  const [isLoggingBill, setIsLoggingBill] = useState(false)

  // Chatbot State
  const [chatTools, setChatTools] = useState({})
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isChatSending, setIsChatSending] = useState(false)
  const chatBottomRef = useRef(null)

  // Load Dashboard & Chat Tools
  useEffect(() => {
    if (!activeProjectId) return

    loadDashboardData()
    loadChatTools()
  }, [activeProjectId, activeCompanyId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const loadDashboardData = async () => {
    setIsLoadingDashboard(true)
    try {
      const dash = await api.getDashboard(activeProjectId, activeCompanyId)
      setDashboard(dash)
      const bList = await api.getBills(activeProjectId, activeCompanyId)
      setBills(bList)
    } catch (err) {
      console.log('No dashboard yet for project:', err.message)
      setDashboard(null)
    } finally {
      setIsLoadingDashboard(false)
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

  // Handle Record Baseline
  const handleRecordBaselineSubmit = async (e) => {
    e.preventDefault()
    if (baselineSourceType !== 'phase1_estimate' && !baselineFile) {
      addToast('Please select a BOQ or Work Order file', 'error')
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
      loadDashboardData()
    } catch (err) {
      addToast(`Failed to record baseline: ${err.message}`, 'error')
    } finally {
      setIsRecordingBaseline(false)
    }
  }

  // Handle Log Bill
  const handleLogBillSubmit = async (e) => {
    e.preventDefault()
    if (!billFile) {
      addToast('Please select a bill document (.xlsx / .pdf)', 'error')
      return
    }

    setIsLoggingBill(true)
    try {
      await api.logBill(activeProjectId, {
        companyId: activeCompanyId,
        period: billPeriod.trim(),
        billedDate: billDate,
        file: billFile,
        statedPercentComplete: billStatedPct ? Number(billStatedPct) : undefined,
      })
      addToast(`Logged bill period ${billPeriod}`, 'success')
      setShowBillModal(false)
      setBillFile(null)
      loadDashboardData()
    } catch (err) {
      addToast(`Failed to log bill: ${err.message}`, 'error')
    } finally {
      setIsLoggingBill(false)
    }
  }

  // Handle Chat Message
  const handleSendChat = async (questionText) => {
    const text = questionText || chatInput
    if (!text.trim()) return

    const userMsg = { id: Date.now(), sender: 'user', text }
    setChatMessages((prev) => [...prev, userMsg])
    if (!questionText) setChatInput('')

    setIsChatSending(true)
    try {
      const ans = await api.sendChatMessage(activeProjectId, text, activeCompanyId)
      const botMsg = { id: Date.now() + 1, sender: 'bot', data: ans }
      setChatMessages((prev) => [...prev, botMsg])
    } catch (err) {
      const errMsg = {
        id: Date.now() + 1,
        sender: 'bot',
        data: {
          answer_text: `Could not process question: ${err.message}. Make sure the project has a Phase 1 model record.`,
          error: err.message,
        },
      }
      setChatMessages((prev) => [...prev, errMsg])
    } finally {
      setIsChatSending(false)
    }
  }

  const activeProject = projects.find((p) => p.project_id === activeProjectId)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderLeft: '4px solid var(--accent-amber)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-amber">Phase 3</span>
            <span style={{ fontSize: '0.8125rem', color: '#fbbf24', fontWeight: 600 }}>
              Track Over Time & Assistant
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc' }}>
            Cumulative Bill Tracking & "What-If" Chatbot
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
            Measure construction reality against a fixed baseline. Bills are cumulative snapshots to date. Ask the assistant any
            hypothetical question for a real-engine recomputed answer.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowBaselineModal(true)}
            className="btn-secondary"
            style={{ fontSize: '0.8125rem' }}
          >
            <Clock size={15} />
            <span>{dashboard?.baseline ? 'Update Baseline' : 'Set Baseline'}</span>
          </button>

          {dashboard?.baseline && (
            <button
              onClick={() => setShowBillModal(true)}
              className="btn-primary"
              style={{ fontSize: '0.8125rem' }}
            >
              <Plus size={15} />
              <span>Log Period Bill</span>
            </button>
          )}
        </div>
      </div>

      {/* Baseline Status Banner */}
      {dashboard?.baseline ? (
        <div
          style={{
            background: 'rgba(12, 22, 16, 0.75)',
            border: '1px solid rgba(49, 130, 206, 0.16)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8125rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`badge ${dashboard.baseline.is_estimated ? 'badge-amber' : 'badge-mint'}`}>
              {dashboard.baseline.is_estimated ? 'Estimated Baseline' : `Priced Baseline (${dashboard.baseline.source_type.toUpperCase()})`}
            </span>
            <span style={{ color: '#f8fafc', fontWeight: 500 }}>
              Baseline: {(dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)} tCO₂e
            </span>
            <span style={{ color: '#64748b' }}>•</span>
            <span style={{ color: '#94a3b8' }}>
              Recorded {new Date(dashboard.baseline.recorded_at).toLocaleDateString()} from {dashboard.baseline.source_file}
            </span>
          </div>

          <span style={{ fontSize: '0.75rem', color: '#3182CE' }}>
            {bills.length} {bills.length === 1 ? 'Period Bill' : 'Period Bills'} Logged
          </span>
        </div>
      ) : (
        <div
          className="glass-panel"
          style={{
            padding: 30,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <AlertTriangle size={32} color="#f59e0b" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc' }}>
            No Fixed Baseline Recorded Yet
          </h3>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: 440 }}>
            Before you can log cumulative bills and track running carbon, record this project’s initial full-scope baseline.
          </p>
          <button onClick={() => setShowBaselineModal(true)} className="btn-primary" style={{ marginTop: 6 }}>
            Set Project Baseline
          </button>
        </div>
      )}

      {/* Main Grid: Dashboard KPIs & Progress (Left) + Assistant Chatbot (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(500px, 1.2fr) minmax(420px, 1fr)', gap: 24, alignItems: 'start' }}>
        
        {/* Left Column: Tracking Dashboard */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {dashboard?.baseline && (
            <>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <StatCard
                  title="Billed to Date"
                  value={dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0'}
                  unit="tCO₂e"
                  subtitle={`Latest period: ${dashboard.latest_period || 'None yet'}`}
                  accent="amber"
                  badge={dashboard.latest_period ? 'Cumulative' : 'Pending'}
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

              {/* Benchmark Comparison Card */}
              {dashboard.benchmark_available && (
                <div className="glass-panel" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8' }}>
                      Typical Building Benchmark
                    </span>
                    <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                      {dashboard.benchmark_floor_band_used}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="tabular-nums" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
                      {dashboard.projected_carbon_per_sqm?.toFixed(1) || '-'}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: '#3182CE' }}>kgCO₂e / m²</span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      (Typical is {dashboard.typical_carbon_per_sqm?.toFixed(1)} kg/m²)
                    </span>
                  </div>
                </div>
              )}

              {/* Time Series Chart + Table */}
              <div className="glass-panel" style={{ padding: 22 }}>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc', marginBottom: 14 }}>
                  Cumulative Billing Time Series
                </h3>

                {dashboard.points && dashboard.points.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <LineChartCarbon points={dashboard.points} baselineTonnes={dashboard.baseline.total_gwp_kg_co2e / 1000} />
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.72rem', color: '#94a3b8' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, height: 2, background: '#3182CE', display: 'inline-block', borderRadius: 2 }} />
                        Billed cumulative
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, height: 0, borderTop: '2px dashed #f59e0b', display: 'inline-block' }} />
                        Baseline
                      </span>
                    </div>
                  </div>
                )}

                {dashboard.points && dashboard.points.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(49, 130, 206, 0.15)', color: '#3182CE', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          <th style={{ padding: '8px 12px' }}>Period</th>
                          <th style={{ padding: '8px 12px' }}>Billed Date</th>
                          <th style={{ padding: '8px 12px' }}>GWP to Date (tCO₂e)</th>
                          <th style={{ padding: '8px 12px' }}>Billed Value</th>
                          <th style={{ padding: '8px 12px' }}>% Complete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.points.map((pt, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.8125rem' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>
                              {pt.period}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                              {pt.billed_date}
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: '#3182CE', fontWeight: 600 }}>
                              {(pt.total_gwp_kg_co2e_to_date / 1000).toFixed(1)}
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                              ₹{(pt.total_value_to_date / 100000).toFixed(1)}L
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: '#3182CE' }}>
                              {pt.stated_percent_complete ? `${pt.stated_percent_complete.toFixed(1)}%` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                    No periodic bills logged yet. Click "Log Period Bill" above to record the first period snapshot.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Column: Assistant Chatbot ("What If...?") */}
        <div
          className="glass-panel"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            height: '680px',
            background: 'rgba(12, 22, 15, 0.95)',
          }}
        >
          {/* Chat Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid rgba(49, 130, 206, 0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(49, 130, 206, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#3182CE',
                }}
              >
                <Sparkles size={16} />
              </div>
              <div>
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc' }}>
                  Analyzer Assistant
                </h4>
                <span style={{ fontSize: '0.7rem', color: '#3182CE' }}>
                  Deterministic recomputes • Never a guessed delta
                </span>
              </div>
            </div>

            <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
              8 Verified Tools
            </span>
          </div>

          {/* Quick Suggestion Chips from Tool Catalog */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {Object.entries(chatTools).slice(0, 4).map(([toolName, info]) => (
              <button
                key={toolName}
                onClick={() => handleSendChat(info.example_question)}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(49, 130, 206, 0.18)',
                  borderRadius: 'var(--radius-full)',
                  padding: '4px 10px',
                  fontSize: '0.7rem',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-lime)'
                  e.currentTarget.style.color = '#3182CE'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(49, 130, 206, 0.18)'
                  e.currentTarget.style.color = '#cbd5e1'
                }}
              >
                {info.example_question}
              </button>
            ))}
          </div>

          {/* Chat Messages Log */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              paddingRight: 6,
              marginBottom: 14,
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                Ask questions like:<br />
                <strong style={{ color: '#3182CE' }}>"What if I use M40 instead of M30?"</strong> or<br />
                <strong style={{ color: '#3182CE' }}>"How much carbon does steel contribute?"</strong>
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isUser = msg.sender === 'user'

                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      background: isUser ? 'rgba(49, 130, 206, 0.14)' : 'rgba(18, 30, 22, 0.9)',
                      border: `1px solid ${isUser ? 'rgba(49, 130, 206, 0.3)' : 'rgba(49, 130, 206, 0.15)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.8125rem',
                      lineHeight: 1.45,
                    }}
                  >
                    {isUser ? (
                      msg.text
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* Tool Call Provenance Pill */}
                        {msg.data?.tool_call?.tool && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>
                              Tool: {msg.data.tool_call.tool}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                              Parsed via {msg.data.tool_call.parse_source}
                            </span>
                          </div>
                        )}

                        {/* Answer Narration */}
                        <div>{msg.data?.answer_text}</div>

                        {/* Calculated Deltas if Swap */}
                        {msg.data?.savings_pct !== null && msg.data?.savings_pct !== undefined && (
                          <div
                            style={{
                              marginTop: 6,
                              paddingTop: 6,
                              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '0.75rem',
                              color: '#3182CE',
                              fontWeight: 600,
                            }}
                          >
                            <span>Impact:</span>
                            <span>
                              {msg.data.savings_pct > 0 ? `-${msg.data.savings_pct.toFixed(1)}% savings` : `${Math.abs(msg.data.savings_pct).toFixed(1)}% increase`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendChat()
            }}
            style={{ display: 'flex', gap: 8 }}
          >
            <input
              type="text"
              placeholder="Ask a what-if question..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="form-input"
              disabled={isChatSending}
              style={{ fontSize: '0.8125rem' }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={isChatSending || !chatInput.trim()}
              style={{ padding: '0 16px' }}
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      </div>

      {/* Record Baseline Modal */}
      {showBaselineModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
              Set Project Baseline
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 18 }}>
              This recorded baseline serves as the permanent benchmark point every subsequent periodic bill is measured against.
            </p>

            <form onSubmit={handleRecordBaselineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Baseline Source Type</label>
                <select
                  value={baselineSourceType}
                  onChange={(e) => setBaselineSourceType(e.target.value)}
                  className="form-select"
                >
                  <option value="phase1_estimate">Existing Phase 1 Concept Estimate</option>
                  <option value="boq">Uploaded Bill of Quantities (.xlsx)</option>
                  <option value="wo">Uploaded Work Order (.pdf)</option>
                </select>
              </div>

              {baselineSourceType !== 'phase1_estimate' && (
                <div
                  style={{
                    border: '2px dashed rgba(49, 130, 206, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: 20,
                    textAlign: 'center',
                    background: 'rgba(9, 16, 11, 0.6)',
                  }}
                >
                  <input
                    type="file"
                    id="baseline-file-input"
                    accept={baselineSourceType === 'boq' ? '.xlsx,.xls' : '.pdf'}
                    style={{ display: 'none' }}
                    onChange={(e) => setBaselineFile(e.target.files[0] || null)}
                  />
                  <label
                    htmlFor="baseline-file-input"
                    style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  >
                    <Upload size={20} color="var(--accent-lime)" />
                    <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#f8fafc' }}>
                      {baselineFile ? baselineFile.name : `Select ${baselineSourceType.toUpperCase()} file`}
                    </span>
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowBaselineModal(false)}
                  className="btn-secondary"
                  disabled={isRecordingBaseline}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isRecordingBaseline}>
                  {isRecordingBaseline ? 'Recording...' : 'Record Baseline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Bill Modal */}
      {showBillModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
              Log Cumulative Billing Period
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 18 }}>
              Each bill represents cumulative progress to date. It is evaluated against the baseline, never summed across periods.
            </p>

            <form onSubmit={handleLogBillSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Period Label</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 2026-Q1, M03-2026"
                    value={billPeriod}
                    onChange={(e) => setBillPeriod(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Billed Date</label>
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

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

              <div
                style={{
                  border: '2px dashed rgba(49, 130, 206, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: 20,
                  textAlign: 'center',
                  background: 'rgba(9, 16, 11, 0.6)',
                }}
              >
                <input
                  type="file"
                  id="bill-file-input"
                  accept=".xlsx,.xls,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBillFile(e.target.files[0] || null)}
                />
                <label
                  htmlFor="bill-file-input"
                  style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                >
                  <Upload size={20} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#f8fafc' }}>
                    {billFile ? billFile.name : 'Select Bill Document (.xlsx or .pdf)'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowBillModal(false)}
                  className="btn-secondary"
                  disabled={isLoggingBill}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isLoggingBill || !billFile}>
                  {isLoggingBill ? 'Logging Bill...' : 'Log Bill Period'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
