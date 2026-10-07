import React, { useState, useEffect } from 'react'
import { ProjectProvider, useProject } from './context/ProjectContext'
import Navbar from './components/common/Navbar'
import ToastContainer from './components/common/Toast'
import ProjectsOverview from './components/overview/ProjectsOverview'
import LandingPage from './components/landing/LandingPage'
import Phase1Wizard from './components/phase1/Phase1Wizard'
import Phase2View from './components/phase2/Phase2View'
import Phase4View from './components/phase4/Phase4View'
import TrackingChatHub from './components/hub/TrackingChatHub'
import FactorsView from './components/factors/FactorsView'
import OperationalEmissionsView from './components/opex/OperationalEmissionsView'
import { Menu, X } from 'lucide-react'

function AppContent() {
  const [activeTab, setActiveTab] = useState('landing')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { registerNavigate } = useProject()

  // UX refinement: hands ProjectContext a way to switch tabs itself, so a
  // background-job-completion toast (fired from deep inside the context,
  // possibly while the user is on a totally different screen) can carry
  // a "View Results" action that actually navigates there.
  useEffect(() => {
    registerNavigate(setActiveTab)
  }, [registerNavigate])

  return (
    <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      {/* Floating Menu Button (Top Left) */}
      <div style={{
        position: 'fixed',
        top: '24px',
        left: '24px',
        zIndex: 1000,
      }}>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            transition: 'all 0.2s',
            boxShadow: 'var(--glass-shadow)',
          }}
          className="hover:scale-105 active:scale-95"
        >
          {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Floating Sidebar (Navigation) */}
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={(tab) => {
          setActiveTab(tab)
          setIsSidebarOpen(false)
        }} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Overlay */}
      {isSidebarOpen && (
        <div 
          onClick={() => setIsSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 998,
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* Main Content Area */}
      <main className="main-content" style={{ 
        marginTop: activeTab === 'landing' ? '0' : '80px',
        padding: activeTab === 'landing' ? '0' : '28px 24px 80px 24px',
        maxWidth: activeTab === 'landing' ? '100%' : '1400px'
      }}>
        {activeTab === 'landing' && <LandingPage onNavigate={(tab) => setActiveTab(tab)} />}
        {activeTab === 'overview' && <ProjectsOverview onNavigatePhase={(tab) => setActiveTab(tab)} />}
        {activeTab === 'phase1' && <Phase1Wizard />}
        {activeTab === 'phase2' && <Phase2View />}
        {/* UX refinement (Phase D): Phase 3 (tracking/chat) and Phase 5
            (COP-PDF reconciliation) are now one merged hub -- both old
            nav destinations route here until Phase F relabels the nav
            itself and retires the two standalone view files. */}
        {activeTab === 'phase3' && <TrackingChatHub />}
        {activeTab === 'phase4' && <Phase4View />}
        {activeTab === 'phase5' && <TrackingChatHub />}
        {/* New feature: Scope 1 & 2 operational emissions -- deliberately
            its own tab/component, not folded into any embodied-carbon
            phase above. See components/opex/OperationalEmissionsView.jsx. */}
        {activeTab === 'opex' && <OperationalEmissionsView />}
        {activeTab === 'factors' && <FactorsView />}
      </main>

      {/* Persistent Minimal Footer */}
      {activeTab !== 'landing' && (
        <footer
          style={{
            borderTop: '1px solid rgba(49, 130, 206, 0.1)',
            padding: '20px 24px',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: '#64748b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            maxWidth: 1400,
            margin: '0 auto',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Embodied Carbon Tracking (Phase 1–5)</span>
          </div>

          <span style={{ color: '#475569' }}>
            Every number is a real recompute against versioned emission factors. Never an LLM guess.
          </span>
        </footer>
      )}

      {/* Global Toast Alerts */}
      <ToastContainer />
    </div>
  )
}

export default function App() {
  return (
    <ProjectProvider>
      <AppContent />
    </ProjectProvider>
  )
}