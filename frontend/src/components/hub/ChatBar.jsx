import React, { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, ChevronDown, ChevronUp, Check, X, ArrowRightLeft, Database, Info } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'

/**
 * UX refinement (Phase D + E): "keep the chat bar at the bottom with the
 * dashboard showing the bills and other visualizations" -- this is that
 * bar, sticky to the bottom of the hub, collapsed to one input row until
 * there's a conversation.
 *
 * Phase E additions, on top of the Phase D version:
 *  - Posts to POST /phase3/chat (api.sendHubChatMessage) instead of the
 *    fixed per-project endpoint. That endpoint can resolve a DIFFERENT
 *    project named in the question and report back `switched_to` -- when
 *    it does, this bar calls the shared ProjectContext's selectProject()
 *    so the whole hub (KPIs, chart, bills table) follows the switch, and
 *    drops in a small system note ("Switched to Ecopolitan") rather than
 *    wiping the conversation the way an ordinary project-switcher change
 *    would (see skipNextReset below).
 *  - When a bot reply is a pending "propose_substitution" result (real
 *    computed delta, not yet applied), renders inline Confirm/Discard
 *    buttons that call Phase 4's existing confirm/reject endpoints
 *    directly -- more reliable than asking the user to type "confirm"
 *    again, though that also still works via chatbot.py's own
 *    confirm/reject keyword intents as a fallback. `onPendingChange`
 *    reports the live pending recommendation (or null) up to
 *    TrackingChatHub, which overlays it on the chart as a dashed
 *    "Proposed" reference line.
 *
 * Workstream 15 additions (on top of all of the above, no new endpoints):
 * the backend now also answers query questions for a project that has a
 * Phase 3 baseline but no Phase 1 record (pulled straight from its BOQ/WO
 * baseline instead), explains why a what-if swap can't run on such a
 * project, and composes a grounded free-form answer for a question
 * outside the fixed tool set -- degrading to a deterministic plain-text
 * summary of this project's own recorded data when no LLM is reachable
 * (this sandbox's own everyday case). None of that needed a new field on
 * ChatAnswer: every one of these is already fully described in plain
 * English inside answer_text, so the two small helpers below just add a
 * compact visual flag on top of that prose -- never a second source of
 * truth -- using the one phrasing chatbot.py's narrators already use
 * consistently for "answered from Phase 3, not Phase 1" ("no Phase 1
 * record"), plus the two fallback-specific `error` values Workstream 15c
 * sets on a free-form answer.
 */
const _isPhase3FallbackAnswer = (text) => typeof text === 'string' && /no phase 1 record/i.test(text)

const _FREEFORM_DEGRADED_CAPTIONS = {
  llm_unavailable_used_deterministic_summary: "Composed as a plain summary of this project's recorded data -- the AI model wasn't reachable, so nothing here is newly reasoned.",
  insufficient_data_for_freeform_answer: "This project may not have enough recorded data to fully answer that.",
}

export default function ChatBar({ chatTools, onPendingChange }) {
  const { activeCompanyId, activeProjectId, activeProject, selectProject } = useProject()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const [pending, setPending] = useState(null) // {recommendation_id, label, carbon_kg_before, carbon_kg_after, requires_engineering_review}
  const [isResolvingPending, setIsResolvingPending] = useState(false)
  const bottomRef = useRef(null)
  const skipNextReset = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  // A fresh conversation whenever the active project changes -- UNLESS
  // this bar itself just caused that change by resolving a name mention
  // mid-question (skipNextReset), in which case wiping the messages
  // we just added would erase the very "Switched to X" continuity the
  // name-switch is supposed to provide.
  useEffect(() => {
    if (skipNextReset.current) {
      skipNextReset.current = false
      return
    }
    setMessages([])
    setPending(null)
    onPendingChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  const setPendingAndNotify = (rec) => {
    setPending(rec)
    onPendingChange?.(rec)
  }

  const handleSend = async (questionText) => {
    const text = questionText || input
    if (!text.trim()) return

    const userMsg = { id: Date.now(), sender: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    if (!questionText) setInput('')
    setIsExpanded(true)
    setIsSending(true)
    try {
      const res = await api.sendHubChatMessage(text, activeCompanyId, activeProjectId)
      const { answer, switched_to: switchedTo } = res

      if (switchedTo) {
        skipNextReset.current = true
        selectProject(switchedTo.project_id)
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, sender: 'system', text: `Switched to "${switchedTo.project_name}"` },
        ])
      }

      setMessages((prev) => [...prev, { id: Date.now() + 2, sender: 'bot', data: answer }])

      // A fresh proposal -- surface Confirm/Discard.
      if (answer?.tool_call?.tool === 'propose_substitution' && answer?.data?.status === 'pending') {
        setPendingAndNotify({
          recommendation_id: answer.data.recommendation_id,
          label: answer.data.label,
          carbon_kg_before: answer.carbon_kg_before,
          carbon_kg_after: answer.carbon_kg_after,
          requires_engineering_review: answer.requires_engineering_review,
        })
      }
      // Resolved via a typed "confirm"/"discard" instead of the buttons.
      if (answer?.tool_call?.tool === 'confirm_pending_substitution' || answer?.tool_call?.tool === 'reject_pending_substitution') {
        setPendingAndNotify(null)
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', data: { answer_text: `Could not process question: ${err.message}`, error: err.message } },
      ])
    } finally {
      setIsSending(false)
    }
  }

  const resolvePending = async (action) => {
    if (!pending) return
    setIsResolvingPending(true)
    try {
      const result =
        action === 'confirm'
          ? await api.confirmRecommendation(activeProjectId, pending.recommendation_id, activeCompanyId)
          : await api.rejectRecommendation(activeProjectId, pending.recommendation_id, activeCompanyId)

      const text =
        action === 'confirm'
          ? `Confirmed and applied: ${pending.label}. Project total is now ${(result.project_total_gwp_kg_co2e_after / 1000).toFixed(1)} tCO₂e (was ${(result.project_total_gwp_kg_co2e_before / 1000).toFixed(1)} tCO₂e). Logged to the audit trail.`
          : `Discarded: ${pending.label}. Nothing about the project's numbers changed.`

      setMessages((prev) => [...prev, { id: Date.now(), sender: 'bot', data: { answer_text: text } }])
      setPendingAndNotify(null)
    } catch (err) {
      setMessages((prev) => [...prev, { id: Date.now(), sender: 'bot', data: { answer_text: `Could not ${action} that change: ${err.message}`, error: err.message } }])
    } finally {
      setIsResolvingPending(false)
    }
  }

  return (
    <div
      className="glass-panel-elevated"
      style={{
        position: 'sticky',
        bottom: 16,
        padding: 0,
        overflow: 'hidden',
        border: '1px solid rgba(var(--c-blue), 0.25)',
        boxShadow: '0 12px 32px rgba(var(--c-black),0.45)',
        // UX fix: sticky over the bills table as the page scrolls, so the
        // default --glass-bg-elevated (35% opacity) let table text bleed
        // through and collide with chat messages/answers. Same opaque
        // override pattern as Toast.jsx and ProjectSwitcher's dropdown.
        background: 'rgba(var(--c-surf-7), 0.97)',
      }}
    >
      {isExpanded && messages.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid rgba(var(--c-blue), 0.12)' }}>
          {messages.map((msg) => {
            if (msg.sender === 'system') {
              return (
                <div key={msg.id} style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)', background: 'rgba(var(--c-blue),0.08)', border: '1px solid rgba(var(--c-blue),0.18)', borderRadius: 'var(--radius-full)', padding: '4px 12px' }}>
                  <ArrowRightLeft size={11} />
                  {msg.text}
                </div>
              )
            }
            const isUser = msg.sender === 'user'
            return (
              <div
                key={msg.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '75%',
                  background: isUser ? 'rgba(var(--c-blue), 0.14)' : 'rgba(var(--c-surf-4), 0.9)',
                  border: `1px solid ${isUser ? 'rgba(var(--c-blue), 0.3)' : 'rgba(var(--c-blue), 0.15)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  lineHeight: 1.45,
                }}
              >
                {isUser ? (
                  msg.text
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(msg.data?.tool_call?.tool || msg.data?.data) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {msg.data?.tool_call?.tool ? (
                          <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>
                            Tool: {msg.data.tool_call.tool}
                          </span>
                        ) : msg.data?.data ? (
                          <span className="badge badge-cyan" style={{ fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Database size={10} /> From this project's own data
                          </span>
                        ) : null}
                        {_isPhase3FallbackAnswer(msg.data?.answer_text) && (
                          <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
                            No Phase 1 record -- from BOQ/WO baseline
                          </span>
                        )}
                      </div>
                    )}
                    <div>{msg.data?.answer_text}</div>
                    {_FREEFORM_DEGRADED_CAPTIONS[msg.data?.error] && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: '0.7rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                        <Info size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{_FREEFORM_DEGRADED_CAPTIONS[msg.data.error]}</span>
                      </div>
                    )}
                    {msg.data?.savings_pct !== null && msg.data?.savings_pct !== undefined && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(var(--c-overlay),0.06)', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
                        <span>Impact:</span>
                        <span>
                          {msg.data.savings_pct > 0 ? `-${msg.data.savings_pct.toFixed(1)}% savings` : `${Math.abs(msg.data.savings_pct).toFixed(1)}% increase`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Pending proposal -- Confirm/Discard */}
      {pending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', background: 'rgba(var(--c-violet), 0.08)', borderBottom: '1px solid rgba(var(--c-violet), 0.25)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--accent-violet-light)' }}>
            Pending: <strong>{pending.label}</strong>
            {pending.requires_engineering_review && <span className="badge badge-amber" style={{ fontSize: '0.6rem', marginLeft: 8 }}>Needs review</span>}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => resolvePending('reject')} disabled={isResolvingPending} className="btn-secondary" style={{ fontSize: '0.72rem', padding: '5px 10px' }}>
              <X size={12} /> Discard
            </button>
            <button onClick={() => resolvePending('confirm')} disabled={isResolvingPending} className="btn-primary" style={{ fontSize: '0.72rem', padding: '5px 10px' }}>
              <Check size={12} /> Confirm & Apply
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(var(--c-blue), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)', flexShrink: 0 }}>
          <Sparkles size={15} />
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        )}
        <form onSubmit={(e) => { e.preventDefault(); handleSend() }} style={{ display: 'flex', gap: 8, flex: 1 }}>
          <input
            type="text"
            placeholder={
              activeProjectId
                ? `Ask about ${activeProject?.project_name || 'this project'}, or mention another project by name...`
                : 'Mention a project by name to start, e.g. "how is Ecopolitan doing?"'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="form-input"
            disabled={isSending}
            style={{ fontSize: '0.8125rem', flex: 1 }}
          />
          <button type="submit" className="btn-primary" disabled={isSending || !input.trim()} style={{ padding: '0 16px' }}>
            <Send size={15} />
          </button>
        </form>
      </div>

      {chatTools && Object.keys(chatTools).length > 0 && messages.length === 0 && activeProjectId && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 12px 16px' }}>
          {Object.entries(chatTools).slice(0, 4).map(([toolName, info]) => (
            <button
              key={toolName}
              onClick={() => handleSend(info.example_question)}
              style={{ background: 'rgba(var(--c-overlay),0.04)', border: '1px solid rgba(var(--c-blue), 0.18)', borderRadius: 'var(--radius-full)', padding: '4px 10px', fontSize: '0.7rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {info.example_question}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
