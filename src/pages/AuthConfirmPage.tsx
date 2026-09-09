import {CheckCircle2, KeyRound, ShieldCheck, TriangleAlert} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {Link, useNavigate, useSearchParams} from 'react-router-dom';
import {toast} from 'sonner';
import {claimPendingAnonymousContributions, updateAccountPassword} from '../services/communityAuth';
import {useCommunityAuth} from '../state/useCommunityAuth';
import '../auth.css';

export function AuthConfirmPage() {
  const auth = useCommunityAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode = params.get('mode') ?? 'verify';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.ready && auth.signedIn) void claimPendingAnonymousContributions();
  }, [auth.ready, auth.signedIn]);

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await updateAccountPassword(password);
      toast.success('Password updated. Future sign-ins use your email and password.');
      navigate('/profile', {replace: true});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  if (!auth.ready) return <section className="auth-confirm-page"><div className="panel auth-confirm-card"><div className="auth-confirm-icon"><ShieldCheck /></div><p className="eyebrow">WASHRADAR ACCOUNT</p><h1>Finishing securely…</h1><p>Restoring your verified account session.</p></div></section>;

  if (!auth.signedIn) return <section className="auth-confirm-page"><div className="panel auth-confirm-card"><div className="auth-confirm-icon warning"><TriangleAlert /></div><p className="eyebrow">WASHRADAR ACCOUNT</p><h1>This account link could not be completed.</h1><p>The link may be expired, already used, or opened in a way that removed its verification token.</p><div className="auth-confirm-actions"><Link className="primary-button" to="/profile">Return to sign in</Link><Link className="secondary-button" to="/">Continue as guest</Link></div></div></section>;

  if (mode === 'recovery') return <section className="auth-confirm-page"><div className="panel auth-confirm-card recovery"><div className="auth-confirm-icon"><KeyRound /></div><p className="eyebrow">PASSWORD RECOVERY</p><h1>Choose your WashRadar password.</h1><p>Use 8 or more characters. Suggested strong passwords from your phone, browser or password manager are supported.</p><form className="account-auth-form" onSubmit={savePassword}><label>New password<div className="auth-input-wrap"><KeyRound size={17} /><input name="new-password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 or more characters" /></div></label><button className="primary-button auth-primary" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button></form><p className="auth-email-note"><ShieldCheck size={16} /> Your password is handled by Supabase Auth and is never stored in WashRadar profile tables.</p></div></section>;

  return <section className="auth-confirm-page"><div className="panel auth-confirm-card"><div className="auth-confirm-icon success"><CheckCircle2 /></div><p className="eyebrow">WASHRADAR ACCOUNT</p><h1>{mode === 'oauth' ? 'You’re signed in.' : 'Your email is verified.'}</h1><p>Your account session is now stored securely on this device and stays available across refreshes until you sign out.</p><div className="auth-confirm-actions"><Link className="primary-button" to="/profile">Open my profile</Link><Link className="secondary-button" to="/">Explore washes</Link></div></div></section>;
}
