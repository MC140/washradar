import {BarChart3, Bell, CarFront, ChevronRight, Edit3, Heart, ShieldCheck, Sparkles, Trophy, User} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import type {FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {contributorLevel, initials} from '../domain/community';
import {getCommunityDashboard, saveCommunityProfile, type CommunityDashboard} from '../services/community';
import {useWashRadar} from '../state/WashRadarContext';
import '../community.css';

export function ProfilePage() {
  const {auth, metrics, signIn, signOut, mode} = useWashRadar();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState<CommunityDashboard | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');

  const loadCommunity = async () => {
    const value = await getCommunityDashboard();
    setDashboard(value);
    setDisplayName(value.profile.displayName ?? '');
    setHandle(value.profile.handle ?? '');
    setBio(value.profile.bio ?? '');
  };

  useEffect(() => { void loadCommunity(); }, [auth.signedIn]);
  const level = useMemo(() => contributorLevel(dashboard?.points ?? 0), [dashboard?.points]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await saveCommunityProfile({displayName, handle, bio});
      await loadCommunity();
      setEditing(false);
      toast.success('Profile updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Profile could not be saved.');
    } finally { setBusy(false); }
  };

  if (!auth.signedIn) return <section className="profile-layout"><div className="panel profile-main"><span className="profile-icon"><User size={25} /></span><p className="eyebrow">YOUR WASHRADAR</p><h1>Build a contributor identity.</h1><p>Explore without an account. Sign in when you want a profile, Radar Points, challenge progress, vehicles, saved washes and contribution history across devices.</p>
    <form className="magic-link-form" onSubmit={async (event) => {event.preventDefault(); setBusy(true); try {await signIn(email); toast.success('Check your email for a secure sign-in link.');} catch (error) {toast.error(error instanceof Error ? error.message : 'Sign-in is unavailable.');} finally {setBusy(false);}}}><label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="primary-button" disabled={busy}>Email me a sign-in link</button></form>
    {mode === 'demo' && <p className="demo-auth-note">Email is intentionally disabled in demo mode. Connect the production Supabase project to enable magic links.</p>}
    <div className="profile-signin-benefits"><span><Trophy /> Challenges & Radar Points</span><span><CarFront /> Private My Cars garage</span><span><BarChart3 /> Contribution history</span></div>
  </div><aside><div className="panel privacy-panel"><ShieldCheck /><h2>Low friction, private by design.</h2><p>WashRadar stores proximity verification for trust, not a public location trail. Your saved vehicles and profile account data stay private to your account.</p></div></aside></section>;

  const profile = dashboard?.profile;
  const name = profile?.displayName || 'Complete your profile';
  const profileInitials = initials(profile?.displayName, profile?.email ?? auth.email);
  const completedChallenges = dashboard?.challenges.filter((item) => item.completedAt).length ?? 0;

  return <section className="community-page profile-v2">
    <div className="profile-identity panel">
      <div className="avatar-circle">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profileInitials}</div>
      <div className="profile-identity-copy"><p className="eyebrow">YOUR WASHRADAR</p><h1>{name}</h1><p>{profile?.handle ? `@${profile.handle}` : profile?.email ?? auth.email}</p>{profile?.bio && <span>{profile.bio}</span>}</div>
      <div className="profile-actions"><button className="secondary-button" onClick={() => setEditing((value) => !value)}><Edit3 size={15} /> Edit profile</button><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>
    </div>

    {editing && <form className="panel profile-editor" onSubmit={saveProfile}><div className="section-heading"><div><p className="eyebrow">PROFILE</p><h2>How drivers know you</h2></div><User /></div><div className="profile-fields"><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} required placeholder="Your name" /></label><label>Handle<input value={handle} onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))} maxLength={24} required placeholder="washscout" /></label></div><label>Short bio <small>optional</small><input value={bio} onChange={(event) => setBio(event.target.value)} maxLength={120} placeholder="GTA wash scout" /></label><p className="privacy-hint">Your display name and handle identify your contributor profile. Your email is never shown publicly by this screen.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div></form>}

    <div className="profile-dashboard-grid">
      <div className="panel contributor-level-card"><div className="level-title"><Trophy /><div><p className="eyebrow">LEVEL {level.level}</p><h2>{level.name}</h2></div><strong>{dashboard?.points ?? 0}<small> pts</small></strong></div><div className="level-progress"><i style={{width: `${Math.round(level.progress * 100)}%`}} /></div><p>{level.pointsToNext ? `${level.pointsToNext} Radar Points to the next level.` : 'Top contributor level reached.'}</p></div>
      <div className="panel metric-panel community-metrics"><BarChart3 /><p className="eyebrow">CONTRIBUTIONS</p><div className="metrics"><span><b>{metrics.reportsSubmitted}</b>Reports</span><span><b>{metrics.completedWaits}</b>Verified waits</span><span><b>{metrics.reputation}</b>Reputation</span><span><b>{metrics.streakDays}</b>Day streak</span></div></div>
    </div>

    <div className="profile-links-grid">
      <Link className="panel profile-feature-link" to="/challenges"><span><Sparkles /></span><div><p className="eyebrow">CHALLENGES</p><h3>{completedChallenges}/{dashboard?.challenges.length ?? 0} completed</h3><p>Earn Radar Points for useful contributions.</p></div><ChevronRight /></Link>
      <Link className="panel profile-feature-link" to="/vehicles"><span><CarFront /></span><div><p className="eyebrow">MY CARS</p><h3>{dashboard?.vehicles.length ?? 0} saved</h3><p>Build your private garage for vehicle-aware recommendations.</p></div><ChevronRight /></Link>
      <Link className="panel profile-feature-link" to="/saved"><span><Heart /></span><div><p className="eyebrow">SAVED</p><h3>Your favourite washes</h3><p>Keep your regular locations close.</p></div><ChevronRight /></Link>
      <Link className="panel profile-feature-link" to="/alerts"><span><Bell /></span><div><p className="eyebrow">ALERTS</p><h3>Queue notifications</h3><p>Watch saved washes for better timing.</p></div><ChevronRight /></Link>
    </div>

    <div className="panel activity-panel"><div className="section-heading"><div><p className="eyebrow">YOUR IMPACT</p><h2>Recent contributions</h2></div><span>{dashboard?.activity.length ?? 0} recent</span></div>{dashboard?.activity.length ? <div className="activity-list">{dashboard.activity.map((item) => <div className="activity-row" key={`${item.type}-${item.id}`}><span className={'activity-dot ' + item.type} /><div><strong>{item.label}</strong><p>{item.detail} · {item.verification}</p></div><div>{item.points > 0 && <b>+{item.points}</b>}<small>{new Date(item.createdAt).toLocaleDateString()}</small></div></div>)}</div> : <div className="activity-empty"><p>Your verified contributions will appear here.</p><Link className="secondary-button" to="/">Find a wash to update</Link></div>}</div>

    <div className="panel privacy-panel profile-privacy"><ShieldCheck /><div><h2>Privacy, by design.</h2><p>Proximity is used to verify contribution trust. WashRadar does not publish a continuous GPS trail, and your vehicle list stays account-private.</p></div><button className="secondary-button" onClick={async () => {if (!('Notification' in window)) {toast.info('Notifications are unavailable here.'); return;} const permission = await Notification.requestPermission(); toast.info(permission === 'granted' ? 'Notifications enabled.' : 'In-app alerts still work.');}}><Bell size={16} /> Enable notifications</button></div>
  </section>;
}
