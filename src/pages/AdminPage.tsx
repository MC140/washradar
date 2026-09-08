import {Database, ShieldAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {repository} from '../services';
import {GTA_IMPORT_QUERY_COUNT, importFullGtaCatalogue} from '../services/adminCatalogue';
import {enrichWashTypes, type WashTypeEnrichmentProgress} from '../services/washTypeTrust';
import type {AdminSnapshot, CatalogueImportProgress} from '../services/repository';
import {minutesAgo} from '../utils/format';
import '../washTypeTrust.css';

export function AdminPage() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>();
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<CatalogueImportProgress>();
  const [typeEnriching, setTypeEnriching] = useState(false);
  const [typeProgress, setTypeProgress] = useState<WashTypeEnrichmentProgress>();

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

  const runTypeEnrichment = async () => {
    if (typeEnriching) return;
    const confirmed = window.confirm('Enrich unknown wash types from official websites and Google review evidence? This uses higher-tier Google Place Details only when needed and saves progress locally if the daily safety quota is reached.');
    if (!confirmed) return;
    setTypeEnriching(true);
    try {
      const result = await enrichWashTypes(setTypeProgress);
      toast.success(`Wash-type enrichment complete: ${result.classified} locations gained confidence-qualified type evidence.`);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Wash-type enrichment stopped. Press the button later to resume.');
    } finally {
      setTypeEnriching(false);
    }
  };

  const phaseLabel = progress?.phase === 'enrichment' ? 'Repairing saved wash details' : progress?.phase === 'coverage' ? 'Auditing FSA coverage' : 'Searching GTA';

  return <section className="admin-page"><div className="page-heading"><p className="eyebrow">INTERNAL OPERATIONS</p><h1>WashRadar moderation.</h1><p>Authorization is enforced by the Supabase Edge Function and admin allowlist, never by this page.</p></div>
    {error && <div className="locked-admin"><ShieldAlert size={30} /><h2>Protected route</h2><p>{error}</p></div>}
    {snapshot && <>
      <div className="admin-metrics"><article><small>Washes</small><strong>{snapshot.washCount}</strong></article><article><small>Active queue sessions</small><strong>{snapshot.activeSessionCount}</strong></article><article><small>Active campaigns</small><strong>{snapshot.activeCampaignCount}</strong></article></div>

      <section className="panel"><Database size={24} /><p className="eyebrow">PRODUCTION CATALOGUE</p><h2>Greater Toronto Area</h2><p>Searches Toronto plus nearby municipalities using paginated Google Text Search. Google Place IDs are de-duplicated, then saved washes are refreshed with real weekly hours, business status, address and rating.</p>
        <button className="primary-button" disabled={importing || typeEnriching} onClick={() => void bootstrapGta()}>{importing ? 'Continuing GTA catalogue repair…' : 'Continue / refresh full GTA catalogue'}</button>
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
        <p><small>Keep this page open while the job runs. If it stops, pressing Continue later resumes rather than restarting.</small></p>

        <hr />
        <h3>Wash-type truth enrichment</h3>
        <p>For locations whose type is still unknown, WashRadar checks exact service language on the Google business name and official website first. Only unresolved locations use Google editorial/review evidence. One review never verifies a type by itself.</p>
        <button className="secondary-button" disabled={typeEnriching || importing} onClick={() => void runTypeEnrichment()}>{typeEnriching ? 'Enriching wash types…' : 'Enrich wash types from sources'}</button>
        {typeProgress && <div className="admin-type-progress" aria-live="polite">
          <p><b>{typeProgress.processed}</b> locations processed this run</p>
          <p><b>{typeProgress.classified}</b> confidence-qualified classifications</p>
          <p>{typeProgress.websiteMatches} official-site matches · {typeProgress.reviewMatches} review evidence matches</p>
          <p>{typeProgress.nextOffset === null ? 'Complete' : `Next saved offset: ${typeProgress.nextOffset}`}</p>
        </div>}
        <p><small>Confidence threshold for public display is 65/100. Official source evidence can qualify immediately; review evidence or nearby contributors need independent agreement. Remote contributors alone can never establish a type.</small></p>
      </section>

      <section className="panel"><h2>Recent reports</h2><div className="admin-table" role="table">{snapshot.reports.map((report) => <div role="row" key={report.id}><span role="cell"><b>{report.kind}</b><small>{report.verification} · {minutesAgo(report.createdAt)}</small></span><code role="cell">{report.washId.slice(0, 8)}</code><button className="secondary-button" role="cell" onClick={async () => {await repository.moderateReport(report.id, !report.disabled); await load();}}>{report.disabled ? 'Restore' : 'Disable'}</button></div>)}</div></section>
    </>}
  </section>;
}
