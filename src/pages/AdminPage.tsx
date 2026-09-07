import {ShieldAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {repository} from '../services';
import type {AdminSnapshot} from '../services/repository';
import {minutesAgo} from '../utils/format';

export function AdminPage() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>();
  const [error, setError] = useState('');
  const load = async () => {
    try { setSnapshot(await repository.adminSnapshot()); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Administrator access is required.'); }
  };
  useEffect(() => { void load(); }, []);
  return <section className="admin-page"><div className="page-heading"><p className="eyebrow">INTERNAL OPERATIONS</p><h1>WashRadar moderation.</h1><p>Authorization is enforced by the Supabase Edge Function and admin allowlist, never by this page.</p></div>
    {error && <div className="locked-admin"><ShieldAlert size={30} /><h2>Protected route</h2><p>{error}</p></div>}
    {snapshot && <><div className="admin-metrics"><article><small>Washes</small><strong>{snapshot.washCount}</strong></article><article><small>Active queue sessions</small><strong>{snapshot.activeSessionCount}</strong></article><article><small>Active campaigns</small><strong>{snapshot.activeCampaignCount}</strong></article></div>
      <section className="panel"><h2>Recent reports</h2><div className="admin-table" role="table">{snapshot.reports.map((report) => <div role="row" key={report.id}><span role="cell"><b>{report.kind}</b><small>{report.verification} · {minutesAgo(report.createdAt)}</small></span><code role="cell">{report.washId.slice(0, 8)}</code><button className="secondary-button" role="cell" onClick={async () => {await repository.moderateReport(report.id, !report.disabled); await load();}}>{report.disabled ? 'Restore' : 'Disable'}</button></div>)}</div></section></>}
  </section>;
}
