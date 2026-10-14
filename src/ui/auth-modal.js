/**
 * Sign up / sign in — one dialog that opens over the landing page.
 *
 * The page behind it is blurred rather than replaced, so it reads as a step
 * on the same screen, and closing it puts you back exactly where you were.
 */

import { $, el, fill } from '../core/dom.js';
import { signUp, signIn, signInWithGoogle } from '../core/auth.js';
import { googleConfigured, renderGoogleButton } from '../core/google.js';

let onEscape = null;

function close() {
  $('#auth-modal')?.classList.remove('is-open');
  $('#landing')?.classList.remove('is-blurred');
  if (onEscape) window.removeEventListener('keydown', onEscape);
  onEscape = null;
}

const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.6 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>';

/**
 * The Google half of the dialog.
 *
 * With a client ID this is Google's own button. Without one there is nothing
 * for it to talk to, so a stand-in says exactly what is missing — a dead
 * button would only look like a bug.
 */
function googleBlock(mode, hooks) {
  const message = el('span.auth-error', { role: 'alert' });
  const label = mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google';
  let slot;

  if (googleConfigured()) {
    slot = el('div.auth-google-slot', { 'aria-label': label });
    renderGoogleButton(slot, {
      mode,
      onCredential: async (credential) => {
        message.textContent = '';
        const result = await signInWithGoogle(credential);
        if (!result.ok) { message.textContent = result.error; return; }
        close();
        hooks.onDone(result.user);
      },
      onError: (text) => { message.textContent = text; },
    });
  } else {
    slot = el('button.auth-google-fallback', { type: 'button' }, [el('span', { html: GOOGLE_G }), label]);
    slot.addEventListener('click', () => {
      message.textContent = 'Google sign-in is not switched on yet. It needs a Google client ID in the studio’s .env file — see .env.example. You can use email and a password for now.';
    });
  }

  return el('div.auth-google', {}, [
    slot,
    message,
    el('div.auth-divider', {}, [el('span', { text: 'or with email' })]),
  ]);
}

function field({ id, label, type = 'text', placeholder = '', autocomplete, hint }) {
  const input = el('input.auth-input', { id, type, placeholder, autocomplete, required: true });
  const error = el('span.auth-error', { id: `${id}-error`, role: 'alert' });
  input.setAttribute('aria-describedby', `${id}-error`);
  return {
    input,
    error,
    node: el('div.auth-field', {}, [
      el('label', { for: id, text: label }),
      input,
      hint ? el('span.auth-hint', { text: hint }) : null,
      error,
    ]),
  };
}

/**
 * @param {'signup'|'signin'} mode
 * @param {{onDone: (user: object) => void}} hooks
 */
export function openAuthModal(mode, hooks) {
  const modal = $('#auth-modal');
  if (!modal) return;
  const signingUp = mode === 'signup';

  const name = field({ id: 'auth-name', label: 'Full name', autocomplete: 'name' });
  const email = field({ id: 'auth-email', label: 'Email address', type: 'email', placeholder: 'you@organisation.org', autocomplete: 'email' });
  const password = field({
    id: 'auth-password', label: 'Password', type: 'password',
    autocomplete: signingUp ? 'new-password' : 'current-password',
    hint: signingUp ? 'At least 8 characters.' : '',
  });
  const fields = { name, email, password };

  const submit = el('button.auth-submit', { type: 'submit', text: signingUp ? 'Create account' : 'Sign in' });

  const form = el('form.auth-form', { novalidate: true }, [
    signingUp ? name.node : null,
    email.node,
    password.node,
    submit,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    Object.values(fields).forEach((f) => { f.error.textContent = ''; f.input.removeAttribute('aria-invalid'); });
    submit.disabled = true;
    submit.textContent = signingUp ? 'Creating your account…' : 'Signing in…';

    const credentials = { name: name.input.value, email: email.input.value, password: password.input.value };
    let result;
    try {
      result = await (signingUp ? signUp(credentials) : signIn(credentials));
    } catch (err) {
      console.error('[auth]', err);
      result = { ok: false, field: 'password', error: 'Something went wrong. Please try again.' };
    }

    if (result.ok) {
      close();
      hooks.onDone(result.user);
      return;
    }
    submit.disabled = false;
    submit.textContent = signingUp ? 'Create account' : 'Sign in';
    const target = fields[result.field] ?? password;
    target.error.textContent = result.error;
    target.input.setAttribute('aria-invalid', 'true');
    target.input.focus();
  });

  const swap = el('button.auth-link', { type: 'button', text: signingUp ? 'Sign in' : 'Create a free account' });
  swap.addEventListener('click', () => openAuthModal(signingUp ? 'signin' : 'signup', hooks));

  const closeBtn = el('button.auth-close', { type: 'button', 'aria-label': 'Close', html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
  closeBtn.addEventListener('click', close);

  const dialog = el('div.auth-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title' }, [
    closeBtn,
    el('h2#auth-title', { text: signingUp ? 'Create your account' : 'Welcome back' }),
    el('p.auth-sub', { text: signingUp ? 'Free to start. Your maps are saved as you work.' : 'Sign in to open your maps.' }),
    googleBlock(mode, hooks),
    form,
    el('p.auth-swap', {}, [signingUp ? 'Already have an account? ' : 'New here? ', swap]),
    el('p.auth-note', { text: 'Your maps are saved to your account, and open on any computer you sign in from.' }),
  ]);

  fill(modal, [dialog]);
  modal.classList.add('is-open');
  $('#landing')?.classList.add('is-blurred');
  modal.onclick = (event) => { if (event.target === modal) close(); };

  if (onEscape) window.removeEventListener('keydown', onEscape);
  onEscape = (event) => { if (event.key === 'Escape') close(); };
  window.addEventListener('keydown', onEscape);

  (signingUp ? name.input : email.input).focus();
}
