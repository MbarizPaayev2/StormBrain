import io, sys
css = io.open('storm-web/assets/css/panel.css', encoding='utf-8').read()
need = ['.kpi-strip', '.kpi-tile', '.dash-split', '.quick-card', '.quick-grid',
        '.map-legend', '.map-tools', '.scroll-tall', '.dash-empty', '.loc-row',
        '.map-layout', '.map-side', '.location-stat-row', '.dash-card-tools',
        '.btn-refresh', '.tpl-count', '.soc-page-head', '.soc-eyebrow',
        '.soc-chip', '.soc-h1', '.soc-sub', '.soc-live-dot', '.soc-btn',
        '.kpi-value', '.kpi-label', '.kpi-note', '.kpi-badge', '.kpi-ico',
        '.map-btn', '.map-count', '.dot-gps', '.dot-ip', '.dot-grid',
        '.map-body', '.map-card', '.quick-ico', '.quick-name', '.quick-desc',
        '.quick-tile', '.loc-kind', '.loc-coords', '.loc-info', '.loc-time',
        '.loc-locate', '.loc-row-top', '.loc-row-bottom']
missing = [c for c in need if c not in css]
print('missing in panel.css:', missing)
