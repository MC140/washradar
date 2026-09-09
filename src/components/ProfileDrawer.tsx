import {Bell, CarFront, ChevronRight, Heart, HelpCircle, LogOut, ShieldCheck, Trophy, User, X} from 'lucide-react';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {contributorLevel, initials} from '../domain/community';
import {signOutCommunity} from '../services/communityAuth';
import {getCommunitySummary, type CommunitySummary} from '../services/communitySummary';
import {useCommunityAuth} from '../state/useCommunityAuth';
import {useWashRadar} from '../state/WashRadarContext';
import {AccountAuth} from './AccountAuth';
import '../community.css';
import '../account-drawer.css';

type Props = {open: boolean; onClose: () => void};

export function ProfileDrawer({open, onClose}: Props) {
  const auth = useCommunityAuth();
  const {refresh} = useWashRadar();
  const [summary, setSummary] = useState<CommunitySummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !auth.ready) return;
    if (!auth.signedIn) {
      setSummary(null);
      return;
    }
    let active = true;
    void getCommunitySummary().then((value) => { if (active) setSummary(value); });
    return () => { active = false; };
  }, [open, auth.ready, auth.signedIn]);

  const level = useMemo(() => contributorLevel(summary?.points ?? 0), [summary?.points]);
  if (!open) return null;

  const name = summary?.displayName || (auth.signedIn ? 'Your WashRadar' : 'Hi there!');
  const avatarText = initials(summary?.displayName, summary?.email ?? auth.email);

  const signOut = async () => {
    setBusy(true);
    try {
      await signOutCommunity();
      setSummary(null);
      await refresh();
      toast.success('Signed out.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="account-drawer-layer" role="presentation">
    <button className="account-drawer-backdrop" aria-label="Close account menu" onClick={onClose} />
    <aside className="account-drawer" role="dialog" aria-modal="true" aria-label="WashRadar account menu">
      <div className="account-drawer-header">
        <div>
          <p className="eyebrow">WASHRADAR</p>
          <h2>{name}</h2>
        </div>
        <button className="drawer-close" aria-label="Close account menu" onClick={onClose}><X size={22} /></button>
      </div>

      {!auth.ready ? <div className="drawer-loading">Restoring your account…</div> : auth.signedIn ? <>
        <Link className="drawer-profile-card" to="/profile" onClick={onClose}>
          <div className="drawer-avatar">{summary?.avatarUrl ? <img src={summary.avatarUrl} alt="" /> : avatarText}</div>
          <div><strong>{summary?.displayName || 'Complete your profile'}</strong><span>{summary?.handle ? `@${summary.handle}` : summary?.email ?? auth.email}</span><small>Level {level.level} · {level.name}</small></div>
          <ChevronRight size={20} />
        </Link>

        <div className="drawer-points"><Trophy size={20} /><div><strong>{summary?.points ?? 0}</strong><span>Radar Points</span></div><small>{level.pointsToNext ? `${level.pointsToNext} to next level` : 'Top level'}</small></div>

        <nav className="drawer-menu" aria-label="Account shortcuts">
          <DrawerLink to="/profile" icon={<User />} title="My Profile" detail="Identity, activity & stats" onClose={onClose} />
          <DrawerLink to="/vehicles" icon={<CarFront />} title="My Cars" detail="Private vehicle garage" onClose={onClose} />
          <DrawerLink to="/challenges" icon={<Trophy />} title="Challenges" detail="Progress & Radar Points" onClose={onClose} />
          <DrawerLink to="/saved" icon={<Heart />} title="Saved" detail="Favourite car washes" onClose={onClose} />
          <DrawerLink to="/alerts" icon={<Bell />} title="Alerts" detail="Queue notifications" onClose={onClose} />
        </nav>

        <div className="drawer-section-title">SUPPORT & PRIVACY</div>
        <nav className="drawer-menu compact" aria-label="Support shortcuts">
          <DrawerLink to="/privacy" icon={<ShieldCheck />} title="Privacy & Terms" detail="Account and data controls" onClose={onClose} />
          <DrawerLink to="/support" icon={<HelpCircle />} title="Help & Support" detail="Get help with WashRadar" onClose={onClose} />
        </nav>

        <button className="drawer-signout" disabled={busy} onClick={() => void signOut()}><LogOut size={18} /> Sign out</button>
      </> : <>
        <div className="drawer-signin-intro"><div className="drawer-avatar guest"><User size={27} /></div><div><strong>Sign in / create account</strong><span>Keep your profile, points, cars and contributions together.</span></div></div>
        <AccountAuth compact />
        <div className="drawer-section-title">BROWSE WITHOUT AN ACCOUNT</div>
        <nav className="drawer-menu compact">
          <DrawerLink to="/saved" icon={<Heart />} title="Saved" detail="Local favourites still work" onClose={onClose} />
          <DrawerLink to="/privacy" icon={<ShieldCheck />} title="Privacy" detail="How WashRadar handles data" onClose={onClose} />
          <DrawerLink to="/support" icon={<HelpCircle />} title="Help & Support" detail="Questions and assistance" onClose={onClose} />
        </nav>
      </>}
    </aside>
  </div>;
}

function DrawerLink({to, icon, title, detail, onClose}: {to: string; icon: ReactNode; title: string; detail: string; onClose: () => void}) {
  return <Link className="drawer-menu-item" to={to} onClick={onClose}><span className="drawer-menu-icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={18} /></Link>;
}
