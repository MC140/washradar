import {Bell, Compass, Heart, MapPin, Plus, Radar, User} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, NavLink, Outlet} from 'react-router-dom';
import {useWashRadar} from '../state/WashRadarContext';
import {QueueSessionBanner} from './QueueSessionBanner';
import {ReportModal} from './ReportModal';

const navigation = [
  {to: '/', label: 'Explore', icon: Compass},
  {to: '/saved', label: 'Saved', icon: Heart},
  {to: '/alerts', label: 'Alerts', icon: Bell},
  {to: '/profile', label: 'Profile', icon: User},
];

export function AppShell() {
  const {locationLabel, locationReady, locate, alerts} = useWashRadar();
  const [reportOpen, setReportOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener('washradar:update-ready', ready);
    return () => window.removeEventListener('washradar:update-ready', ready);
  }, []);
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="WashRadar home"><span><Radar size={24} /></span>Wash<b>Radar</b></Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navigation.slice(0, 3).map((item) => <NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}
          <button onClick={() => setReportOpen(true)}>Report</button>
        </nav>
        <button className="location-button" onClick={() => void locate()}><MapPin size={16} /><span>{locationLabel}</span><small>{locationReady ? 'Change' : 'Set'}</small></button>
        <NavLink className="profile-link" to="/profile" aria-label="Profile"><User size={19} /></NavLink>
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
        {navigation.slice(0, 2).map((item) => <NavItem key={item.to} {...item} />)}
        <button className="report-nav" onClick={() => setReportOpen(true)}><span><Plus size={22} /></span><small>Report</small></button>
        {navigation.slice(2).map((item) => <NavItem key={item.to} {...item} alert={item.label === 'Alerts' && alerts.some((entry) => Boolean(entry.triggeredAt))} />)}
      </nav>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}

function NavItem({to, label, icon: Icon, alert}: {to: string; label: string; icon: typeof Compass; alert?: boolean}) {
  return <NavLink to={to} end={to === '/'}><span><Icon size={21} />{alert && <i />}</span><small>{label}</small></NavLink>;
}
