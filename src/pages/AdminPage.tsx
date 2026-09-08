import {Database, ShieldAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {repository} from '../services';
import {GTA_IMPORT_QUERY_COUNT, importFullGtaCatalogue} from '../services/adminCatalogue';
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
    const confirmed = window.confirm(`Continue / refresh the GTA catalogue? WashRadar resumes saved progress, searches ${GTA_IMPORT_QUERY_COUNT} GTA municipalities / Toronto sub-areas, repairs real Google weekly hours and status for every saved wash, applies only explicit high-confidence wash-type labels, then audits postal-prefix coverage. Keep this page open until it finishes.`);
    if (!confirmed) return;
    setImporting(true);
    setProgress(undefined);
    try {
      const result = await importFullGtaCatalogue(setProgress);
      toast.success(`GTA catalogue complete: ${result.imported} new, ${result.hoursRefreshed ?? 0} hours refreshed, ${result.uniqueFsaCount ?? 0} FSAs represented.`);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'GTA catalogue import failed.');
    } finally {
      setImporting(false);
    }
  };

  const phaseLabel = progress?.phase === 'enrichment' ? 'Repairing saved wash details' : progress?.phase === 'coverage' ? 'Auditing FSA coverage' : 'Searching GTA';

  return <section className="admin-page"><div className="page-heading"><p className="eyebrow">INTERNAL OPERATIONS</p><h1>WashRadar moderation.</h1><p>Authorization is enforced by the Supabase Edge Function and admin allowlist, never by this page.</p></div>
    {error && <div className="locked-admin"><ShieldAlert size={30} /><h2>Protected route</h2><p>{error}</p></div>}
    {snapshot && <>
      <div className="admin-metrics"><article><small>Washes</small><strong>{snapshot.washCount}</strong></article><article><small>Active queue sessions</small><strong>{snapshot.activeSessionCount}</strong></article><article><small>Active campaigns</small><strong>{snapshot.activeCampaignCount}</strong></article></div>

      <section className="panel"><Database size={24} /><p className="eyebrow">PRODUCTION CATALOGUE</p><h2>Greater Toronto Area</h2><p>Searches Toronto plus Peel, Halton, York and Durham municipalities using paginated Google Text Search. Progress is resumable. Google Place IDs are de-duplicated, then every saved wash is refreshed with real weekly hours, business status, address and rating.</p>
        <button className="primary-button" disabled={importing} onClick={() => void bootstrapGta()}>{importing ? 'Continuing GTA catalogue repair…' : 'Continue / refresh full GTA catalogue'}</button>
        {progress && <div className="admin-import-progress" aria-live="polite">
          <p><b>{phaseLabel}</b></p>
          <p><b>{progress.completed} / {progress.total}</b> search areas completed</p>
          <p>Current work: <b>{progress.area}</b></p>
          <p>{progress.imported} new · {progress.updated} refreshed · {progress.discovered} Google search results processed</p>
          {(progress.hoursRefreshed !== undefined || progress.typed !== undefined) && <p>{progress.hoursRefreshed ?? 0} hours refreshed · {progress.typed ?? 0} explicit wash-type classifications</p>}
          {progress.phase === 'enrichment' && <p>{progress.enrichedProcessed ?? 0} saved Google Place IDs re-enriched</p>}
          {progress.phase === 'coverage' && <p>{progress.uniqueFsaCount ?? 0} FSAs represented · {progress.sparseFsaCount ?? 0} sparse prefixes flagged for follow-up</p>}
          <progress max={progress.total} value={progress.completed} />
        </div>}
        <p><small>Keep this page open while the job runs. If it stops, pressing Continue later resumes from the saved municipality/page rather than restarting. Wash-type labels are added only when the Google business name explicitly says touchless, self-serve, hand wash, soft cloth/touch, tunnel or automatic; unknown types remain unknown.</small></p>
      </section>

      <section className="panel"><h2>Recent reports</h2><div className="admin-table" role="table">{snapshot.reports.map((report) => <div role="row" key={report.id}><span role="cell"><b>{report.kind}</b><small>{report.verification} · {minutesAgo(report.createdAt)}</small></span><code role="cell">{report.washId.slice(0, 8)}</code><button className="secondary-button" role="cell" onClick={async () => {await repository.moderateReport(report.id, !report.disabled); await load();}}>{report.disabled ? 'Restore' : 'Disable'}</button></div>)}</div></section>
    </>}
  </section>;
}
