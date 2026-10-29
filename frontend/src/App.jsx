import React, { useState, useEffect, Suspense, lazy } from 'react'
import { ProjectProvider, useProject } from './context/ProjectContext'
import AppShell from './components/layout/AppShell'
import PlaceholderView from './components/common/PlaceholderView'
import LandingPage from './components/landing/LandingPage'

// Performance fix: these 11 views used to be static imports, so Vite
// bundled every single one (plus everything they pull in -- recharts,
// framer-motion usage, etc.) into one ~1.08MB JS chunk that shipped on
// EVERY page load no matter which single view the user actually opened
// first. React.lazy() + dynamic import() tells Vite to give each of
// these its own chunk, fetched only the first time its view is opened --
// so "open the app, look at Portfolio Overview" now only has to download
// the Portfolio chunk (plus the small shared vendor chunk), not Reports,
// Factors, OperationalEmissions, etc. too. LandingPage stays a static
// import on purpose: it's the very first thing rendered, so lazy-loading
// it would just add a network round trip before the first paint instead
// of saving one.
const ProjectDashboard = lazy(() => import('./components/project/ProjectDashboard'))
const ProjectDirectory = lazy(() => import('./components/project/ProjectDirectory'))
const PortfolioOverview = lazy(() => import('./components/portfolio/PortfolioOverview'))
const ConceptualEstimatePage = lazy(() => import('./components/phase1/ConceptualEstimatePage'))
const Phase2View = lazy(() => import('./components/phase2/Phase2View'))
const JobDashboardPage = lazy(() => import('./components/phase2/JobDashboardPage'))
const CarbonTrackingPage = lazy(() => import('./components/tracking/CarbonTrackingPage'))
const MaterialMappingQueue = lazy(() => import('./components/mapping/MaterialMappingQueue'))
const FactorsView = lazy(() => import('./components/factors/FactorsView'))
const ReportsView = lazy(() => import('./components/reports/ReportsView'))
const OperationalEmissionsView = lazy(() => import('./components/opex/OperationalEmissionsView'))

// Single-view-state navigation, same mechanism as the old app (no router)
// -- just renamed from `activeTab` to `currentView` and re-pointed at the
// Sima CarbonOS view-id set (see AppShell.jsx's NAV_ITEMS/ADMIN_ITEMS and
// the approved adaptation plan). Each placeholder below is replaced as
// its own build phase completes.
// 'project' and 'tracking' are two separate nav items in the Sima
// CarbonOS design (Projects & Detail / Carbon Tracking). They used to
// render the same real ProjectDashboard component (an earlier "merge
// tracking & chat" product decision), but 'tracking' now has its own
// real, carbon-only view (CarbonTrackingPage) distinct from the full
// Project Dashboard -- see the approved plan for why. As each further
// phase lands, its view id is added here and removed from
// PlaceholderView's fallback.
const VIEW_COMPONENTS = {
  overview: PortfolioOverview,
  // 'project' is now the Directory grid (the mockup's "Projects &
  // Embodied Carbon Directory") -- AppShell.jsx's own NAV_TITLES already
  // called this id 'Projects Directory' before any Directory existed to
  // render there, so this finally matches that label. Opening a card
  // navigates to the new 'project-dashboard' id below, which is where
  // ProjectDashboard itself now lives.
  project: ProjectDirectory,
  'project-dashboard': ProjectDashboard,
  tracking: CarbonTrackingPage,
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
  tracking: { title: 'Carbon Tracking', phase: 'Phase 1', description: 'Carbon-only summary, trajectory, and material breakdown for a project, wired to the real Phase 3 dashboard/bills endpoints.' },
  reports: { title: 'Reports & Audits', phase: 'Phase 7', description: 'CSV export and a printable summary, built from real dashboard/bill/audit-log data.' },
  mapping: { title: 'Material Mapping Queue', phase: 'Phase 5', description: 'Company-scoped item-code classification review, wired to the real onboarding pipeline.' },
  settings: { title: 'Emission Factors & Settings', phase: 'Phase 6', description: 'The real versioned emission-factor history.' },
  'operational-emissions': { title: 'Operational Emissions', phase: 'Phase 9', description: 'Scope 1 & 2 calculator -- a real, working backend feature with no screen in the original design.' },
}

function AppContent() {
  // 'landing' is a real view id here, same as every other entry in
  // VIEW_COMPONENTS/VIEWS below, EXCEPT it's deliberately not registered
  // in either map and is checked for before AppShell is rendered at all --
  // LandingPage is a full-screen hero with no sidebar/top-bar chrome of
  // its own, so it can't live inside <AppShell> like every other view
  // does. It's a true front door: shown once, on first load, before
  // anything else -- navigating anywhere FROM it (both its own buttons
  // call onNavigate) leaves this state for good, there's no path back to
  // 'landing' once you're in the app (same as a marketing site's home
  // page vs. the product behind its "Sign in").
  const [currentView, setCurrentView] = useState('landing')
  const { registerNavigate } = useProject()

  useEffect(() => {
    registerNavigate(setCurrentView)
  }, [registerNavigate])

  if (currentView === 'landing') {
    return <LandingPage onNavigate={setCurrentView} />
  }

  const view = VIEWS[currentView] || VIEWS.overview
  const ViewComponent = VIEW_COMPONENTS[currentView]

  return (
    <AppShell currentView={currentView} setCurrentView={setCurrentView}>
      {ViewComponent ? (
        <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>}>
          <ViewComponent />
        </Suspense>
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
