import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ProjectProvider } from './context/ProjectContext'
import AppShell from './components/layout/AppShell'
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
const SwapSandboxPage = lazy(() => import('./components/project/SwapSandboxPage'))
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

/**
 * Real app routing (Phase C, Part C): "the webapp doesnt have a nice
 * structure... i want it to be like a polished webapp with real
 * functions and pages" -- this used to be one `currentView` string in
 * App.jsx's own useState, with a ProjectContext.navigate(viewId) ref
 * indirection standing in for a router (see git history / the approved
 * plan's Part 2C for the full before/after). Replaced with a real
 * react-router-dom BrowserRouter: every former view id is now a real
 * URL (see the path map in the approved plan), so the browser's own
 * Back/Forward/refresh/bookmark all work, same as any ordinary website.
 *
 * Landing ("/") keeps its old special case -- a full-screen hero with no
 * sidebar/top-bar chrome of its own -- expressed now as a route that's a
 * sibling of the layout route below, rather than an `if` checked before
 * AppShell was rendered at all. Portfolio Overview ("/portfolio") is the
 * confirmed real home for everything else: the sidebar brand-mark, the
 * breadcrumb's "Portfolio" link, and the catch-all for an unknown path
 * all resolve there (see AppShell.jsx).
 */
function AppShellLayout() {
  return (
    <AppShell>
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>}>
        <Outlet />
      </Suspense>
    </AppShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      {/* ProjectProvider is rendered INSIDE the router (not the other way
          around) because it now calls react-router-dom's own
          useNavigate() directly for its background-job-finished toast
          action -- see ProjectContext.jsx's own comment on why the old
          navigateRef/registerNavigate indirection was removed. */}
      <ProjectProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route element={<AppShellLayout />}>
            <Route path="/portfolio" element={<PortfolioOverview />} />
            <Route path="/projects" element={<ProjectDirectory />} />
            <Route path="/projects/:projectId" element={<ProjectDashboard />} />
            <Route path="/projects/:projectId/swap-sandbox" element={<SwapSandboxPage />} />
            <Route path="/conceptual-estimate" element={<ConceptualEstimatePage />} />
            <Route path="/analyze-boq" element={<Phase2View />} />
            <Route path="/uploads/:jobId" element={<JobDashboardPage />} />
            <Route path="/tracking" element={<CarbonTrackingPage />} />
            <Route path="/reports" element={<ReportsView />} />
            <Route path="/mapping" element={<MaterialMappingQueue />} />
            <Route path="/settings" element={<FactorsView />} />
            <Route path="/operational-emissions" element={<OperationalEmissionsView />} />
            {/* Unknown path under the app shell -- redirect to the real
                home instead of a blank screen. */}
            <Route path="*" element={<Navigate to="/portfolio" replace />} />
          </Route>
        </Routes>
      </ProjectProvider>
    </BrowserRouter>
  )
}
