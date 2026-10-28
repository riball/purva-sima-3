import React, { useState, useEffect } from 'react'
import { ProjectProvider, useProject } from './context/ProjectContext'
import AppShell from './components/layout/AppShell'
import PlaceholderView from './components/common/PlaceholderView'
import ProjectDashboard from './components/project/ProjectDashboard'
import ProjectDirectory from './components/project/ProjectDirectory'
import PortfolioOverview from './components/portfolio/PortfolioOverview'
import ConceptualEstimatePage from './components/phase1/ConceptualEstimatePage'
import Phase2View from './components/phase2/Phase2View'
import JobDashboardPage from './components/phase2/JobDashboardPage'
import MaterialMappingQueue from './components/mapping/MaterialMappingQueue'
import FactorsView from './components/factors/FactorsView'
import ReportsView from './components/reports/ReportsView'
import OperationalEmissionsView from './components/opex/OperationalEmissionsView'

// Single-view-state navigation, same mechanism as the old app (no router)
// -- just renamed from `activeTab` to `currentView` and re-pointed at the
// Sima CarbonOS view-id set (see AppShell.jsx's NAV_ITEMS/ADMIN_ITEMS and
// the approved adaptation plan). Each placeholder below is replaced as
// its own build phase completes.
// 'project' and 'tracking' are two separate nav items in the Sima
// CarbonOS design (Projects & Detail / Carbon Tracking), but the real
// backend's data for them has always lived on one screen -- TrackingChatHub
// already merged Phase 3 (dashboard/baseline/chat) and Phase 5 (bill
// reconciliation) into a single real view earlier this session, per an
// explicit "merge tracking & chat" product decision. Phase 1 carried that
// same merge forward: both nav ids render the same real ProjectDashboard,
// rather than splitting one real feature across two placeholder screens
// just to match the mockup's nav count. As each further phase lands, its
// view id is added here and removed from PlaceholderView's fallback.
const VIEW_COMPONENTS = {
  overview: PortfolioOverview,
  // 'project' is now the Directory grid (the mockup's "Projects &
  // Embodied Carbon Directory") -- AppShell.jsx's own NAV_TITLES already
  // called this id 'Projects Directory' before any Directory existed to
  // render there, so this finally matches that label. Opening a card
  // navigates to the new 'project-dashboard' id below, which is where
  // ProjectDashboard itself now lives; 'tracking' still goes straight to
  // ProjectDashboard unchanged -- an existing, intentional shortcut that
  // bypasses the Directory, not something this rebuild was asked to touch.
  project: ProjectDirectory,
  'project-dashboard': ProjectDashboard,
  tracking: ProjectDashboard,
  // Conceptual Estimate rebuild: single-page layout matching the mockup
  // (3 numbered sections + a persistent live results panel) replaces the
  // old 5-step wizard here. Phase1Wizard.jsx and its step components are
  // left in place, untouched, simply no longer referenced by any view.
  'conceptual-estimate': ConceptualEstimatePage,
  'analyze-boq': Phase2View,
  'job-dashboard': JobDashboardPage,
  mapping: MaterialMappingQueue,
  settings: FactorsView,
  reports: ReportsView,
  'operational-emissions': OperationalEmissionsView,
}

const VIEWS = {
  overview: { title: 'Portfolio Overview', phase: 'Phase 2', description: 'Portfolio-wide KPIs and a sortable project list, aggregated client-side from real per-project data.' },
  project: { title: 'Projects & Embodied Carbon Directory', phase: 'Phase 1', description: 'Searchable card grid, one card per project -- opens the Project Dashboard below.' },
  'project-dashboard': { title: 'Project Dashboard', phase: 'Phase 1', description: 'Per-project Summary / Carbon Trends / Materials / Bills & Progress / Alternatives (Beta), wired to the real Phase 3 & 4 endpoints.' },
  'conceptual-estimate': { title: 'Conceptual Estimate', phase: 'Phase 3', description: 'The real Phase 1 tiered form and calculation, restyled -- only the fields the backend actually supports.' },
  'analyze-boq': { title: 'Analyze a BOQ', phase: 'Phase 4', description: 'Upload → Results, wired to the real BOQ/Work Order carbon-calculation endpoints.' },
  'job-dashboard': { title: 'Upload Result Dashboard', phase: 'Phase 4', description: 'Full-screen detail view for one BOQ/Work Order upload result -- reached from Analyze a BOQ\'s "View Dashboard" action.' },
  tracking: { title: 'Carbon Tracking', phase: 'Phase 1', description: 'Bill timeline and carbon trajectory, wired to the real Phase 3 dashboard/bills endpoints.' },
  reports: { title: 'Reports & Audits', phase: 'Phase 7', description: 'CSV export and a printable summary, built from real dashboard/bill/audit-log data.' },
  mapping: { title: 'Material Mapping Queue', phase: 'Phase 5', description: 'Company-scoped item-code classification review, wired to the real onboarding pipeline.' },
  settings: { title: 'Emission Factors & Settings', phase: 'Phase 6', description: 'The real versioned emission-factor history.' },
  'operational-emissions': { title: 'Operational Emissions', phase: 'Phase 9', description: 'Scope 1 & 2 calculator -- a real, working backend feature with no screen in the original design.' },
}

function AppContent() {
  const [currentView, setCurrentView] = useState('overview')
  const { registerNavigate } = useProject()

  useEffect(() => {
    registerNavigate(setCurrentView)
  }, [registerNavigate])

  const view = VIEWS[currentView] || VIEWS.overview
  const ViewComponent = VIEW_COMPONENTS[currentView]

  return (
    <AppShell currentView={currentView} setCurrentView={setCurrentView}>
      {ViewComponent ? (
        <ViewComponent />
      ) : (
        <PlaceholderView title={view.title} phase={view.phase} description={view.description} />
      )}
    </AppShell>
  )
}

export default function App() {
  return (
    <ProjectProvider>
      <AppContent />
    </ProjectProvider>
  )
}
