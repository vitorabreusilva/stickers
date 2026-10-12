import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A stack of screens layered over the home screen, mirrored into browser history so the
 * Android back button and back gestures close the top screen.
 */
export function useNavStack<T>() {
  const [stack, setStack] = useState<T[]>([])
  const stackRef = useRef<T[]>([])

  const commit = (next: T[]) => {
    stackRef.current = next
    setStack(next)
  }

  useEffect(() => {
    // Screens hold live objects (decoded images) that don't survive a reload, so start at home.
    history.replaceState({ depth: 0 }, '')
    const onPop = (event: PopStateEvent) => {
      const depth = typeof event.state?.depth === 'number' ? event.state.depth : 0
      if (depth < stackRef.current.length) commit(stackRef.current.slice(0, depth))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const push = useCallback((screen: T) => {
    const next = [...stackRef.current, screen]
    history.pushState({ depth: next.length }, '')
    commit(next)
  }, [])

  const back = useCallback(() => {
    if (stackRef.current.length > 0) history.back()
  }, [])

  const home = useCallback(() => {
    const depth = stackRef.current.length
    if (depth > 0) history.go(-depth)
  }, [])

  return { stack, push, back, home }
}
