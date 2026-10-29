import React from 'react'
import { ArrowRight, Calculator, LayoutGrid } from 'lucide-react'
import { motion } from 'framer-motion'
import blueprintVideo from '../../assets/video/vecteezy_architecture-blueprint-3d-illustration_72196420.mp4'
import { useProject } from '../../context/ProjectContext'

export default function LandingPage({ onNavigate }) {
  const { selectProject } = useProject()
  return (
    <div className="landing-page" style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '24px',
      textAlign: 'center',
      maxWidth: '100vw',
      width: '100%',
      margin: '0 auto',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Brand mark -- same sidebar-brand-* classes AppShell's sidebar
          uses, so the "S" wordmark reads identically here and once
          you're inside the app proper. This is the one screen in the app
          with no sidebar at all, so it needs its own, lightweight brand
          header rather than borrowing AppShell's chrome. */}
      <div style={{ position: 'absolute', top: 24, left: 28, zIndex: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="sidebar-brand-icon">S</div>
        <div className="sidebar-brand-text" style={{ textAlign: 'left' }}>
          <span className="sidebar-brand-title">Sima</span>
          <span className="sidebar-brand-subtitle">Embodied Carbon</span>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        style={{ zIndex: 2, maxWidth: 900 }}
      >
        <h1 style={{ 
          fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', 
          fontWeight: 800, 
          lineHeight: 1.1, 
          letterSpacing: '-0.04em',
          marginBottom: '24px',
          color: 'var(--text-primary)'
        }}>
          From BOQ to Carbon — <br />
          <span style={{ color: 'var(--accent-green-light)' }}>Know the Impact Before You Build.</span>
        </h1>

        <p style={{ 
          fontSize: '1.25rem', 
          color: 'var(--text-secondary)', 
          lineHeight: 1.6, 
          marginBottom: '48px',
          maxWidth: 700,
          marginInline: 'auto'
        }}>
          Estimate, track, and reduce embodied carbon across your construction projects — 
          from early conceptual estimates and BOQ analysis to real-time tracking, 
          material swaps, and carbon audits.
        </p>

        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => {
              // Same reset "New Estimate" needs everywhere else -- see
              // ProjectsOverview.jsx's own comment on its "New Estimate"
              // button for why this has to happen before navigating,
              // not just on the wizard's own internal button.
              selectProject(null)
              onNavigate('conceptual-estimate')
            }}
            className="btn-primary"
            style={{ padding: '14px 32px', fontSize: '1rem' }}
          >
            <Calculator size={20} />
            Calculate Your Carbon
          </button>
          
          <button 
            onClick={() => onNavigate('overview')}
            className="btn-secondary"
            style={{ padding: '14px 32px', fontSize: '1rem' }}
          >
            <LayoutGrid size={20} />
            Explore the Platform
            <ArrowRight size={18} />
          </button>
        </div>
      </motion.div>

      {/* Video background animation */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: 'var(--bg-primary)'
      }}>
        <video 
          autoPlay 
          loop 
          muted 
          playsInline
          onEnded={(e) => {
            e.currentTarget.currentTime = 0
            e.currentTarget.play().catch(() => {})
          }}
          key="bg-video-blueprint"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.1,
            filter: 'contrast(1.1) brightness(0.95)',
          }}
        >
          <source src={blueprintVideo} type="video/mp4" />
        </video>
      </div>

      {/* Gradient Overlay - Softened */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 50%, rgba(var(--c-bg), 0.1) 0%, rgba(var(--c-bg), 0.5) 100%)'
      }} />
    </div>
  )
}
