// 通用 DOM 工具
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | boolean | number | ((e: Event) => void)> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as (e: Event) => void);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 2600) {
  let wrap = document.querySelector('.toast-wrap') as HTMLElement | null;
  if (!wrap) { wrap = h('div', { class: 'toast-wrap' }); document.body.append(wrap); }
  const t = h('div', { class: `toast ${kind === 'info' ? '' : kind}` }, msg);
  wrap.append(t);
  setTimeout(() => t.remove(), ms);
}

export function download(filename: string, content: string | Blob, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename }) as HTMLAnchorElement;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
