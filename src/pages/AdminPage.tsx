import {Database, ShieldAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {repository} from '../services';
import type {AdminSnapshot, CatalogueImportProgress} from '../services/repository';
import {minutesAgo} from '../utils/format';

export function AdminPage() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>();
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<CatalogueImportProgress>();

  const load = async () => {
    try { setSnapshot(await repository.adminSnapshot()); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Administrator access is required.'); }
  };

  useEffect(() => { void load(); }, []);

  const bootstrapGta = async () => {
    if (importing) return;
    const confirmed = window.confirm('Populate or refresh the full GTA catalogue from Google Places? This runs about 50 Places discovery requests and can take a minute. Keep this page open until it finishes.');
    if (!confirmed) return;
    setImporting(true);
    setProgress(undefined);
    try {
      const result = await repository.bootstrapGtaCatalogue(setProgress);
      toast.success(`GTA catalogue complete: ${result.imported} new washes, ${result.updated} refreshed.`);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'GTA catalogue import failed.');
    } finally {
      setImporting(false);
    }
  };

  return <section className="admin-page"><div className="page-heading"><p className="eyebrow">INTERNAL OPERATIONS</p><h1>WashRadar moderation.</h1><p>Authorization is enforced by the Supabase Edge Function and admin allowlist, never by this page.</p></div>
    {error && <div className="locked-admin"><ShieldAlert size={30} /><h2>Protected route</h2><p>{error}</p></div>}
    {snapshot && <>
      <div className="admin-metrics"><article><small>Washes</small><strong>{snapshot.washCount}</strong></article><article><small>Active queue sessions</small><strong>{snapshot.activeSessionCount}</strong></article><article><small>Active campaigns</small><strong>{snapshot.activeCampaignCount}</strong></article></div>

      <section className="panel"><Database size={24} /><p className="eyebrow">PRODUCTION CATALOGUE</p><h2>Greater Toronto Area</h2><p>Discover real car washes across Toronto, Peel, Halton, York and Durham. Existing Google Place IDs are refreshed instead of duplicated.</p>
        <button className="primary-button" disabled={importing} onClick={() => void bootstrapGta()}>{importing ? 'Importing GTA washes…' : 'Populate / refresh GTA catalogue'}</button>
        {progress && <div className="admin-import-progress" aria-live="polite"><p><b>{progress.completed} / {progress.total}</b> areas completed</p><p>Current area: <b>{progress.area}</b></p><p>{progress.imported} new · {progress.updated} refreshed · {progress.discovered} Google results processed</p><progress max={progress.total} value={progress.completed} /></div>}
        <p><small>Keep this page open while the import is running. Normal users never run these Google discovery requests; they read the saved Supabase catalogue.</small></p>
      </section>

      <section className="panel"><h2>Recent reports</h2><div className="admin-table" role="table">{snapshot.reports.map((report) => <div role="row" key={report.id}><span role="cell"><b>{report.kind}</b><small>{report.verification} · {minutesAgo(report.createdAt)}</small></span><code role="cell">{report.washId.slice(0, 8)}</code><button className="secondary-button" role="cell" onClick={async () => {await repository.moderateReport(report.id, !report.disabled); await load();}}>{report.disabled ? 'Restore' : 'Disable'}</button></div>)}</div></section>
    </>}
  </section>;
}
