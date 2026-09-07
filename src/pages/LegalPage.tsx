import {appConfig} from '../config/env';

const pages = {
  privacy: {
    title: 'Privacy Policy',
    lead: 'WashRadar collects only the information needed to find nearby washes, validate queue contributions and run the features you choose.',
    sections: [
      ['Location', 'Location is used when you request nearby results, directions or queue validation. We do not continuously track you in the background. Queue reports retain a proximity result such as “nearby” or “remote”; exact coordinates are not shown publicly.'],
      ['Accounts and device data', 'Browsing does not require an account. If you sign in, Supabase Authentication stores your email and account identifier. A random device identifier helps enforce report cooldowns and one active queue timer; server systems store only a one-way hash.'],
      ['Analytics and advertising', 'Product analytics record feature events and coarse areas without an advertising identity. Sponsored content records impressions and clicks to prevent repetition and measure campaign performance. We do not sell precise location history.'],
      ['Retention and control', 'Operational reports expire from live calculations automatically. Aggregated historical statistics may remain without precise location data. You may request account deletion or correction through support.'],
    ],
  },
  terms: {
    title: 'Terms of Use',
    lead: 'WashRadar helps drivers compare nearby car washes. Information is provided for planning and may be incomplete or delayed.',
    sections: [
      ['Using WashRadar', 'Use the service lawfully and safely. Do not interact with the app while driving. Do not submit false reports, automate requests, bypass rate limits or interfere with other users.'],
      ['Queue, price and availability data', 'Queue times, total times, prices, ratings, hours and equipment status are estimates or third-party/user reports. They are not guarantees. Confirm important details with the business before travelling or buying.'],
      ['Directions and third parties', 'Directions and business information may be provided by third-party mapping and data providers under their own terms. WashRadar is not responsible for a business’s services or route conditions.'],
      ['Availability', 'Features may change or be suspended for maintenance, abuse prevention, legal compliance or provider limits.'],
    ],
  },
  sponsored: {
    title: 'Sponsored Content Disclosure',
    lead: 'WashRadar keeps paid promotion separate from its organic “Best Right Now” recommendation.',
    sections: [
      ['Clear labels', 'Paid placements use labels such as “Sponsored” or “Nearby offer.” A sponsored wash or business does not receive a better organic recommendation score.'],
      ['How ads are selected', 'Eligible campaigns may be selected by placement, coarse geography, relevance, campaign dates, priority and frequency caps. Ads normally rotate on a new screen or meaningful navigation.'],
      ['Measurement', 'We count impressions and clicks using limited session/account identifiers. Exact public GPS history is not attached to an ad report.'],
    ],
  },
  support: {
    title: 'Contact and Support',
    lead: 'Tell us about an incorrect listing, price, operational status, privacy request or technical problem.',
    sections: [
      ['Contact', 'Email ' + appConfig.supportEmail + '. Include the wash name and city when reporting listing data. Do not include sensitive personal information.'],
      ['Location permission', 'Location helps WashRadar sort nearby washes and validate queue reports. If you decline, search by city, postal code or address instead.'],
      ['Safety', 'Park safely before using WashRadar or submitting a report. For emergencies, contact local emergency services.'],
    ],
  },
} as const;

export function LegalPage({page}: {page: keyof typeof pages}) {
  const content = pages[page];
  return <article className="legal-page"><p className="eyebrow">WASHRADAR TRUST CENTRE</p><h1>{content.title}</h1><p className="legal-lead">{content.lead}</p><p className="legal-date">Effective September 7, 2026</p>{content.sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}</article>;
}
