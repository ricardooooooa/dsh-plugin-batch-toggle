/** Scoped theme-aware styles; no selectors modify the host's own elements. */
const css = `
[data-batch-toggle-toolbar]{padding:8px 4px;min-width:0;box-sizing:border-box;color:inherit}
section[data-plugin-panel]>header[data-window-drag]:has(>[data-batch-toggle-toolbar]){flex-wrap:wrap}
[data-batch-toggle-toolbar][data-batch-toggle-surface=plugins]{margin-inline-start:auto;max-width:min(100%,720px);padding:0;flex:0 1 auto}
.dbt-controls,.dbt-controls *,.dbt-panel,.dbt-panel *{-webkit-app-region:no-drag}
.dbt-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;min-width:0;font:inherit;color:inherit}
.dbt-buttons{display:flex;align-items:center;gap:6px;flex-shrink:0}
.dbt-status{min-width:0;flex:1;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280);overflow-wrap:anywhere}
.dbt-status[data-tone=error]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dbt-status[data-tone=warning],.dbt-warning{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dbt-panel{box-sizing:border-box;max-width:960px;padding:12px 4px 24px;color:var(--dsw-alias-label-primary,inherit);font:inherit;min-width:0}
.dbt-panel h2{font-size:17px;margin:0 0 10px;font-weight:600}
.dbt-panel h3{font-size:14px;margin:18px 0 8px;font-weight:600}
.dbt-description{font-size:13px;line-height:1.7;margin:0 0 14px}
.dbt-hint,.dbt-warning{font-size:12px;line-height:1.7;margin:10px 0;color:var(--dsw-alias-label-secondary,#6b7280)}
.dbt-warning{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dbt-counts{display:flex;gap:32px;flex-wrap:wrap;margin:18px 0}
.dbt-counts div{display:flex;align-items:baseline;gap:9px}
.dbt-counts dt{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dbt-counts dd{margin:0;font-size:17px;font-variant-numeric:tabular-nums}
.dbt-results ul,.dbt-details ul{list-style:none;padding:0;margin:8px 0}
.dbt-results li{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#80808030);overflow-wrap:anywhere}
.dbt-results li>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px}
.dbt-results li p{font-size:12px;line-height:1.6;margin:4px 0 0;color:var(--dsw-alias-label-secondary,#6b7280);white-space:pre-wrap}
.dbt-result-label{flex-shrink:0;color:var(--dsw-alias-label-secondary,#6b7280)}
[data-batch-toggle-result=failed] .dbt-result-label,[data-batch-toggle-result=overridden] .dbt-result-label{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dbt-details{font-size:12px;line-height:1.8;margin-top:14px;overflow-wrap:anywhere}
.dbt-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280)}
.dbt-panel code{font-size:12px;font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.dbt-menu-label{display:flex;flex-direction:column;gap:4px;white-space:normal;padding:4px 0}
.dbt-menu-label small{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}
@media(max-width:560px){.dbt-controls{gap:8px}.dbt-status{flex-basis:100%;order:3}.dbt-counts{gap:16px}.dbt-results li>div{flex-wrap:wrap;gap:4px}}
`

export function installStyles(document: Document): () => void {
  const style = document.createElement('style')
  style.setAttribute('data-batch-toggle-style', '')
  style.textContent = css
  document.head.append(style)
  return () => { style.remove() }
}
