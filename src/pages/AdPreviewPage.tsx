import {ArrowUpRight, Car, Clock3, Droplets, MapPin, Megaphone, MousePointer2, Navigation, ShieldCheck} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import './ad-preview.css';

type PreviewAdSpec = {
  placement: string;
  businessName: string;
  headline: string;
  body: string;
  callToAction: string;
  distance: string;
};

const topOffer: PreviewAdSpec = {
  placement: 'A · Decision-area offer',
  businessName: 'Maple Bean Coffee',
  headline: 'Coffee while you wait — 10% off nearby',
  body: 'A local offer shown after WashRadar makes the wash decision, never inside the organic ranking.',
  callToAction: 'View offer',
  distance: '0.4 km away',
};

const feedOfferOne: PreviewAdSpec = {
  placement: 'B · Results-feed offer',
  businessName: 'TireNest Auto Care',
  headline: 'Free tire-pressure check today',
  body: 'A clearly sponsored local offer inserted after several organic wash results.',
  callToAction: 'See details',
  distance: '1.1 km away',
};

const feedOfferTwo: PreviewAdSpec = {
  placement: 'C · Deep-feed offer',
  businessName: 'DetailDrop',
  headline: '$15 off an interior refresh',
  body: 'This second feed position demonstrates a longer session. Production frequency can be capped much lower.',
  callToAction: 'Claim offer',
  distance: '2.3 km away',
};

const detailOffer: PreviewAdSpec = {
  placement: 'D · Wash-detail offer',
  businessName: 'FreshBite Café',
  headline: 'Breakfast combo while your car gets clean',
  body: 'Placed after the wash decision and timing section, before secondary detail content.',
  callToAction: 'View menu',
  distance: '0.3 km away',
};

const previewWashes = [
  ['Esso Car Wash', '5.2 km', '8m', 'Open now'],
  ['Pioneer Wash', '6.1 km', '—', 'Open now'],
  ['Shell Car Wash', '6.8 km', '12m', 'Open now'],
  ['Auto Spa', '7.4 km', '5m', 'Hours unknown'],
  ['Splash Works', '8.2 km', '—', 'Open now'],
  ['Clean Ride', '8.9 km', '16m', 'Open now'],
  ['Quick Shine', '9.5 km', '7m', 'Open now'],
  ['Parkway Wash', '10.1 km', '—', 'Open now'],
  ['Wash Station', '10.8 km', '11m', 'Open now'],
  ['Northside Auto Wash', '11.4 km', '4m', 'Open now'],
  ['City Suds', '12.0 km', '—', 'Hours unknown'],
  ['Clear Coat Wash', '12.7 km', '9m', 'Open now'],
];

export function AdPreviewPage() {
  const [scrollPercent, setScrollPercent] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const tick = window.setInterval(() => setSessionSeconds((performance.now() - started) / 1000), 250);
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setScrollPercent(Math.min(100, Math.max(0, (window.scrollY / max) * 100)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('resize', onScroll);
    return () => {
      clearInterval(tick);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return <div className="ad-preview-page">
    <div className="ad-preview-hud" aria-live="polite">
      <strong>AD PREVIEW</strong>
      <span>{scrollPercent.toFixed(0)}% scrolled</span>
      <span>{sessionSeconds.toFixed(1)}s on preview</span>
      <Link to="/">Exit preview</Link>
    </div>

    <section className="ad-preview-intro">
      <p className="eyebrow">MONETIZATION UX LAB</p>
      <h1>See exactly where sponsored offers would appear.</h1>
      <p>This page uses dummy businesses only. Scroll normally. Every sponsored block shows how much of it is visible and how many seconds it has been at least 50% on screen. No ad impressions or clicks are recorded.</p>
      <div className="ad-preview-jumps">
        <a href="#explore-preview">Explore placement</a>
        <a href="#feed-preview">Feed placement</a>
        <a href="#detail-preview">Detail placement</a>
      </div>
      <div className="ad-preview-rule"><ShieldCheck size={17} /><span><b>Ranking stays untouched.</b> Sponsored offers never become “Best Right Now” and never masquerade as wash results.</span></div>
    </section>

    <section id="explore-preview" className="ad-preview-stage">
      <div className="ad-preview-stage-label"><span>SCREEN 1</span><strong>Explore / decision flow</strong></div>
      <section className="ad-preview-hero">
        <div><p className="eyebrow">A CLEAN CAR. A CLEAR ROUTE.</p><h2>Where should you wash your car <em>right now?</em></h2><p>Compare the drive, queue, wash time and price when data is available.</p></div>
        <button><Navigation size={16} /> Use my location</button>
      </section>
      <div className="ad-preview-search"><span>Search city, postal code or address</span><b>Filters</b></div>
      <div className="ad-preview-chips"><span>All washes</span><span>Touchless</span><span>Soft cloth</span><span>Tunnel</span><span>Self serve</span></div>

      <div className="ad-preview-recommend">
        <PreviewWashCard featured name="Esso Car Wash" distance="5.2 km" queue="8m" status="Open now" />
        <aside><p className="eyebrow">THE DECISION, MADE CLEAR</p><h2>Best is more than closest.</h2><p>WashRadar weighs drive time, queue, wash time and data confidence. Paid placements never change this result.</p><div><ShieldCheck size={16} /> Organic decision first</div></aside>
      </div>
      <div className="ad-preview-decisions"><span><small>FASTEST KNOWN</small><b>Esso Car Wash</b></span><span><small>CHEAPEST KNOWN</small><b>Price data needed</b></span><span><small>CLOSEST</small><b>5.2 km</b></span></div>

      <PreviewAd ad={topOffer} />
    </section>

    <section id="feed-preview" className="ad-preview-stage">
      <div className="ad-preview-stage-label"><span>SCREEN 2+</span><strong>Nearby results feed</strong></div>
      <div className="ad-preview-results-head"><h2>Nearby washes <span>42</span></h2><b>Recommended ▾</b></div>
      <div className="ad-preview-grid">
        {previewWashes.map(([name, distance, queue, status], index) => <div className="ad-preview-grid-item" key={name}>
          <PreviewWashCard name={name} distance={distance} queue={queue} status={status} />
          {index === 3 && <div className="ad-preview-feed-slot"><PreviewAd ad={feedOfferOne} /></div>}
          {index === 9 && <div className="ad-preview-feed-slot"><PreviewAd ad={feedOfferTwo} /></div>}
        </div>)}
      </div>
      <p className="ad-preview-frequency-note"><Megaphone size={15} /> This preview intentionally shows both possible in-feed positions. For launch, I recommend a frequency cap such as <b>no more than one in-feed sponsored offer per 8–10 organic wash cards</b>.</p>
    </section>

    <section id="detail-preview" className="ad-preview-stage ad-preview-detail-stage">
      <div className="ad-preview-stage-label"><span>DETAIL PAGE</span><strong>After the wash decision</strong></div>
      <div className="ad-preview-detail-card">
        <div className="ad-preview-detail-title"><div><p className="eyebrow">YOUR WASH DECISION</p><h2>Esso Car Wash</h2><p><MapPin size={14} /> 123 Main Street · Milton</p></div><button>Save</button></div>
        <div className="ad-preview-detail-status"><b>OPEN</b><span>★ 4.3 (218)</span></div>
        <div className="ad-preview-detail-wait"><span><small>CURRENT WAIT</small><b>8 min</b></span><span><small>DATA STATUS</small><b>RECENT REPORT</b></span><span><small>CONFIDENCE</small><b>Medium</b></span></div>
        <div className="ad-preview-detail-equation"><span><Car size={18} /><small>DRIVE</small><b>11 min</b></span><i>+</i><span><Clock3 size={18} /><small>WAIT</small><b>8 min</b></span><i>+</i><span><Droplets size={18} /><small>WASH EST.</small><b>~6 min</b></span><i>=</i><span><small>DONE IN</small><b>~25 min</b></span></div>
        <div className="ad-preview-detail-actions"><button><Navigation size={15} /> Directions</button><button>Update queue</button><button>Join queue</button><button>Alert me</button></div>
      </div>
      <PreviewAd ad={detailOffer} />
      <div className="ad-preview-after-detail"><div><small>WASH OPTIONS</small><h3>Packages and prices</h3></div><div><small>LOCATION DETAILS</small><h3>Before you go</h3></div></div>
    </section>

    <section className="ad-preview-summary">
      <MousePointer2 size={22} />
      <div><h2>What to judge while scrolling</h2><p>Does the ad interrupt the decision? Does it look too similar to an organic wash? Is the spacing comfortable? Is one feed ad enough? The live view-time counters above help us see whether placements naturally stay on screen or disappear too quickly.</p></div>
    </section>
  </div>;
}

function PreviewWashCard({name, distance, queue, status, featured = false}: {name: string; distance: string; queue: string; status: string; featured?: boolean}) {
  return <article className={'ad-preview-wash-card ' + (featured ? 'featured' : '')}>
    <div className="ad-preview-card-top"><span>{featured ? '✦ BEST AVAILABLE ESTIMATE' : '◉'}</span><button>♡</button></div>
    <div className="ad-preview-card-heading"><div><h3>{name}</h3><p><MapPin size={13} /> {distance} away</p></div><div className="ad-preview-queue"><b>{queue}</b><small>{queue === '—' ? 'queue unknown' : 'min queue'}</small><button><Navigation size={12} /> Directions</button></div></div>
    <div className="ad-preview-tags"><span>Wash type unknown</span><span>Price unknown</span><span>{status}</span></div>
    <div className="ad-preview-times"><span><Car size={14} /><b>11m</b><small>Drive</small></span><span><Clock3 size={14} /><b>{queue}</b><small>Queue</small></span><span><Droplets size={14} /><b>~6m</b><small>Wash est.</small></span><span><b>{queue === '—' ? '—' : '~25m'}</b><small>Done in</small></span></div>
    <div className="ad-preview-card-actions"><button>Update queue</button><button>Details</button></div>
  </article>;
}

function PreviewAd({ad}: {ad: PreviewAdSpec}) {
  const ref = useRef<HTMLElement | null>(null);
  const [ratio, setRatio] = useState(0);
  const [viewableSeconds, setViewableSeconds] = useState(0);
  const [screensFromTop, setScreensFromTop] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      setScreensFromTop(window.innerHeight ? top / window.innerHeight : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new IntersectionObserver(([entry]) => setRatio(entry?.intersectionRatio ?? 0), {threshold: [0, .25, .5, .75, 1]});
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (ratio < .5) return;
    const started = performance.now();
    const interval = window.setInterval(() => setViewableSeconds((value) => value + .1), 100);
    return () => {
      clearInterval(interval);
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed < .08) return;
    };
  }, [ratio >= .5]);

  return <article ref={ref} className="ad-preview-offer">
    <div className="ad-preview-offer-label"><Megaphone size={13} /><b>Sponsored · preview only</b><span>{ad.placement}</span></div>
    <div className="ad-preview-offer-copy"><strong>{ad.headline}</strong><p>{ad.body}</p><small>{ad.businessName} · {ad.distance}</small></div>
    <button onClick={(event) => event.preventDefault()}>{ad.callToAction} <ArrowUpRight size={14} /></button>
    <div className="ad-preview-viewability"><span>{Math.round(ratio * 100)}% visible</span><b>{viewableSeconds.toFixed(1)}s viewable</b><span>~{screensFromTop.toFixed(1)} screens from top</span></div>
  </article>;
}
