import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function EndBrewConfirmation({ dark, ending, onCancel, onConfirm }: {
  dark: boolean
  ending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { requestAnimationFrame(() => cancelRef.current?.focus()) }, [])

  return createPortal(
    <div className="end-brew-confirm-backdrop" data-theme={dark ? 'dark' : 'light'} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section aria-labelledby="end-brew-title" aria-modal="true" className="end-brew-confirm" role="alertdialog">
        <span>End active brew</span>
        <h2 className="modal-title modal-title--confirmation" id="end-brew-title">Save this brew now?</h2>
        <p>The current timer, weights, and trace will be saved as an early completion.</p>
        <div>
          <button className="end-brew-confirm__cancel" onClick={onCancel} ref={cancelRef} type="button">Keep brewing</button>
          <button className="end-brew-confirm__end" disabled={ending} onClick={onConfirm} type="button">{ending ? 'Saving…' : 'End and save'}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
