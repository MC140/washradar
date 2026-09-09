import {KeyRound, Mail, ShieldCheck} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {toast} from 'sonner';
import {
  getAuthCapabilities,
  signInWithPassword,
  signInWithSocial,
  signUpWithPassword,
} from '../services/communityAuth';
import '../auth.css';

type Mode = 'signin' | 'signup';
type Props = {compact?: boolean};

export function AccountAuth({compact = false}: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getAuthCapabilities().then((capabilities) => {
      if (active) setGoogleAvailable(capabilities.google);
    });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
        toast.success('Signed in to WashRadar.');
      } else {
        const result = await signUpWithPassword(email, password);
        if (result.confirmationRequired) {
          toast.error('Email verification is still enabled for this beta, but public email delivery is not configured yet. Please try again after the beta auth setting is updated.');
        } else {
          toast.success('WashRadar account created. You’re signed in.');
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Account action is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setBusy(true);
    try {
      await signInWithSocial('google');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-in is unavailable.');
      setBusy(false);
    }
  };

  return <div className={'account-auth' + (compact ? ' compact' : '')}>
    {googleAvailable && <>
      <div className="account-auth-social">
        <button type="button" className="social-auth-button" disabled={busy} onClick={() => void googleSignIn()}><span className="google-mark" aria-hidden="true">G</span> Continue with Google</button>
      </div>
      <div className="auth-divider"><span>or use email</span></div>
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
