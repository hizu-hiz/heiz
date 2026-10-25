/* Start-up check run behind the splash screen: is the service up, is the database reachable, can events be loaded?
   The free database sleeps and drops, so this waits (politely, every few seconds) but never traps the visitor:
   they can continue at any time, and after maxWaitMs the page opens with saved data or an explanation. */
import { checkStatus, fetchRecent, loadCached } from './earthquakes.js';

export async function boot(splash, { maxWaitMs = 15_000, retryEveryMs = 3_000 } = {}) {
  const started = Date.now();
  const cached = loadCached();
  const degraded = (status, extra = {}) => ({
    mode: cached ? 'cached' : 'offline', status, events: cached ? cached.events : [], savedAt: cached ? cached.savedAt : null, ...extra });

  splash.step('Contacting the service', '');
  for (;;) {
    const status = await checkStatus();
    splash.check('service', status.api === 'unreachable' ? 'bad' : 'ok');

    if (status.api === 'unreachable') {
      splash.check('database', 'skip'); splash.check('events', 'skip');
      splash.step('The service is not reachable', 'Check your connection. Trying again shortly.');
    } else if (status.database === 'ok') {
      splash.check('database', 'ok'); splash.step('Loading recent earthquakes', '');
      try {
        const events = await fetchRecent();
        splash.check('events', 'ok'); splash.step('Ready', '');
        return { mode: 'live', status, events };
      } catch (error) {
        splash.check('events', 'bad');
        return degraded(status, { error });
      }
    } else if (status.database === 'not_configured') {
      splash.check('database', 'bad'); splash.check('events', 'skip');
      splash.step('No database is configured', 'This server has no DATABASE_URL. Showing what this device has saved.');
      return degraded(status);
    } else {
      splash.check('database', 'bad'); splash.check('events', 'skip');
      splash.step('Waking the database', 'The free database tier can take a moment to respond. Checking again automatically.');
    }

    splash.offerChoices({ canUseSaved: !!cached });
    if (Date.now() - started > maxWaitMs) return degraded(status);
    const outcome = await splash.waitOrAction(Math.max(retryEveryMs, (status.retry_after_seconds || 0) * 1000 / 4));
    if (outcome === 'skip') return degraded(status);
  }
}
