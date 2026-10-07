import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, Check, Building2 } from 'lucide-react'
import { useProject } from '../../context/ProjectContext'

/**
 * UX refinement (Phase D): the hub header's project picker. Backed by
 * Phase A's name registry (GET /projects/search) so it can find a project
 * by name even before it's fully loaded into the `projects` list -- the
 * same name-lookup the chat bar will use for mid-conversation switching
 * in Phase E.
 */
export default function ProjectSwitcher() {
  const { projects, activeProjectId, activeProject, selectProject, searchProjects } = useProject()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(projects)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!query.trim()) {
        setResults(projects)
        return
      }
      const found = await searchProjects(query)
      if (!cancelled) setResults(found)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [query, projects, searchProjects])

  const current = activeProject || projects.find((p) => p.project_id === activeProjectId)

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 260 }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="glass-panel"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          border: '1px solid rgba(49, 130, 206, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <Building2 size={16} color="#3182CE" style={{ flexShrink: 0 }} />
          <div style={{ textAlign: 'left', overflow: 'hidden' }}>
            <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project</div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {current?.project_name || 'Select a project'}
            </div>
          </div>
        </div>
        <ChevronDown size={16} color="#64748b" style={{ flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div
          className="glass-panel-elevated"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 200,
            padding: 10,
            maxHeight: 360,
            overflowY: 'auto',
            // UX fix: this dropdown floats directly over live dashboard
            // content (KPIs, chart) rather than a dedicated modal backdrop,
            // so the panel's normal --glass-bg-elevated (35% opacity) let
            // that content bleed through and collide with the project list.
            // Matches Toast.jsx's proven opaque-override pattern instead of
            // touching the shared --glass-bg-elevated variable, which is
            // fine for real modals elsewhere in the app.
            background: 'rgba(9, 20, 14, 0.97)',
            // Post-delivery correction #1 (insufficient on its own): this
            // used to ALSO carry backdropFilter: blur(24px) -- removed,
            // see below for why that wasn't actually the cause.
            //
            // Post-delivery correction #2 (the real fix): the panel used
            // to also carry the shared `animate-fade-in` class (see
            // index.css's `fadeIn` keyframe: `transform: translateY(8px)
            // -> translateY(0)` + `opacity: 0 -> 1` over 0.35s). Removing
            // the blur did NOT stop the live "ghosted"/doubled-row
            // reproduction, and a getComputedStyle() dump of every row
            // AFTER the animation had finished showed every row with
            // identical, correct, fully-opaque styling -- proving this was
            // never a CSS/DOM-state bug, only ever visible transiently
            // DURING the 350ms animation window. Animating `transform` on
            // an absolutely-positioned, `overflow-y: auto` panel containing
            // ~20 repeatedly-rasterized text rows is a known Chromium
            // compositor trigger for exactly this kind of paint-trail/
            // ghosting artifact (the plain `<input>` above renders sharp
            // throughout because it isn't part of that repeated-rasterize
            // list). Dropping the animation entirely -- this dropdown now
            // just appears instantly on open -- removes the transform/
            // opacity keyframe that was the actual trigger, not a
            // cosmetic side effect of it. Reproduced live both before and
            // after correction #1 but NOT after this one.
          }}
        >
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={13} color="#64748b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              autoFocus
              type="text"
              placeholder="Search projects by name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input"
              // Belt-and-suspenders: this is a live filter, not a form
              // field meant to be remembered -- off stops the browser's
              // own autofill suggestion popup from ever being a second
              // candidate for what was layering behind this dropdown.
              autoComplete="off"
              style={{ paddingLeft: 28, fontSize: '0.8125rem' }}
            />
          </div>
          {results.length === 0 ? (
            <div style={{ padding: '14px 8px', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>No projects found</div>
          ) : (
            results.map((p) => (
              <button
                key={p.project_id}
                onClick={() => {
                  selectProject(p.project_id)
                  setIsOpen(false)
                  setQuery('')
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 10px',
                  background: p.project_id === activeProjectId ? 'rgba(49, 130, 206, 0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '0.8125rem', color: '#f8fafc', fontWeight: 500 }}>{p.project_name}</span>
                {p.project_id === activeProjectId && <Check size={14} color="#3182CE" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}