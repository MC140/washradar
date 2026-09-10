import {ShieldAlert, Trash2} from 'lucide-react';
import {useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {supabaseClient} from '../services/supabaseClient';
import {useCommunityAuth} from '../state/useCommunityAuth';

export function AccountDeletionPage() {
  const auth = useCommunityAuth();
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const deleteAccount = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      const {data, error} = await supabaseClient.functions.invoke('account-actions', {
        body: {action: 'delete-account'},
      });
      if (error || data?.error) throw new Error(data?.error || 'Account deletion could not be completed.');
      await supabaseClient.auth.signOut({scope: 'local'}).catch(() => undefined);
      localStorage.removeItem('wr-auth-merge-claim');
      localStorage.removeItem('wr-has-queue-session');
      toast.success('Your WashRadar account was deleted.');
      navigate('/', {replace: true});
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Account deletion could not be completed.');
      setBusy(false);
    }
  };

  return <section className="community-page">
    <div className="panel profile-main account-delete-panel">
      <span className="profile-icon"><ShieldAlert size={25} /></span>
      <p className="eyebrow">ACCOUNT & PRIVACY</p>
      <h1>Delete your WashRadar account</h1>
      <p>This permanently removes your sign-in account and account-owned profile data. Queue observations that must remain for aggregate timing integrity may be retained only after your account identifier is removed.</p>

      {!auth.ready ? <p>Checking your account…</p> : !auth.signedIn ? <>
        <p>You are not signed in. Sign in from Profile first if you want to permanently delete a WashRadar account.</p>
        <Link className="primary-button" to="/profile">Go to Profile</Link>
      </> : <>
        <div className="privacy-panel account-delete-warning">
          <Trash2 />
          <div><h2>This cannot be undone.</h2><p>Your profile, favourites, queue targets, challenges, Radar Points and saved vehicles tied to this account will be removed.</p></div>
        </div>
        <label className="account-delete-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I understand this permanently deletes my WashRadar account.</span>
        </label>
        <button className="primary-button full danger-button" disabled={!confirmed || busy} onClick={() => void deleteAccount()}>{busy ? 'Deleting account…' : 'Delete account permanently'}</button>
      </>}
      <p className="privacy-hint">Need help? See <Link to="/support">Support</Link> or review the <Link to="/privacy">Privacy Policy</Link>.</p>
    </div>
  </section>;
}
