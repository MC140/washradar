import {KeyRound, Mail, ShieldCheck} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {toast} from 'sonner';
import {
  requestPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from '../services/communityAuth';
import '../auth.css';

type Mode = 'signin' | 'signup';
type Props = {compact?: boolean};

export function AccountAuth({compact = false}: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'signup' && password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
        toast.success('Signed in to WashRadar.');
      } else {
        const result = await signUpWithPassword(email, password);
        if (result.confirmationRequired) {
          toast.success('Check your email once to verify your WashRadar account. Your password is already set.');
        } else {
          toast.success('WashRadar account created.');
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Account action is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    setBusy(true);
    try {
      await requestPasswordReset(email);
      toast.success('If that email can receive WashRadar account mail, a password setup/reset message is on the way.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password recovery is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={'account-auth' + (compact ? ' compact' : '')}>
    <div className="auth-tabs" role="tablist" aria-label="Email account options">
      <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
    </div>

    <form className="account-auth-form" onSubmit={submit}>
      <label>Email address<div className="auth-input-wrap"><Mail size={17} /><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div></label>
      <label>Password<div className="auth-input-wrap"><KeyRound size={17} /><input type="password" required minLength={mode === 'signup' ? 12 : undefined} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? '12+ chars, upper/lower, number & symbol' : 'Your password'} /></div></label>
      {mode === 'signup' && <label>Confirm password<div className="auth-input-wrap"><KeyRound size={17} /><input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat password" /></div></label>}
      <button className="primary-button auth-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
    </form>

    {mode === 'signin' && <button type="button" className="auth-recovery-link" disabled={busy || !email.trim()} onClick={() => void recover()}>Forgot password or used email links before? <strong>Create / reset password</strong></button>}

    <p className="auth-email-note"><ShieldCheck size={16} /> {mode === 'signin' ? 'Normal sign-ins do not send email. Your session stays on this device until you sign out.' : 'For the friends beta, use a unique 12+ character password with upper/lowercase letters, a number and a symbol. We send one verification email for a new account.'}</p>
  </div>;
}
