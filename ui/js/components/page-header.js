import { escapeHtml } from '../utils.js';

export function pageHeader(title, subtitle, actions = '', extraClass = '') {
  const cls = ['page-header', 'card', extraClass].filter(Boolean).join(' ');
  return `
    <header class="${cls}">
      <div class="min-w-0">
        <h2 class="text-ellipsis">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="subtitle line-clamp-2 text-break">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="action-bar">${actions}</div>` : ''}
    </header>
  `;
}
