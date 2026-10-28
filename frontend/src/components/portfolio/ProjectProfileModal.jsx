import React, { useState, useEffect } from 'react'
import { Layers } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'

// Mirrors app/services/project_registry.py's ArchetypeOption/
// ConstructionStage Literal types exactly -- the frontend has no endpoint
// exposing these (same as the mockup's own filter lists were inline), so
// this is the one place that list has to be kept in sync with the backend
// if it ever changes.
export const ARCHETYPE_OPTIONS = [
  'Residential High-Rise',
  'Affordable Housing (Mivan)',
  'Commercial Grade-A Office',
  'Mixed-Use Retail & Living',
  'Low-Rise Villa Community',
]

export const CONSTRUCTION_STAGE_OPTIONS = [
  'Substructure',
  'Superstructure',
  'Enclosure / Facade',
  'Fit-out',
  'Commissioning',
  'Completed',
]

/**
 * UX refinement: the only place in the app that can set a project's
 * archetype / construction stage / location -- without this, those three
 * fields added to project_registry.py (PATCH /projects/{id}/profile) would
 * have no way to ever be set from the UI, and Portfolio Overview's "Type &
 * Stage" column would stay empty forever. Pattern-matched to
 * SaveProjectNameModal.jsx (same modal shell, same form classes).
 *
 * Props:
 *   isOpen, onClose
 *   projectId        -- required, the project being edited
 *   initialProfile    -- { archetype, construction_stage, location } as
 *                        currently known (from the ProjectSummary row) --
 *                        pre-fills the form
 *   onSaved()         -- called after a successful save, so the caller can
 *                        refresh (ProjectContext.loadProjects())
 */
export default function ProjectProfileModal({ isOpen, onClose, projectId, initialProfile = {}, onSaved }) {
  const { activeCompanyId, addToast } = useProject()
  const [archetype, setArchetype] = useState(initialProfile.archetype || '')
  const [constructionStage, setConstructionStage] = useState(initialProfile.construction_stage || '')
  const [location, setLocation] = useState(initialProfile.location || '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setArchetype(initialProfile.archetype || '')
      setConstructionStage(initialProfile.construction_stage || '')
      setLocation(initialProfile.location || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId])

  if (!isOpen) return null

  const handleSave = async (e) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await api.updateProjectProfile(
        projectId,
        {
          // Omitted (undefined) fields are left out of the request body
          // entirely rather than sent as null/empty -- set_project_profile()
          // only changes fields actually passed, and an empty string would
          // otherwise overwrite an already-set value with nothing.
          ...(archetype ? { archetype } : {}),
          ...(constructionStage ? { construction_stage: constructionStage } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
        },
        activeCompanyId
      )
      addToast('Project profile updated', 'success')
      onSaved?.()
      onClose()
    } catch (err) {
      addToast(`Failed to update project profile: ${err.message}`, 'error')
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel-elevated animate-fade-in"
        style={{ width: '100%', maxWidth: 440, padding: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Layers size={18} color="var(--accent-lime)" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Project Profile
          </h3>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
          Purely descriptive -- used for display and filtering on Portfolio Overview only, never fed
          into any carbon calculation.
        </p>

        <form onSubmit={handleSave}>
          <label className="form-label" htmlFor="profile-archetype">Archetype</label>
          <select
            id="profile-archetype"
            className="form-select"
            value={archetype}
            onChange={(e) => setArchetype(e.target.value)}
            style={{ width: '100%', marginBottom: 14 }}
          >
            <option value="">-- Not set --</option>
            {ARCHETYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          <label className="form-label" htmlFor="profile-stage">Construction Stage</label>
          <select
            id="profile-stage"
            className="form-select"
            value={constructionStage}
            onChange={(e) => setConstructionStage(e.target.value)}
            style={{ width: '100%', marginBottom: 14 }}
          >
            <option value="">-- Not set --</option>
            {CONSTRUCTION_STAGE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          <label className="form-label" htmlFor="profile-location">
            Location <span className="form-label-optional">(overrides the Phase 1 record's location, if any)</span>
          </label>
          <input
            id="profile-location"
            type="text"
            placeholder="e.g. Bengaluru"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="form-input"
            style={{ width: '100%', marginBottom: 18 }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} className="btn-secondary" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
