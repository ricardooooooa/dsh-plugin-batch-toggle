/** Adds owned controls at the end of the official header or top of a standalone market. */
export function observePlacements(document: Document, changed: (targets: HTMLElement[]) => void): () => void {
  const owned = new Map<Element, HTMLElement>()
  let previous: HTMLElement[] = []
  let disposed = false
  const reconcile = () => {
    if (disposed) return
    const desired = new Map<Element, { before: Element | null; surface: string }>()
    for (const panel of document.querySelectorAll('section[data-plugin-panel]')) {
      const header = panel.querySelector(':scope > header[data-window-drag]')
      if (header !== null) desired.set(header, { before: null, surface: 'plugins' })
    }
    for (const market of document.querySelectorAll('[data-dsh-market-root]:not([data-dsh-market-crashed])')) {
      if (market.closest('[data-plugin-panel]') === null) {
        desired.set(market, { before: null, surface: 'market' })
      }
    }
    for (const [parent, host] of owned) {
      if (!desired.has(parent) || !parent.isConnected) {
        host.remove()
        owned.delete(parent)
      }
    }
    for (const [parent, placement] of desired) {
      let host = owned.get(parent)
      // Another active mount owns its toolbar. Never take over its React root.
      if (host === undefined && [...parent.children].some(child => child.hasAttribute('data-batch-toggle-toolbar'))) continue
      if (host === undefined) {
        host = document.createElement('div')
        host.setAttribute('data-batch-toggle-toolbar', '')
        host.setAttribute('data-batch-toggle-surface', placement.surface)
        host.setAttribute('data-window-no-drag', '')
        host.style.setProperty('-webkit-app-region', 'no-drag')
        host.style.flexShrink = placement.surface === 'plugins' ? '1' : '0'
        owned.set(parent, host)
      }
      const before = placement.surface === 'plugins' ? placement.before : parent.firstElementChild
      if (host.parentElement !== parent || (before !== host && host.nextElementSibling !== before)) {
        parent.insertBefore(host, before)
      }
    }
    const next = [...owned.values()]
    if (next.length !== previous.length || next.some((host, index) => host !== previous[index])) {
      previous = next
      changed(next)
    }
  }
  const Observer = document.defaultView?.MutationObserver
  if (Observer === undefined) return () => {}
  const observer = new Observer(reconcile)
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-plugin-panel', 'data-window-drag', 'data-dsh-market-root', 'data-dsh-market-crashed'],
  })
  reconcile()
  return () => {
    disposed = true
    observer.disconnect()
    for (const host of owned.values()) host.remove()
    owned.clear()
  }
}
