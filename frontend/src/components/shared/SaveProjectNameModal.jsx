import React, { useState, useEffect } from 'react'
import { Tag } from 'lucide-react'
import { useProject } from '../../context/ProjectContext'

/**
 * UX refinement: one reusable "name this project" modal, backed by
 * app/api/projects.py (POST /projects to create-and-name, PATCH
 * /projects/{id}/name to rename). Shared across every entry point that
 * needs to attach or change a project's name tag, so there's exactly one
 * place this flow is implemented:
 *   - Phase 1's ResultsStep, after a conceptual estimate is calculated
 *   - Phase 2's job-completion notification ("save this upload as a project")
 *   - The Tracking & Chat hub's header (rename the currently open project)
 *   - ProjectsOverview's per-card rename affordance
 *
 * Props:
 *   isOpen        -- whether to render the modal
 *   onClose       -- called on cancel/backdrop click
 *   projectId     -- null to CREATE a new named project (mints a fresh
 *                    project_id), or an existing project_id to RENAME it
 *   initialName   -- pre-fills the input (e.g. the project's current name)
 *   onSaved(entry)-- called with {project_id, company_id, project_name}
 *                    after a successful save
 */
export default function SaveProjectNameModal({ isOpen, onClose, projectId = null, initialName = '', onSaved }) {
  const { activeCompanyId, createNamedProject, renameProject } = useProject()
  const [name, setName] = useState(initialName)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setName(initialName)
  }, [isOpen, initialName])

  if (!isOpen) return null

  const handleSave = async (e) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSaving(true)
    try {
      const entry = projectId
        ? await renameProject(projectId, name.trim(), activeCompanyId)
        : await createNamedProject(name.trim(), activeCompanyId)
      onSaved?.(entry)
      onClose()
    } catch {
      // ProjectContext's createNamedProject/renameProject already surface
      // a toast on failure -- nothing further to do here.
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        background: 'rgba(var(--c-black), 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel-elevated animate-fade-in"
        style={{ width: '100%', maxWidth: 420, padding: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Tag size={18} color="var(--accent-lime)" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {projectId ? 'Rename Project' : 'Save Project'}
          </h3>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>
          {projectId
            ? 'Give this project a clearer name -- it updates everywhere this project is referenced.'
            : "Tag this with a name so you can find it again from the Projects menu, the chat bar, or any phase."}
        </p>

        <form onSubmit={handleSave}>
          <input
            type="text"
            autoFocus
            placeholder="e.g. Ecopolitan Tower B"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
            style={{ width: '100%', marginBottom: 18 }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} className="btn-secondary" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || !name.trim()}>
              {isSaving ? 'Saving...' : projectId ? 'Rename' : 'Save Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
