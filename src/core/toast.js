/** Non-blocking status messages. Replaces the v2 prototype's alert()s. */

import { el, $ } from './dom.js';

let stack;

function mount() {
  stack = stack || $('#toast-stack');
  return stack;
}

/**
 * @param {string} message      may contain <b> for emphasis
 * @param {object} [opts]
 * @param {'info'|'ok'|'warn'|'error'|'busy'} [opts.tone]
 * @param {number} [opts.duration]  ms; 0 keeps it until dismissed
 * @param {{label:string, run:() => void}[]} [opts.actions]  buttons; each closes the message
 * @returns {{ update: (msg:string, o?:object) => void, close: () => void }}
 */
export function toast(message, opts = {}) {
  const { tone = 'info', duration = tone === 'busy' ? 0 : 3600, actions = [] } = opts;
  const root = mount();
  if (!root) return { update() {}, close() {} };

  const body = el('div', { html: message, style: { flex: '1' } });
  const buttons = actions.length ? el('div.toast-actions', {}, actions.map(({ label, run }) => {
    const btn = el('button.toast-action', { type: 'button', text: label });
    btn.addEventListener('click', () => { close(); run(); });
    return btn;
  })) : null;
  const node = el(`div.toast.toast--${tone}`, {}, [
    tone === 'busy' ? el('span.spinner') : null,
    buttons ? el('div', { style: { flex: '1' } }, [body, buttons]) : body,
  ]);
  root.append(node);

  let timer = duration ? setTimeout(close, duration) : null;

  function close() {
    clearTimeout(timer);
    node.style.transition = 'opacity .18s, transform .18s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 190);
  }

  function update(msg, o = {}) {
    body.innerHTML = msg;
    if (o.tone) {
      node.className = `toast toast--${o.tone}`;
      const spinner = node.querySelector('.spinner');
      if (o.tone !== 'busy' && spinner) spinner.remove();
    }
    if (o.duration !== undefined) {
      clearTimeout(timer);
      timer = o.duration ? setTimeout(close, o.duration) : null;
    }
  }

  return { update, close };
}

export const notify = {
  info: (m, o) => toast(m, { ...o, tone: 'info' }),
  ok: (m, o) => toast(m, { ...o, tone: 'ok' }),
  warn: (m, o) => toast(m, { ...o, tone: 'warn' }),
  error: (m, o) => toast(m, { ...o, tone: 'error' }),
  busy: (m, o) => toast(m, { ...o, tone: 'busy' }),
};
