import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import type { Proposal } from '../../../api/types'

export default function JarvisOrb({ proposals }: { proposals: Proposal[] }) {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  const pending = proposals.filter(p => !dismissed.has(p.id))
  const latest = pending[0]

  return (
    <div className="wr-jarvis">
      <AnimatePresence>
        {expanded && latest && (
          <motion.div
            className="wr-jarvis-bubble"
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 9, color: 'var(--wr-accent)', letterSpacing: 2, textTransform: 'uppercase' }}>
                {latest.agent_type}
              </span>
              <button
                onClick={() => { setDismissed(prev => new Set(prev).add(latest.id)); if (pending.length <= 1) setExpanded(false) }}
                style={{ background: 'none', border: 'none', color: 'var(--wr-text-ghost)', cursor: 'pointer', padding: 2 }}
              >
                <X size={12} />
              </button>
            </div>
            <div style={{ fontWeight: 600, color: 'var(--wr-text)', marginBottom: 4, fontSize: 13 }}>
              {latest.title}
            </div>
            {pending.length > 1 && (
              <div style={{ fontSize: 10, color: 'var(--wr-text-ghost)', fontFamily: 'var(--wr-font-mono)' }}>
                +{pending.length - 1} more
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className={`wr-jarvis-orb ${pending.length > 0 ? 'active' : ''}`}
        onClick={() => setExpanded(!expanded)}
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.95 }}
      >
        {pending.length > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            style={{
              position: 'absolute', top: -5, right: -5,
              background: 'var(--wr-hot)', color: 'white',
              fontFamily: 'var(--wr-font-mono)', fontSize: 9, fontWeight: 700,
              width: 20, height: 20, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px var(--wr-hot-glow)',
            }}
          >
            {pending.length}
          </motion.span>
        )}
      </motion.div>
    </div>
  )
}
