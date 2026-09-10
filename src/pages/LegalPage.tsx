import {appConfig} from '../config/env';

const pages = {
  privacy: {
    title: 'Privacy Policy',
    lead: 'WashRadar collects only the information needed to find nearby washes, validate queue contributions and run the features you choose.',
    sections: [
      ['Location', 'Location is used when you request nearby results, directions or queue validation. We do not continuously track you in the background. Queue reports retain a proximity result such as “nearby” or “remote”; exact coordinates are not shown publicly.'],
      ['Accounts and device data', 'Browsing does not require an account. If you sign in, Supabase Authentication stores your email and account identifier. A random device identifier helps enforce report cooldowns and one active queue timer; server systems store only a one-way hash.'],
      ['Analytics and advertising', 'Product analytics record feature events and coarse areas without an advertising identity. Sponsored content records impressions and clicks to prevent repetition and measure campaign performance. We do not sell precise location history.'],
      ['Retention and control', 'Operational reports expire from live calculations automatically. When an account is deleted, account/profile data is removed and contribution records that must remain for queue integrity may be retained only in de-identified form. Signed-in users can start permanent account deletion from Profile; the same instructions are available at /account-deletion.'],
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
  accountDeletion: {
    title: 'Delete Your WashRadar Account',
    lead: 'WashRadar lets you permanently delete a signed-in account from inside the product.',
    sections: [
      ['Delete in the app', 'Sign in, open Profile, go to Account & privacy, choose Delete account, review the warning and confirm permanent deletion. You will be signed out after the deletion finishes.'],
      ['What is deleted', 'Your Supabase authentication account and account-owned profile, favourites, queue targets, challenge progress, Radar Points and saved vehicle data are deleted.'],
      ['De-identified contribution history', 'Queue and wash-type observations may remain without your account identifier when needed to preserve aggregate queue integrity, abuse prevention and historical statistics. They are no longer attached to your deleted account.'],
      ['Need help?', 'If self-service deletion cannot complete, contact ' + appConfig.supportEmail + ' from the email associated with the account. Business-owner accounts may require support so active business records are not accidentally removed.'],
    ],
  },
} as const;

export function LegalPage({page}: {page: keyof typeof pages}) {
  const content = pages[page];
  return <article className="legal-page"><p className="eyebrow">WASHRADAR TRUST CENTRE</p><h1>{content.title}</h1><p className="legal-lead">{content.lead}</p><p className="legal-date">Effective September 10, 2026</p>{content.sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}</article>;
}
