/**
 * Sima CarbonOS API Client
 * Interfaces directly with the backend
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

async function handleResponse(response) {
  if (!response.ok) {
    let errorDetail = 'An unexpected error occurred'
    try {
      const errorJson = await response.json()
      errorDetail = errorJson.detail || errorDetail
    } catch {
      errorDetail = await response.text() || response.statusText
    }
    throw new Error(errorDetail)
  }
  return response.json()
}

export const api = {
  // --- Health ---
  checkHealth: async () => {
    try {
      const res = await fetch(`${API_BASE}/health`)
      return await res.json()
    } catch {
      return { status: 'offline' }
    }
  },

  // --- Companies ---
  getCompanies: async () => {
    const res = await fetch(`${API_BASE}/companies`)
    return handleResponse(res)
  },

  createCompany: async (displayName, companyId = null) => {
    const res = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, company_id: companyId }),
    })
    return handleResponse(res)
  },

  getCompany: async (companyId) => {
    const res = await fetch(`${API_BASE}/companies/${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  // --- Named Projects (UX refinement: save/search/rename a project by
  // name from anywhere -- app/api/projects.py, backed by
  // app/services/project_registry.py) ---
  searchProjects: async (query, companyId = 'provident', limit = 5) => {
    const res = await fetch(
      `${API_BASE}/projects/search?company_id=${encodeURIComponent(companyId)}&q=${encodeURIComponent(query)}&limit=${limit}`
    )
    return handleResponse(res)
  },

  createNamedProject: async (projectName, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: projectName, company_id: companyId }),
    })
    return handleResponse(res)
  },

  renameProject: async (projectId, projectName, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: projectName, company_id: companyId }),
    })
    return handleResponse(res)
  },

  deleteProject: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'DELETE',
    })
    return handleResponse(res)
  },

  // Purely descriptive project metadata (archetype/construction_stage/
  // location) -- app/api/projects.py's PATCH /projects/{id}/profile,
  // backed by project_registry.set_project_profile(). Only the fields
  // actually passed in `profile` are sent, so omitting one leaves it
  // unchanged server-side (see that function's own docstring) -- never
  // read by any calculation, display/filter metadata only for screens
  // like Portfolio Overview.
  updateProjectProfile: async (projectId, profile, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, ...profile }),
    })
    return handleResponse(res)
  },

  // --- Operational Emissions (Scope 1 & 2) -- new, standalone feature.
  // Deliberately its own endpoint family (backend/app/api/operational_emissions.py),
  // not layered onto the named-projects endpoints above -- see that
  // module's docstring for why. calculateOperationalEmissions both
  // computes AND saves the entry in one call.
  calculateOperationalEmissions: async (payload) => {
    const res = await fetch(`${API_BASE}/operational-emissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return handleResponse(res)
  },

  listOperationalEmissions: async (companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/operational-emissions?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  deleteOperationalEmissions: async (entryId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/operational-emissions/${encodeURIComponent(entryId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'DELETE',
    })
    return handleResponse(res)
  },

  // --- Phase 1: Tiered Form & Conceptual ---
  submitForm: async (formData) => {
    const res = await fetch(`${API_BASE}/form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    return handleResponse(res)
  },

  getForm: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/form/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  patchForm: async (projectId, updates, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/form/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return handleResponse(res)
  },

  calculateProject: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/calculate/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
    })
    return handleResponse(res)
  },

  substitutePhase1: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/substitute/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
    })
    return handleResponse(res)
  },

  refineProject: async (projectId, boqFile, companyId = 'provident') => {
    const formData = new FormData()
    formData.append('boq_file', boqFile)
    const res = await fetch(`${API_BASE}/refine/${encodeURIComponent(projectId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  // --- Phase 2: BOQ & Work Order Upload ---
  calculateBoq: async (file, options = {}) => {
    const formData = new FormData()
    formData.append('boq_file', file)
    if (options.sheetName) formData.append('sheet_name', options.sheetName)
    if (options.floorAreaSqm) formData.append('floor_area_sqm', options.floorAreaSqm)
    if (options.floorAreaBasis) formData.append('floor_area_basis', options.floorAreaBasis)
    if (options.companyId) formData.append('company_id', options.companyId)
    if (options.registerAsReference) {
      formData.append('register_as_reference', 'true')
      if (options.structuralSystemType) formData.append('structural_system_type', options.structuralSystemType)
      if (options.typology) formData.append('typology', options.typology)
      if (options.referenceSlug) formData.append('reference_slug', options.referenceSlug)
    }

    const res = await fetch(`${API_BASE}/boq-carbon/calculate`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  // --- Background upload jobs (UX refinement, Phase C) --------------------
  // Combined BOQ + Work Order upload -- each is calculated as its own
  // independent background job (see app/api/uploads.py's own docstring
  // for the locked "never merged" decision). Either file may be omitted,
  // but not both.
  uploadCombined: async (files, options = {}) => {
    const formData = new FormData()
    if (files.boqFile) formData.append('boq_file', files.boqFile)
    if (files.woFile) formData.append('wo_file', files.woFile)
    if (options.floorAreaSqm) formData.append('floor_area_sqm', options.floorAreaSqm)
    if (options.floorAreaBasis) formData.append('floor_area_basis', options.floorAreaBasis)
    formData.append('company_id', options.companyId || 'provident')

    const res = await fetch(`${API_BASE}/uploads/combined`, { method: 'POST', body: formData })
    return handleResponse(res)
  },

  getJob: async (jobId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/uploads/jobs/${encodeURIComponent(jobId)}?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  listJobs: async (companyId = 'provident', activeOnly = false) => {
    const res = await fetch(`${API_BASE}/uploads/jobs?company_id=${encodeURIComponent(companyId)}&active_only=${activeOnly}`)
    return handleResponse(res)
  },

  getJobResult: async (jobId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/uploads/jobs/${encodeURIComponent(jobId)}/result?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  // "I want to be able to delete some recent uploads" -- permanent delete,
  // confirmed in JobResultsCompare before this is ever called.
  deleteJob: async (jobId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/uploads/jobs/${encodeURIComponent(jobId)}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'DELETE',
    })
    return handleResponse(res)
  },

  useJobAsBaseline: async (jobId, data) => {
    const res = await fetch(`${API_BASE}/uploads/jobs/${encodeURIComponent(jobId)}/use-as-baseline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: data.projectId,
        company_id: data.companyId || 'provident',
        structural_system_type: data.structuralSystemType,
        num_floors: data.numFloors,
        typology: data.typology,
        project_name: data.projectName,
        overwrite: !!data.overwrite,
      }),
    })
    return handleResponse(res)
  },

  getBoqCatalog: async () => {
    const res = await fetch(`${API_BASE}/boq-carbon/substitution-catalog`)
    return handleResponse(res)
  },

  substituteBoq: async (file, substitutionsList, options = {}) => {
    const formData = new FormData()
    formData.append('boq_file', file)
    formData.append('substitutions', JSON.stringify(substitutionsList))
    if (options.sheetName) formData.append('sheet_name', options.sheetName)
    if (options.floorAreaSqm) formData.append('floor_area_sqm', options.floorAreaSqm)
    if (options.floorAreaBasis) formData.append('floor_area_basis', options.floorAreaBasis)

    const res = await fetch(`${API_BASE}/boq-carbon/substitute`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  calculateWo: async (file, options = {}) => {
    const formData = new FormData()
    formData.append('wo_file', file)
    if (options.floorAreaSqm) formData.append('floor_area_sqm', options.floorAreaSqm)
    if (options.floorAreaBasis) formData.append('floor_area_basis', options.floorAreaBasis)
    if (options.companyId) formData.append('company_id', options.companyId)
    if (options.registerAsReference) {
      formData.append('register_as_reference', 'true')
      if (options.structuralSystemType) formData.append('structural_system_type', options.structuralSystemType)
      if (options.typology) formData.append('typology', options.typology)
    }

    const res = await fetch(`${API_BASE}/wo-carbon/calculate`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  // --- Phase 3: Tracking, Bills & Chatbot ---
  getPhase3Projects: async (companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase3/projects?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  recordBaseline: async (projectId, data) => {
    const formData = new FormData()
    formData.append('source_type', data.sourceType)
    formData.append('company_id', data.companyId || 'provident')
    if (data.file) formData.append('file', data.file)
    if (data.sheetName) formData.append('sheet_name', data.sheetName)
    if (data.floorAreaSqm) formData.append('floor_area_sqm', data.floorAreaSqm)
    if (data.floorAreaBasis) formData.append('floor_area_basis', data.floorAreaBasis)
    if (data.projectName) formData.append('project_name', data.projectName)
    if (data.structuralSystemType) formData.append('structural_system_type', data.structuralSystemType)
    if (data.numFloors) formData.append('num_floors', data.numFloors)
    if (data.typology) formData.append('typology', data.typology)
    if (data.overwrite) formData.append('overwrite', 'true')

    const res = await fetch(`${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/baseline`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  logBill: async (projectId, data) => {
    const formData = new FormData()
    // Both now OPTIONAL on the backend (app/api/phase3.py's upload_bill):
    // for a Certificate of Payment PDF, the document's own "Work done
    // period" end date and RA Bill No. are read off the file itself and
    // take priority over whatever's sent here (see cop_bill_parser.py) --
    // the caller (ProjectDashboard's upload-bill flow) only passes these
    // for an .xlsx/.xls BOQ bill, which has no date field of its own and
    // still requires them.
    if (data.period) formData.append('period', data.period)
    if (data.billedDate) formData.append('billed_date', data.billedDate)
    // Backend's POST /phase3/projects/{id}/bills expects this multipart
    // field named `bill_file` (see app/api/phase3.py's upload_bill) --
    // sending it as `file` makes FastAPI reject the whole request with
    // 422 before it ever reaches parsing, since bill_file then looks
    // missing entirely.
    formData.append('bill_file', data.file)
    formData.append('company_id', data.companyId || 'provident')
    if (data.sheetName) formData.append('sheet_name', data.sheetName)
    if (data.statedPercentComplete) formData.append('stated_percent_complete', data.statedPercentComplete)
    // Only meaningful for a .pdf (Certificate of Payment) bill -- the
    // backend ignores it for an .xlsx/.xls upload. Defaults to
    // 'cummulative' server-side if omitted, so this is safe to always
    // send once a source is known.
    if (data.quantityBasis) formData.append('quantity_basis', data.quantityBasis)

    const res = await fetch(`${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/bills`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  getBills: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/bills?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  deleteBill: async (projectId, period, companyId = 'provident') => {
    const res = await fetch(
      `${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/bills/${encodeURIComponent(period)}?company_id=${encodeURIComponent(companyId)}`,
      { method: 'DELETE' }
    )
    return handleResponse(res)
  },

  getDashboard: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/dashboard?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  getChatTools: async () => {
    const res = await fetch(`${API_BASE}/phase3/chat/tools`)
    return handleResponse(res)
  },

  sendChatMessage: async (projectId, question, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase3/projects/${encodeURIComponent(projectId)}/chat?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    return handleResponse(res)
  },

  // UX refinement (Phase E): the hub's chat bar posts here instead --
  // this endpoint can resolve a DIFFERENT project named mid-question and
  // switch to it (see backend POST /phase3/chat's own docstring),
  // returning { answer, switched_to }. Falls back to activeProjectId
  // when the question doesn't confidently name a different project.
  sendHubChatMessage: async (question, companyId = 'provident', activeProjectId = null) => {
    const res = await fetch(`${API_BASE}/phase3/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, question, active_project_id: activeProjectId }),
    })
    return handleResponse(res)
  },

  // --- Phase 4: Recommendations & Audit Log ---
  proposeRecommendation: async (projectId, substitutionId, userPct, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/recommendations?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ substitution_id: substitutionId, user_pct: userPct }),
    })
    return handleResponse(res)
  },

  getRecommendations: async (projectId, status = null, companyId = 'provident') => {
    let url = `${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/recommendations?company_id=${encodeURIComponent(companyId)}`
    if (status) url += `&status=${encodeURIComponent(status)}`
    const res = await fetch(url)
    return handleResponse(res)
  },

  confirmRecommendation: async (projectId, recommendationId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/recommendations/${encodeURIComponent(recommendationId)}/confirm?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
    })
    return handleResponse(res)
  },

  // "Material Alternatives (Beta)" section's Confirm button -- forks a
  // new sibling project with the substituted totals instead of
  // overwriting this project's own figures (see
  // app/services/phase4.py's confirm_recommendation_as_beta_twin).
  // Returns { recommendation, new_project_id, new_project_name,
  // new_project_total_gwp_kg_co2e }.
  confirmRecommendationAsBeta: async (projectId, recommendationId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/recommendations/${encodeURIComponent(recommendationId)}/confirm-as-beta?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
    })
    return handleResponse(res)
  },

  rejectRecommendation: async (projectId, recommendationId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/recommendations/${encodeURIComponent(recommendationId)}/reject?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
    })
    return handleResponse(res)
  },

  getAuditLog: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/audit-log?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  getCurrentState: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/current-state?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  // "Even the material substitution section, I want to be able to see all
  // the possible suggested material swaps just like the mock up" -- every
  // catalog entry evaluated at its own max_recommended_pct against this
  // project's real baseline (app/services/phase4.evaluate_catalog_preview,
  // reusing substitution_engine.apply_substitution -- never a second,
  // approximate calculation path). Read-only: nothing is persisted by this
  // call. An entry with 0 affected lines comes back with applicable: false
  // rather than a fabricated reduction.
  getCatalogPreview: async (projectId, companyId = 'provident') => {
    const res = await fetch(`${API_BASE}/phase4/projects/${encodeURIComponent(projectId)}/catalog-preview?company_id=${encodeURIComponent(companyId)}`)
    return handleResponse(res)
  },

  // --- Factors & History ---
  getCurrentFactors: async (asOf = null) => {
    let url = `${API_BASE}/factors/current`
    if (asOf) url += `?as_of=${encodeURIComponent(asOf)}`
    const res = await fetch(url)
    return handleResponse(res)
  },

  getCategoryHistory: async (category) => {
    const res = await fetch(`${API_BASE}/factors/${encodeURIComponent(category)}/history`)
    return handleResponse(res)
  },

  // --- Onboarding: per-company item-code classification / mapping review
  // queue (app/api/onboarding.py). Company-scoped, not project-scoped --
  // this backs the Material Mapping Queue screen. ---
  uploadOnboardingJob: async (companyId, itemCodeFile, options = {}) => {
    const formData = new FormData()
    formData.append('item_code_file', itemCodeFile)
    if (options.useLlmDraft !== undefined) formData.append('use_llm_draft', String(options.useLlmDraft))
    if (options.amountsByCode) formData.append('amounts_by_code', JSON.stringify(options.amountsByCode))
    const res = await fetch(`${API_BASE}/onboarding/${encodeURIComponent(companyId)}/upload`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse(res)
  },

  getOnboardingJob: async (companyId, jobId) => {
    const res = await fetch(`${API_BASE}/onboarding/${encodeURIComponent(companyId)}/jobs/${encodeURIComponent(jobId)}`)
    return handleResponse(res)
  },

  confirmOnboardingJob: async (companyId, jobId, decisions) => {
    const res = await fetch(`${API_BASE}/onboarding/${encodeURIComponent(companyId)}/jobs/${encodeURIComponent(jobId)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions }),
    })
    return handleResponse(res)
  },

  getCanonicalCategories: async () => {
    const res = await fetch(`${API_BASE}/onboarding/canonical-categories`)
    return handleResponse(res)
  },
}