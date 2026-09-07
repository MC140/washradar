import {BarChart3, Bell, ShieldCheck, User} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import {useWashRadar} from '../state/WashRadarContext';

export function ProfilePage() {
  const {auth, metrics, signIn, signOut, mode} = useWashRadar();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="profile-layout"><div className="panel profile-main"><span className="profile-icon"><User size={25} /></span><p className="eyebrow">YOUR WASHRADAR</p><h1>Your road to a better wash.</h1><p>{auth.signedIn ? 'Signed in as ' + auth.email + '. Your saved washes and alerts can sync.' : 'Explore without an account. Sign in only when you want cross-device sync and a contribution history.'}</p>
    {auth.signedIn ? <button className="secondary-button" onClick={() => void signOut()}>Sign out</button> : <form className="magic-link-form" onSubmit={async (event) => {event.preventDefault(); setBusy(true); try {await signIn(email); toast.success('Check your email for a secure sign-in link.');} catch (error) {toast.error(error instanceof Error ? error.message : 'Sign-in is unavailable.');} finally {setBusy(false);}}}><label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="primary-button" disabled={busy}>Email me a sign-in link</button></form>}
    {mode === 'demo' && <p className="demo-auth-note">Email is intentionally disabled in demo mode. Connect the production Supabase project to enable magic links.</p>}
  </div><aside><div className="panel metric-panel"><BarChart3 /><p className="eyebrow">CONTRIBUTIONS</p><div className="metrics"><span><b>{metrics.reportsSubmitted}</b>Reports</span><span><b>{metrics.completedWaits}</b>Observed waits</span><span><b>{metrics.reputation}</b>Reputation</span><span><b>{metrics.streakDays}</b>Day streak</span></div></div><div className="panel privacy-panel"><ShieldCheck /><h2>Privacy, by design.</h2><p>WashRadar stores proximity verification, not a public GPS trail. No continuous background location tracking.</p><button className="secondary-button" onClick={async () => {if (!('Notification' in window)) {toast.info('Notifications are unavailable here.'); return;} const permission = await Notification.requestPermission(); toast.info(permission === 'granted' ? 'Notifications enabled.' : 'In-app alerts still work.');}}><Bell size={16} /> Enable notifications</button></div></aside></section>;
}
