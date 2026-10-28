import React, { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard,
  Building2,
  Calculator,
  FileSpreadsheet,
  TrendingDown,
  FileText,
  Tags,
  Sliders,
  Flame,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Search,
  ChevronsLeft,
  ChevronsRight,
  Building,
} from 'lucide-react'
import { useProject } from '../../context/ProjectContext'
import { useTheme } from '../../context/ThemeContext'
import ToastContainer from '../common/Toast'

// Workspace-level navigation -- mirrors the source design's AppLayout.tsx
// nav structure 1:1 (same view ids, same grouping), plus one addition:
// 'operational-emissions', a real, working feature in the current app
// that the source design never built a screen for at all (see the
// mapping-review spreadsheet's "Build the frontend for this" row).
const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'project', label: 'Projects & Detail', icon: Building2 },
  { id: 'conceptual-estimate', label: 'Conceptual Estimate', icon: Calculator },
  { id: 'analyze-boq', label: 'Analyze a BOQ', icon: FileSpreadsheet },
  { id: 'tracking', label: 'Carbon Tracking', icon: TrendingDown },
  { id: 'reports', label: 'Reports & Audits', icon: FileText },
  { id: 'operational-emissions', label: 'Operational Emissions', icon: Flame },
]

const ADMIN_ITEMS = [
  { id: 'mapping', label: 'Material Mapping', icon: Tags },
  { id: 'settings', label: 'Emission Factors & Settings', icon: Sliders },
]

const BREADCRUMB_LABEL = {
  overview: 'Portfolio Overview',
  project: 'Projects Directory',
  'conceptual-estimate': 'Conceptual Carbon Estimate',
  'analyze-boq': 'Analyze a BOQ',
  'job-dashboard': 'Upload Result Dashboard',
  tracking: 'Carbon Milestones Tracking',
  reports: 'Reports & Audits',
  mapping: 'Material Mapping Queue',
  settings: 'Emission Factors & Settings',
  'operational-emissions': 'Operational Emissions (Scope 1 & 2)',
}

export default function AppShell({ currentView, setCurrentView, children }) {
  const { companies, activeCompanyId, selectCompany, isBackendOnline } = useProject()
  const { theme, setTheme } = useTheme()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false)
  const workspaceRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (workspaceRef.current && !workspaceRef.current.contains(e.target)) {
        setWorkspaceDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const activeCompany = companies.find((c) => c.company_id === activeCompanyId)

  function renderNavItem(item) {
    const Icon = item.icon
    const isActive = currentView === item.id
    return (
      <button
        key={item.id}
        onClick={() => setCurrentView(item.id)}
        title={sidebarCollapsed ? item.label : undefined}
        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
      >
        <div className="sidebar-nav-item-content">
          <Icon size={16} />
          {!sidebarCollapsed && <span>{item.label}</span>}
        </div>
      </button>
    )
  }

  return (
    <div className="shell">
      <ToastContainer />

      <div className="shell-body">
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark" onClick={() => setCurrentView('overview')}>
              <div className="sidebar-brand-icon">S</div>
              {!sidebarCollapsed && (
                <div className="sidebar-brand-text">
                  <span className="sidebar-brand-title">Sima CarbonOS</span>
                  <span className="sidebar-brand-subtitle">Embodied Carbon</span>
                </div>
              )}
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </button>
          </div>

          <nav className="sidebar-nav">
            <div>
              {!sidebarCollapsed && <div className="sidebar-nav-group-label">Workspace</div>}
              <div className="sidebar-nav-list">{NAV_ITEMS.map(renderNavItem)}</div>
            </div>
            <div>
              {!sidebarCollapsed && <div className="sidebar-nav-group-label">Administration</div>}
              <div className="sidebar-nav-list">{ADMIN_ITEMS.map(renderNavItem)}</div>
            </div>
          </nav>

          <div className="sidebar-footer">
            {!sidebarCollapsed ? (
              <>
                <div style={{ position: 'relative' }} ref={workspaceRef}>
                  <button
                    onClick={() => setWorkspaceDropdownOpen((v) => !v)}
                    className="btn-secondary"
                    style={{ width: '100%', justifyContent: 'space-between', fontWeight: 400 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Building size={14} color="var(--brand-primary)" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem', fontWeight: 600 }}>
                        {activeCompany?.display_name || 'Select company'}
                      </span>
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {workspaceDropdownOpen && (
                    <div
                      className="glass-panel"
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        marginBottom: 4,
                        width: '100%',
                        padding: 6,
                        zIndex: 50,
                      }}
                    >
                      <div style={{ padding: '4px 8px', fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Switch Company
                      </div>
                      {companies.map((c) => (
                        <button
                          key={c.company_id}
                          onClick={() => {
                            selectCompany(c.company_id)
                            setWorkspaceDropdownOpen(false)
                          }}
                          className="sidebar-nav-item"
                          style={{ width: '100%' }}
                        >
                          <div className="sidebar-nav-item-content">
                            <span>{c.company_id === activeCompanyId ? '✓ ' : ''}{c.display_name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sidebar-footer-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isBackendOnline ? 'var(--color-success)' : 'var(--color-danger)',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                      {isBackendOnline ? 'Backend online' : 'Backend offline'}
                    </span>
                  </div>

                  <div className="theme-switch">
                    <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} title="Light theme">
                      <Sun size={13} />
                    </button>
                    <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} title="Dark theme">
                      <Moon size={13} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className="sidebar-collapse-btn"
                style={{ margin: '0 auto' }}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            )}
          </div>
        </aside>

        <div className="shell-main">
          <header className="topbar">
            <div className="breadcrumb">
              <button className="breadcrumb-link" onClick={() => setCurrentView('overview')}>Portfolio</button>
              <ChevronRight size={12} color="var(--text-muted)" />
              <span className="breadcrumb-current">{BREADCRUMB_LABEL[currentView] || ''}</span>
            </div>

            <div className="topbar-actions">
              <div className="theme-switch">
                <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
                  <Sun size={13} /> Light
                </button>
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
                  <Moon size={13} /> Dark
                </button>
              </div>
            </div>
          </header>

          <main className="shell-canvas">
            <div className="shell-canvas-inner animate-fade-in">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
