import { useEffect, useRef, useState } from 'react'
import SigPad from 'signature_pad'

interface Props {
  onSign: (dataUrl: string) => void
  width?: number
  height?: number
}

export function SignaturePad({ onSign, width = 500, height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SigPad | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = width * 2
    canvas.height = height * 2
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(2, 2)

    const pad = new SigPad(canvas, {
      penColor: '#e2e8f0',
      backgroundColor: 'rgba(0,0,0,0)',
      minWidth: 1.5,
      maxWidth: 3,
    })
    padRef.current = pad

    pad.addEventListener('endStroke', () => setIsEmpty(pad.isEmpty()))

    return () => { pad.off(); pad.clear() }
  }, [width, height])

  const clear = () => {
    padRef.current?.clear()
    setIsEmpty(true)
  }

  const confirm = () => {
    if (!padRef.current || padRef.current.isEmpty()) return
    const dataUrl = padRef.current.toDataURL('image/png')
    onSign(dataUrl)
  }

  return (
    <div>
      <div style={{
        border: '2px dashed rgba(255,255,255,0.15)',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}>
        <canvas ref={canvasRef} style={{ cursor: 'crosshair', display: 'block' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={clear}
          style={{
            flex: 1, padding: '8px 16px', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
            cursor: 'pointer', fontSize: 13,
          }}
        >Clear</button>
        <button
          onClick={confirm}
          disabled={isEmpty}
          style={{
            flex: 2, padding: '8px 16px', border: 'none', borderRadius: 6,
            background: isEmpty ? '#334155' : '#4f46e5', color: isEmpty ? '#64748b' : '#fff',
            cursor: isEmpty ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >Confirm Signature</button>
      </div>
    </div>
  )
}
