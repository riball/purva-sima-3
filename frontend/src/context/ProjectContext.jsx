import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'

const ProjectContext = createContext(null)

export function ProjectProvider({ children }) {
  const [companies, setCompanies] = useState([])
  const [activeCompanyId, setActiveCompanyId] = useState('provident')
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [activeProject, setActiveProject] = useState(null)
  const [isBackendOnline, setIsBackendOnline] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [toasts, setToasts] = useState([])

  // UX refinement: a handle onto App.jsx's tab-navigation function, so a
  // toast fired from deep inside this context (e.g. a background job
  // finishing) can offer a "View Results" action that actually switches
  // tabs. App.jsx registers itself via registerNavigate() on mount --
  // see this file's bottom for why a ref (not state) is used here.
  const navigateRef = useRef(null)
  const registerNavigate = useCallback((fn) => {
    navigateRef.current = fn
  }, [])
  // The invoker side of the same handle: any component can call
  // navigate('phase3') to switch tabs, e.g. from a toast's action button
  // fired well after the click that triggered it.
  const navigate = useCallback((tab) => {
    navigateRef.current?.(tab)
  }, [])

  // Toast Notification helper. `action`, when given, is {label, onClick} --
  // rendered as a small button on the toast (see Toast.jsx) that runs
  // onClick and dismisses the toast, e.g. { label: 'View Results', onClick: () => navigateRef.current?.('phase2') }.
  const addToast = useCallback((message, type = 'success', duration = 4000, action = null) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6)
    setToasts((prev) => [...prev, { id, message, type, action }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Health check
  const checkHealth = useCallback(async () => {
    const res = await api.checkHealth()
    setIsBackendOnline(res.status === 'ok')
  }, [])

  // Fetch companies
  const loadCompanies = useCallback(async () => {
    try {
      const data = await api.getCompanies()
      setCompanies(data)
      if (data.length > 0 && !data.some((c) => c.company_id === activeCompanyId)) {
        setActiveCompanyId(data[0].company_id)
      }
    } catch (err) {
      console.warn('Could not load companies from API:', err.message)
    }
  }, [activeCompanyId])

  // Read via a ref inside loadProjects (below), NOT as a useCallback
  // dependency -- see loadProjects' own comment for why. Kept in sync by
  // the effect right under it.
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  // Fetch projects for active company
  const loadProjects = useCallback(async (companyId = activeCompanyId) => {
    setIsLoading(true)
    try {
      const data = await api.getPhase3Projects(companyId)
      setProjects(data)
      // Auto-select first project if none selected or if active is not in
      // new company -- reads activeProjectIdRef.current rather than
      // closing over activeProjectId directly. This used to be a plain
      // dependency, which meant loadProjects' own identity changed every
      // time activeProjectId changed -- including a deliberate
      // selectProject(null) meant to clear the selection (e.g. "New
      // Estimate"). That identity change re-triggered the "load projects
      // whenever active company changes" effect below (loadProjects is in
      // its dependency array), which re-ran this same function, saw
      // activeProjectId was (correctly, deliberately) null, and
      // immediately re-selected data[0] -- silently undoing the reset a
      // fraction of a second after it happened, before the user ever saw
      // a blank form. Reading the ref instead means loadProjects' own
      // identity only changes when activeCompanyId changes, so clearing
      // the selection no longer triggers a reload that stomps on it.
      const currentActiveId = activeProjectIdRef.current
      if (data.length > 0) {
        if (!currentActiveId || !data.some((p) => p.project_id === currentActiveId)) {
          setActiveProjectId(data[0].project_id)
        }
      } else {
        setActiveProjectId(null)
        setActiveProject(null)
      }
    } catch (err) {
      console.warn('Could not load projects for company:', companyId, err.message)
      setProjects([])
    } finally {
      setIsLoading(false)
    }
  }, [activeCompanyId])

  // Initial load
  useEffect(() => {
    checkHealth()
    loadCompanies()
    const interval = setInterval(checkHealth, 15000)
    return () => clearInterval(interval)
  }, [checkHealth, loadCompanies])

  // Load projects whenever active company changes
  useEffect(() => {
    if (activeCompanyId) {
      loadProjects(activeCompanyId)
    }
  }, [activeCompanyId, loadProjects])

  // UX refinement (Phase C): background-job polling -- "as soon as the
  // calculation is done, a small notification can be shown". Polls
  // GET /uploads/jobs?active_only=true every ~5s; a job_id that WAS in
  // the active set on the previous poll but is no longer is a job that
  // just finished (succeeded or failed), so its full record is fetched
  // once to build the right notification. Runs for the whole app
  // lifetime (mounted once, here, rather than per-view) so a job started
  // from Phase 2 still notifies even if the user has since navigated
  // away -- exactly the "browse other parts of the project while it
  // calculates" behavior asked for.
  const [activeJobs, setActiveJobs] = useState([])
  const prevActiveJobIds = useRef(new Set())

  useEffect(() => {
    if (!activeCompanyId) return

    let cancelled = false

    const poll = async () => {
      try {
        const active = await api.listJobs(activeCompanyId, true)
        if (cancelled) return
        setActiveJobs(active)

        const activeIds = new Set(active.map((j) => j.job_id))
        const finishedIds = [...prevActiveJobIds.current].filter((id) => !activeIds.has(id))

        for (const jobId of finishedIds) {
          try {
            const job = await api.getJob(jobId, activeCompanyId)
            if (job.status === 'succeeded') {
              addToast(
                `${job.kind.toUpperCase()} calculation finished for "${job.source_filename}"`,
                'success',
                10000,
                { label: 'View Results', onClick: () => navigateRef.current?.('phase2') }
              )
            } else if (job.status === 'failed') {
              addToast(`${job.kind.toUpperCase()} calculation failed for "${job.source_filename}": ${job.error}`, 'error', 10000)
            }
          } catch {
            // job record vanished or is unreachable -- nothing useful to notify
          }
        }
        prevActiveJobIds.current = activeIds
      } catch {
        // backend briefly unreachable -- polling just tries again next tick, no toast spam
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeCompanyId, addToast])

  // Load active project details
  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null)
      return
    }

    const matchedSummary = projects.find((p) => p.project_id === activeProjectId)
    if (matchedSummary) {
      setActiveProject(matchedSummary)
    }
  }, [activeProjectId, projects])

  const createCompany = async (displayName, companyId = null) => {
    try {
      const created = await api.createCompany(displayName, companyId)
      addToast(`Company "${created.display_name}" registered`, 'success')
      await loadCompanies()
      setActiveCompanyId(created.company_id)
      return created
    } catch (err) {
      addToast(`Failed to create company: ${err.message}`, 'error')
      throw err
    }
  }

  const selectCompany = (newCompanyId) => {
    setActiveCompanyId(newCompanyId)
    setActiveProjectId(null)
  }

  const selectProject = (newProjectId) => {
    setActiveProjectId(newProjectId)
  }

  // UX refinement: named-project search/save/rename, backed by
  // app/api/projects.py. searchProjects is read-only (used by the
  // Projects menu's search box and, later, the chat bar's name
  // resolution); createNamedProject/renameProject both refresh the
  // projects list afterward so every screen reading `projects` picks up
  // the new/changed name immediately, matching how createCompany above
  // already refreshes `companies`.
  const searchProjects = async (query, companyId = activeCompanyId) => {
    try {
      return await api.searchProjects(query, companyId)
    } catch (err) {
      console.warn('Project name search failed:', err.message)
      return []
    }
  }

  const createNamedProject = async (projectName, companyId = activeCompanyId) => {
    try {
      const created = await api.createNamedProject(projectName, companyId)
      addToast(`Project "${created.project_name}" saved`, 'success')
      await loadProjects(companyId)
      setActiveProjectId(created.project_id)
      return created
    } catch (err) {
      addToast(`Failed to save project: ${err.message}`, 'error')
      throw err
    }
  }

  const renameProject = async (projectId, projectName, companyId = activeCompanyId) => {
    try {
      const renamed = await api.renameProject(projectId, projectName, companyId)
      addToast(`Project renamed to "${renamed.project_name}"`, 'success')
      await loadProjects(companyId)
      return renamed
    } catch (err) {
      addToast(`Failed to rename project: ${err.message}`, 'error')
      throw err
    }
  }

  // UX refinement: "I want to be able to delete projects from the
  // projects tab" -- permanent, backed by DELETE /projects/{id} (removes
  // the name registry entry, the Phase 1 record, and the whole Phase 3/4
  // directory in one call). If the deleted project was the active one,
  // clears the selection so nothing keeps pointing at data that no
  // longer exists; loadProjects() below then picks a new active project
  // from whatever's left, the same auto-select logic that already runs
  // on every load.
  const deleteProject = async (projectId, companyId = activeCompanyId) => {
    try {
      await api.deleteProject(projectId, companyId)
      addToast('Project deleted', 'success')
      if (projectId === activeProjectId) {
        setActiveProjectId(null)
      }
      await loadProjects(companyId)
    } catch (err) {
      addToast(`Failed to delete project: ${err.message}`, 'error')
      throw err
    }
  }

  return (
    <ProjectContext.Provider
      value={{
        companies,
        activeCompanyId,
        selectCompany,
        createCompany,
        projects,
        activeProjectId,
        activeProject,
        selectProject,
        loadProjects,
        searchProjects,
        createNamedProject,
        renameProject,
        deleteProject,
        isBackendOnline,
        isLoading,
        toasts,
        addToast,
        removeToast,
        registerNavigate,
        navigate,
        activeJobs,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return context
}