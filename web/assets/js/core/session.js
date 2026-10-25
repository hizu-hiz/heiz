/* Dashboard session on the browser side. The admin token lives in sessionStorage (this tab only, gone when the tab
   closes) and is sent as a Bearer header. The server also hands out an HttpOnly page cookie that gates the dashboard
   HTML itself; the cookie is never used as API authorisation. */
import { ApiError, api } from './http.js';
import { session } from './store.js';

const TOKEN = 'admin-token'; const FLASH = 'flash';
const DASHBOARD_URL = /^\/dashboard\/dashboard-[0-9a-f]{12}\.html$/;

export const getToken = () => session.get(TOKEN);
export const flash = (message) => session.set(FLASH, message);
export function takeFlash() { const m = session.get(FLASH); session.del(FLASH); return typeof m === 'string' ? m : ''; }

/** Verifies the token with the server. Resolves to the dashboard page URL (validated), or throws ApiError. */
export async function login(token) {
  const res = await api('/api/admin/session', { method: 'POST', token, retries: 0 });
  if (!res || typeof res.dashboard_url !== 'string' || !DASHBOARD_URL.test(res.dashboard_url)) {
    throw new ApiError(0, 'bad_response', 'The server answered with an unexpected dashboard address.', false);
  }
  session.set(TOKEN, token);
  return res.dashboard_url;
}

export async function signOut(message) {
  session.del(TOKEN);
  try { await api('/api/admin/session', { method: 'DELETE', retries: 0 }); } catch { /* the cookie also expires by itself */ }
  if (message) flash(message);
  location.replace('/dashboard/');
}

/** Authenticated call. A 401 means the token is gone or wrong: sign out and explain on the login page. */
export async function adminApi(path, opts = {}) {
  const token = getToken();
  if (!token) { await signOut('Please sign in.'); throw new ApiError(401, 'unauthorized', 'Signed out.', false); }
  try { return await api(path, { token, ...opts }); } catch (e) {
    if (e instanceof ApiError && e.status === 401) { await signOut('The token was rejected. Sign in again.'); }
    throw e;
  }
}
