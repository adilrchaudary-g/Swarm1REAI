import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion'

interface Props {
  value: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
  formatFn?: (n: number) => string
}

export default function AnimatedCounter({
  value, prefix = '', suffix = '', duration = 0.8, className = '', formatFn,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const prevValue = useRef(0)
  const [display, setDisplay] = useState(formatFn ? formatFn(0) : '0')

  useEffect(() => {
    const from = prevValue.current
    const to = value
    prevValue.current = value

    if (!ref.current || from === to) {
      setDisplay(formatFn ? formatFn(to) : to.toLocaleString())
      return
    }

    const controls = animate(from, to, {
      duration,
      ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
      onUpdate: (v) => {
        setDisplay(formatFn ? formatFn(Math.round(v)) : Math.round(v).toLocaleString())
      },
    })

    return () => controls.stop()
  }, [value, duration, formatFn])

  return (
    <span ref={ref} className={className}>
      {prefix}{display}{suffix}
    </span>
  )
}
