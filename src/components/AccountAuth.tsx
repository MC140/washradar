import {KeyRound, Mail, ShieldCheck} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {toast} from 'sonner';
import {analytics} from '../services/analytics';
import {
  getAuthCapabilities,
  signInWithPassword,
  signInWithSocial,
  signUpWithPassword,
} from '../services/communityAuth';
import '../auth.css';

type Mode = 'signin' | 'signup';
type Props = {compact?: boolean};

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M21.35 12.18c0-.64-.06-1.25-.17-1.84H12v3.48h5.25a4.49 4.49 0 0 1-1.95 2.95v2.26h3.16c1.85-1.7 2.89-4.22 2.89-6.85Z" />
    <path fill="#34A853" d="M12 21.7c2.64 0 4.86-.87 6.48-2.37l-3.16-2.45c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.49-4.04H3.25v2.54A9.8 9.8 0 0 0 12 21.7Z" />
    <path fill="#FBBC05" d="M6.51 13.78A5.9 5.9 0 0 1 6.2 12c0-.62.11-1.22.31-1.78V7.68H3.25A9.8 9.8 0 0 0 2.2 12c0 1.58.38 3.07 1.05 4.32l3.26-2.54Z" />
    <path fill="#EA4335" d="M12 6.18c1.44 0 2.73.49 3.75 1.46l2.81-2.81C16.85 3.24 14.64 2.3 12 2.3a9.8 9.8 0 0 0-8.75 5.38l3.26 2.54C7.29 7.9 9.45 6.18 12 6.18Z" />
  </svg>;
}

export function AccountAuth({compact = false}: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getAuthCapabilities().then((capabilities) => {
      if (mounted) setGoogleAvailable(capabilities.google);
    });
    return () => { mounted = false; };
  }, []);

  const signInWithGoogle = async () => {
    setBusy(true);
    try {
      analytics.track('auth_social_started', {method: 'google'});
      await signInWithSocial('google');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-in is unavailable.');
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
        analytics.track('auth_signed_in', {method: 'password'});
        toast.success('Signed in to WashRadar.');
      } else {
        const result = await signUpWithPassword(email, password);
        if (result.confirmationRequired) {
          toast.error('Email verification is still enabled for this beta, but public email delivery is not configured yet. Please try again after the beta auth setting is updated.');
        } else {
          analytics.track('account_created', {method: 'password'});
          toast.success('WashRadar account created. You’re signed in.');
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Account action is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={'account-auth' + (compact ? ' compact' : '')}>
    {googleAvailable && <>
      <div className="account-auth-social">
        <button type="button" className="social-auth-button" disabled={busy} onClick={() => void signInWithGoogle()} aria-label="Continue with Google">
          <GoogleMark />
          Continue with Google
        </button>
      </div>
      <div className="auth-divider">or continue with email</div>
    </>}

    <div className="auth-tabs" role="tablist" aria-label="Email account options">
      <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
    </div>

    <form className="account-auth-form" onSubmit={submit}>
      <label>Email address<div className="auth-input-wrap"><Mail size={17} /><input name="email" type="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div></label>
      <label>Password<div className="auth-input-wrap"><KeyRound size={17} /><input name="password" type="password" required minLength={mode === 'signup' ? 8 : undefined} maxLength={128} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? '8 or more characters' : 'Your password'} /></div></label>
      <button className="primary-button auth-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
    </form>

    <p className="auth-email-note"><ShieldCheck size={16} /> {mode === 'signin'
      ? 'Normal sign-ins use your email and password. Your session stays on this device until you sign out.'
      : 'Use 8 or more characters. Suggested strong passwords from your phone, browser or password manager are supported. No second password entry is required.'}</p>
    {mode === 'signin' && <p className="auth-email-note"><ShieldCheck size={16} /> Password-reset email is intentionally unavailable during the friends beta until public email delivery is configured.</p>}
  </div>;
}
