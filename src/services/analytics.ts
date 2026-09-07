export type AnalyticsEvent =
  | 'app_opened'
  | 'search'
  | 'location_granted'
  | 'wash_viewed'
  | 'directions_clicked'
  | 'best_right_now_selected'
  | 'queue_report_started'
  | 'queue_report_completed'
  | 'queue_session_started'
  | 'queue_session_completed'
  | 'favourite'
  | 'alert_created'
  | 'ad_impression'
  | 'ad_click';

type Properties = Record<string, string | number | boolean | null>;

class AnalyticsService {
  track(name: AnalyticsEvent, properties: Properties = {}) {
    const detail = {name, properties, at: new Date().toISOString()};
    window.dispatchEvent(new CustomEvent('washradar:analytics', {detail}));
    if (!appConfig.demoMode && hasSupabaseConfiguration) {
      let id = localStorage.getItem('wr-client-id');
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('wr-client-id', id); }
      void fetch(appConfig.supabaseUrl + '/functions/v1/analytics-events', {
        method: 'POST',
        keepalive: true,
        headers: {'Content-Type': 'application/json', apikey: appConfig.supabasePublishableKey},
        body: JSON.stringify({...detail, clientId: id}),
      }).catch(() => undefined);
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
import {appConfig, hasSupabaseConfiguration} from '../config/env';
