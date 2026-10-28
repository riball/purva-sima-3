import React, { useState } from 'react'
import { Building2, ChevronDown, Activity, Layers, FileSpreadsheet, LineChart, SlidersHorizontal, Database, X, Globe, Building, Flame } from 'lucide-react'
import { useProject } from '../../context/ProjectContext'
import { motion, AnimatePresence } from 'framer-motion'

export default function Navbar({ activeTab, setActiveTab, isOpen, onClose }) {
  const {
    companies,
    activeCompanyId,
    selectCompany,
    createCompany,
    projects,
    activeProjectId,
    isBackendOnline,
  } = useProject()

  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyId, setNewCompanyId] = useState('')
  const [isSubmittingCompany, setIsSubmittingCompany] = useState(false)

  const handleCreateCompanySubmit = async (e) => {
    e.preventDefault()
    if (!newCompanyName.trim()) return
    setIsSubmittingCompany(true)
    try {
      await createCompany(newCompanyName.trim(), newCompanyId.trim() || null)
      setNewCompanyName('')
      setNewCompanyId('')
      setShowCompanyModal(false)
    } finally {
      setIsSubmittingCompany(false)
    }
  }

  const activeProject = projects.find((p) => p.project_id === activeProjectId)

  // UX refinement (Phase F): Phase 3 (tracking/chat) and Phase 5 (COP-PDF
  // reconciliation) are now one merged hub (TrackingChatHub) -- both old
  // nav slots are gone in favor of one "Tracking & Chat" item. App.jsx
  // still routes BOTH the 'phase3' and 'phase5' tab ids to that same hub
  // component, so any code (or muscle memory) still reaching for either
  // old id keeps working -- this list just no longer offers 'phase5' as
  // a separate destination to click into.
  //
  // "Operational Emissions" (opex) is a new, deliberately standalone tab
  // -- Scope 1 & 2 (site fuel + grid electricity), a different GHG
  // Protocol category from every other tab here, which is all embodied
  // carbon in materials. See app/services/operational_emissions.py's
  // docstring for why it's kept separate rather than folded into an
  // existing phase.
  const navItems = [
    { id: 'landing', label: 'Home', icon: Activity },
    { id: 'overview', label: 'Hub & Projects', icon: Layers },
    { id: 'phase1', label: 'Conceptual Estimate', icon: Building2 },
    { id: 'phase2', label: 'Upload BOQ / Work Order', icon: FileSpreadsheet },
    { id: 'phase3', label: 'Tracking & Chat', icon: LineChart },
    { id: 'phase4', label: 'Swaps & Audit', icon: SlidersHorizontal },
    { id: 'opex', label: 'Operational Emissions', icon: Flame },
    { id: 'factors', label: 'Factors & Data', icon: Database },
  ]

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: '280px',
              background: 'var(--glass-bg-elevated)',
              borderRight: '1px solid var(--glass-border)',
              zIndex: 1001,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '20px 0 50px rgba(var(--c-black),0.3)',
              backdropFilter: 'blur(20px)',
            }}
          >
            {/* Navigation Links */}
            <nav style={{ padding: '24px 12px', flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px 20px 12px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Main Menu
                </div>
                <button 
                  onClick={onClose} 
                  style={{ 
                    background: 'rgba(var(--c-overlay),0.05)', 
                    border: '1px solid rgba(var(--c-overlay),0.1)', 
                    color: 'var(--text-primary)', 
                    cursor: 'pointer', 
                    fontSize: '0.65rem',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontWeight: 600
                  }}
                >
                  CLOSE
                </button>
              </div>
              {navItems.map((item) => {
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id)
                      onClose()
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      padding: '14px 18px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.8rem',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: isActive ? 'var(--accent-lime)' : 'rgba(var(--c-overlay), 0.04)',
                      color: isActive ? '#000' : 'var(--text-secondary)',
                      border: isActive ? 'none' : '1px solid rgba(var(--c-overlay), 0.1)',
                      marginBottom: 10,
                      textAlign: 'left',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      boxShadow: isActive ? '0 4px 12px rgba(var(--c-lime-green), 0.3)' : 'none',
                    }}
                  >
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>

            {/* Sidebar Footer (Controls) */}
            <div style={{ padding: '20px', borderTop: '1px solid var(--glass-border)', background: 'rgba(var(--c-black),0.1)' }}>
              {/* Company Selector */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Company</label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={activeCompanyId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowCompanyModal(true)
                      } else {
                        selectCompany(e.target.value)
                      }
                    }}
                    className="form-select"
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.85rem',
                      background: 'var(--bg-tertiary)',
                      borderColor: 'var(--glass-border)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {companies.map((c) => (
                      <option key={c.company_id} value={c.company_id} style={{ background: 'var(--bg-secondary)' }}>
                        {c.display_name}
                      </option>
                    ))}
                    <option value="__new__" style={{ background: 'var(--bg-secondary)', color: 'var(--accent-lime)' }}>
                      + New Company...
                    </option>
                  </select>
                </div>
              </div>

              {/* Status Section */}
              <div style={{ 
                padding: '12px', 
                borderRadius: 'var(--radius-md)', 
                background: isBackendOnline ? 'rgba(var(--c-blue), 0.05)' : 'rgba(var(--c-rose), 0.05)',
                border: `1px solid ${isBackendOnline ? 'rgba(var(--c-blue), 0.1)' : 'rgba(var(--c-rose), 0.1)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isBackendOnline ? 'var(--accent-lime)' : 'var(--accent-rose)',
                  boxShadow: isBackendOnline ? '0 0 10px var(--accent-lime)' : 'none'
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {isBackendOnline ? 'API Stable' : 'API Offline'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {isBackendOnline ? 'Real-time compute on' : 'Attempting reconnect...'}
                  </div>
                </div>
                <Globe size={14} color="var(--text-dim)" />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* New Company Modal */}
      {showCompanyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(var(--c-black), 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 440, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              Register Enterprise Company
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Each company maintains its own project directory, calibrated item-code vocabulary, and historical baselines.
            </p>

            <form onSubmit={handleCreateCompanySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Company Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Provident Housing, Lodha Group"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="form-input"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Company ID Slug <span className="form-label-optional">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. provident, lodha (auto-generated if blank)"
                  value={newCompanyId}
                  onChange={(e) => setNewCompanyId(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(false)}
                  className="btn-secondary"
                  disabled={isSubmittingCompany}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmittingCompany || !newCompanyName.trim()}>
                  {isSubmittingCompany ? 'Registering...' : 'Register Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}