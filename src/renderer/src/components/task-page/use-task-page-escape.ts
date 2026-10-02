import { useEffect } from 'react'
import { hasVisibleOverlay } from '@/lib/visible-overlay'

export function useTaskPageEscape(activeModal: string, closeTaskPage: () => void): void {
  useEffect(() => {
    if (activeModal !== 'none') {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasVisibleOverlay()) {
        return
      }
      const target = event.target
      if (target instanceof HTMLElement) {
        if (target.getAttribute('data-escape-clears-value') === 'true') {
          return
        }
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable ||
          target.matches('[contenteditable="true"], [contenteditable=""]')
        ) {
          event.preventDefault()
          target.blur()
          return
        }
      }
      event.preventDefault()
      closeTaskPage()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [activeModal, closeTaskPage])
}
