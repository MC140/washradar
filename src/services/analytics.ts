import {appConfig, hasSupabaseConfiguration} from '../config/env';

export type AnalyticsEvent =
  | 'app_opened'
  | 'search'
  | 'location_granted'
  | 'wash_viewed'
  | 'directions_clicked'
  | 'best_right_now_selected'
  | 'queue_report_started'
  | 'queue_report_completed'
  | 'wash_type_reported'
  | 'queue_session_started'
  | 'queue_session_completed'
  | 'favourite'
  | 'alert_created'
  | 'rating_submitted'
  | 'auth_signed_in'
  | 'account_created'
  | 'support_viewed'
  | 'ad_impression'
  | 'ad_click';

type Properties = Record<string, string | number | boolean | null>;
type PendingEvent = {name: AnalyticsEvent; properties: Properties; at: string};

const MAX_BATCH = 8;
const FLUSH_AFTER_MS = 12_000;

class AnalyticsService {
  private pending: PendingEvent[] = [];
  private timer: number | undefined;
  private flushing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.pending.length) void this.flush();
      });
    }
  }

  track(name: AnalyticsEvent, properties: Properties = {}) {
    const trafficType = typeof navigator !== 'undefined' && navigator.webdriver ? 'synthetic' : 'user';
    const detail: PendingEvent = {
      name,
      properties: {...properties, trafficType},
      at: new Date().toISOString(),
    };
    window.dispatchEvent(new CustomEvent('washradar:analytics', {detail}));

    if (appConfig.demoMode || !hasSupabaseConfiguration) return;
    this.pending.push(detail);

    if (this.pending.length >= MAX_BATCH) {
      void this.flush();
      return;
    }

    if (this.timer === undefined) {
      this.timer = window.setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, FLUSH_AFTER_MS);
    }
  }

  private clientId() {
    let id = localStorage.getItem('wr-client-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('wr-client-id', id);
    }
    return id;
  }

  async flush() {
    if (this.flushing || !this.pending.length || appConfig.demoMode || !hasSupabaseConfiguration) return;
    this.flushing = true;
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }

    const events = this.pending.splice(0, MAX_BATCH);
    try {
      await fetch(appConfig.supabaseUrl + '/functions/v1/analytics-events', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: appConfig.supabasePublishableKey,
          Authorization: 'Bearer ' + appConfig.supabasePublishableKey,
        },
        body: JSON.stringify({clientId: this.clientId(), events}),
      });
    } catch {
      // Analytics must never block the user experience. Failed telemetry is dropped
      // rather than creating retry loops that could increase cost or network usage.
    } finally {
      this.flushing = false;
      if (this.pending.length) {
        if (this.pending.length >= MAX_BATCH) void this.flush();
        else if (this.timer === undefined) {
          this.timer = window.setTimeout(() => {
            this.timer = undefined;
            void this.flush();
          }, FLUSH_AFTER_MS);
        }
      }
    }
  }
}

export const analytics = new AnalyticsService();

export const logger = {
  error(error: unknown, context: Properties = {}) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    window.dispatchEvent(new CustomEvent('washradar:error', {detail: {message, context, at: new Date().toISOString()}}));
  },
};
