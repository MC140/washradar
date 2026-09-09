import {Bell, Compass, Heart, MapPin, Plus, Radar, Trophy, User} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Link, NavLink, Outlet} from 'react-router-dom';
import {useCommunityAuth} from '../state/useCommunityAuth';
import {useWashRadar} from '../state/WashRadarContext';
import {ProfileDrawer} from './ProfileDrawer';
import {QueueSessionBanner} from './QueueSessionBanner';
import {ReportModal} from './ReportModal';
import '../mobile-account.css';

const mobileNavigation = [
  {to: '/', label: 'Explore', icon: Compass},
  {to: '/saved', label: 'Saved', icon: Heart},
  {to: '/challenges', label: 'Challenges', icon: Trophy},
  {to: '/profile', label: 'Profile', icon: User},
];

export function AppShell() {
  const {locationLabel, locationReady, locate, alerts, refresh} = useWashRadar();
  const communityAuth = useCommunityAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const syncedAuth = useRef<boolean | null>(null);
  const hasTriggeredAlert = alerts.some((entry) => Boolean(entry.triggeredAt));

  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener('washradar:update-ready', ready);
    return () => window.removeEventListener('washradar:update-ready', ready);
  }, []);

  useEffect(() => {
    if (!communityAuth.ready || syncedAuth.current === communityAuth.signedIn) return;
    syncedAuth.current = communityAuth.signedIn;
    void refresh();
  }, [communityAuth.ready, communityAuth.signedIn, refresh]);

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="WashRadar home"><span><Radar size={24} /></span>Wash<b>Radar</b></Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <NavLink to="/">Explore</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          <NavLink to="/challenges">Challenges</NavLink>
          <NavLink to="/alerts">Alerts</NavLink>
          <button onClick={() => setReportOpen(true)}>Report</button>
        </nav>
        <button className="location-button" onClick={() => void locate()}><MapPin size={16} /><span>{locationLabel}</span><small>{locationReady ? 'Change' : 'Set'}</small></button>
        <NavLink className="profile-link header-alert-link" to="/alerts" aria-label="Alerts"><Bell size={19} />{hasTriggeredAlert && <i />}</NavLink>
        <button className={'profile-link account-menu-trigger ' + (communityAuth.signedIn ? 'signed-in' : '')} type="button" onClick={() => setAccountOpen(true)} aria-label="Open account menu" aria-expanded={accountOpen}><User size={19} />{communityAuth.signedIn && <i />}</button>
      </header>
      <QueueSessionBanner />
      {updateReady && <div className="update-banner" role="status">A fresh version is ready.<button onClick={() => window.location.reload()}>Update</button></div>}
      <main id="main-content" className="app-main"><Outlet /></main>
      <footer className="site-footer">
        <div><strong>WashRadar</strong><span>Good timing. Great shine.</span></div>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/sponsored">Sponsored content</Link>
          <Link to="/support">Support</Link>
        </nav>
        <small>Queue, price and availability information may change. Verify before travelling.</small>
      </footer>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {mobileNavigation.slice(0, 2).map((item) => <NavItem key={item.to} {...item} />)}
        <button className="report-nav" onClick={() => setReportOpen(true)}><span><Plus size={22} /></span><small>Report</small></button>
        {mobileNavigation.slice(2).map((item) => <NavItem key={item.to} {...item} />)}
      </nav>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
      <ProfileDrawer open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}

function NavItem({to, label, icon: Icon}: {to: string; label: string; icon: typeof Compass}) {
  return <NavLink to={to} end={to === '/'}><span><Icon size={21} /></span><small>{label}</small></NavLink>;
}
