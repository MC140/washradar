# Organic search and AI discovery
The production host is https://washradar.ca/. The build generates the homepage metadata, static guides, robots.txt, sitemap.xml and optional llms.txt. No real-time queue data or fake reviews are embedded in guides. Static pages use first-party explanations and are readable without JavaScript; the app remains the source of changing data.

## Production release gate
- Run npm run check. Verify /, /car-wash/, /car-wash/toronto/, /car-wash/how-it-works/, /robots.txt and /sitemap.xml return HTTP 200 with the expected content type, canonical and visible HTML. Verify canonical host/redirects and CDN permits legitimate Googlebot, Bingbot and OAI-SearchBot traffic. Check preview deployments are not indexed.
- Confirm normal app navigation, ads, sign-in and location workflows remain unchanged.
- Verify Google Search Console domain property via DNS or an existing verified owner, then submit https://washradar.ca/sitemap.xml and inspect the homepage and guide hub. Do not use Google's Indexing API for ordinary web pages.
- Verify Bing Webmaster Tools, submit the sitemap, optionally configure IndexNow with a real ownership key and submit changed canonical URLs after deployment. Submission does not guarantee indexing.
- Monitor indexed pages, impressions, clicks, non-branded search queries and organic-to-app conversion. Track ChatGPT referral traffic where available. llms.txt is informational, not a guarantee of AI inclusion.

## Authority and useful content
Seek genuine editorial mentions from GTA auto clubs, local publications and relevant community groups. Be transparent about affiliation, follow community rules, and do not buy links or manufacture reviews. Offer useful findings only when aggregated real observations justify them. Avoid thin city duplicates, fabricated listings, fake review markup and unsupported live claims. Consider real location-specific directory pages once publishable verified catalogue data is available.
