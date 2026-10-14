/**
 * Sign in with Google.
 *
 * Uses Google Identity Services: Google shows its own account chooser, the
 * person picks their Gmail, and Google hands this page a signed ID token
 * saying who they are. No password ever passes through the studio.
 *
 * It needs one thing the code cannot supply: an OAuth client ID, which is
 * issued to whoever runs the studio (Google Cloud Console → Credentials →
 * "OAuth client ID", type "Web application", with this site's address as an
 * authorised JavaScript origin). It goes in `.env` as VITE_GOOGLE_CLIENT_ID —
 * see `.env.example`. Until it is there, `googleConfigured()` is false and
 * the dialog says so instead of offering a button that cannot work.
 *
 * The token is handed straight to the account server, which checks its
 * signature against Google's published keys, its audience, issuer, expiry and
 * verified email before trusting any of it (server/account-server.mjs). The
 * helpers below that read a token are kept for tests and diagnostics only.
 */

const CLIENT_ID = (import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '').trim();
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const googleConfigured = () => Boolean(CLIENT_ID);

let loading = null;

/** Load Google's script once, on first use rather than with the page. */
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in did not load.')));
      script.onerror = () => { loading = null; reject(new Error('Could not reach Google. Check your connection and try again.')); };
      document.head.append(script);
    });
  }
  return loading;
}

/** The claims inside an ID token (the middle, base64url part of a JWT). */
export function decodeIdToken(token) {
  const part = String(token ?? '').split('.')[1];
  if (!part) throw new Error('Google returned an empty sign-in response.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Turn Google's claims into a profile, or say why they cannot be used.
 * @returns {{sub: string, email: string, name: string, picture: string}}
 */
export function profileFromClaims(claims, clientId = CLIENT_ID, now = Date.now()) {
  if (!claims?.sub || !claims.email) throw new Error('Google did not share an email address for this account.');
  if (claims.aud !== clientId) throw new Error('This Google sign-in was issued for a different application.');
  if (!ISSUERS.has(claims.iss)) throw new Error('This sign-in did not come from Google.');
  if (Number(claims.exp) * 1000 < now) throw new Error('This Google sign-in has expired. Please try again.');
  if (claims.email_verified === false || claims.email_verified === 'false') {
    throw new Error('Google has not verified this email address yet.');
  }
  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: claims.name || claims.given_name || String(claims.email).split('@')[0],
    picture: claims.picture || '',
  };
}

/**
 * Draw Google's own button into `container`. Google requires its button to
 * be the one it renders, so this cannot be a restyled one of ours.
 *
 * @param {HTMLElement} container
 * @param {{mode: 'signup'|'signin', width?: number,
 *          onCredential: (idToken: string) => void, onError: (message: string) => void}} opts
 */
export async function renderGoogleButton(container, { mode, width = 372, onCredential, onError }) {
  try {
    const google = await loadGoogle();
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      ux_mode: 'popup',
      callback: (response) => {
        if (response?.credential) onCredential(response.credential);
        else onError('Google did not complete the sign-in. Please try again.');
      },
    });
    container.replaceChildren();
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      logo_alignment: 'center',
      text: mode === 'signup' ? 'signup_with' : 'signin_with',
      width,
    });
  } catch (err) {
    onError(err.message);
  }
}
