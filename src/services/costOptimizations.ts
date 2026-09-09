import {repository} from './index';

let installed = false;

/**
 * Reduce background Supabase work without changing queue semantics.
 *
 * Realtime can fan one queue change out to every connected browser. Previously each
 * event immediately triggered a complete application refresh. We now coalesce bursts,
 * do no refresh work while the tab is hidden, and perform one catch-up refresh when
 * the user returns. The Realtime subscription itself remains active, so live behavior
 * is preserved while visible.
 */
export function installCostOptimizations() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalSubscribe = repository.subscribe.bind(repository);

  repository.subscribe = (onChange: () => void) => {
    let timer: number | undefined;
    let dirtyWhileHidden = false;
    let disposed = false;
    let lastRunAt = 0;

    const run = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') {
        dirtyWhileHidden = true;
        return;
      }
      dirtyWhileHidden = false;
      lastRunAt = Date.now();
      onChange();
    };

    const coalesce = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') {
        dirtyWhileHidden = true;
        return;
      }

      if (timer !== undefined) window.clearTimeout(timer);
      const sinceLastRun = Date.now() - lastRunAt;
      const delay = Math.max(650, 2_000 - sinceLastRun);
      timer = window.setTimeout(() => {
        timer = undefined;
        run();
      }, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && dirtyWhileHidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = undefined;
          run();
        }, 250);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = originalSubscribe(coalesce);

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  };
}
