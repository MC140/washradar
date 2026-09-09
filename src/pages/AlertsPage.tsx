import {Bell, CheckCircle2} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import type {RankedWash} from '../domain/models';
import {loadWashDetail} from '../services/washDetail';
import {useWashRadar} from '../state/WashRadarContext';

export function AlertsPage() {
  const {alerts, washes, removeAlert} = useWashRadar();
  const [fallbackWashes, setFallbackWashes] = useState<Record<string, RankedWash>>({});
  const contextById = useMemo(() => new Map(washes.map((wash) => [wash.id, wash])), [washes]);

  useEffect(() => {
    const ids = [...new Set(alerts.map((alert) => alert.washId))];
    const missing = ids.filter((id) => !contextById.has(id) && !fallbackWashes[id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, (await loadWashDetail(id)).wash] as const)).then((items) => {
      if (cancelled) return;
      setFallbackWashes((current) => {
        const next = {...current};
        for (const [id, wash] of items) if (wash) next[id] = wash;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [alerts, contextById, fallbackWashes]);

  return <><section className="page-heading"><p className="eyebrow">YOUR NEXT WASH</p><h1>Save a queue target.</h1><p>WashRadar checks the current in-app queue estimate against your target. Signed-in targets sync across devices; background push notifications are not part of this beta.</p></section>
    <div className="alerts-grid">{alerts.length ? alerts.map((alert) => {
      const wash = contextById.get(alert.washId) ?? fallbackWashes[alert.washId];
      const triggered = Boolean(wash && wash.estimate.operatingStatus === 'open' && wash.estimate.waitMinutes <= alert.thresholdMinutes);
      return <article className="panel alert-card" key={alert.id}>{triggered ? <CheckCircle2 className="green-icon" /> : <Bell />}<p className="eyebrow">{triggered ? 'TARGET MET' : 'TARGET SAVED'}</p><h2>{wash?.name ?? 'Saved wash'}</h2><p>{triggered ? 'The current in-app wait estimate meets your target.' : 'Target: ' + alert.thresholdMinutes + ' minutes or less. Open WashRadar to check the latest queue.'}</p>{wash && <Link className="secondary-button" to={'/wash/' + wash.id}>View wash</Link>}<button className="text-button" onClick={() => void removeAlert(alert.id)}>Remove target</button></article>;
    }) : <section className="empty-state"><Bell size={30} /><h2>No queue targets.</h2><p>Open a wash and choose “Alert me” to save an in-app target.</p><Link className="secondary-button" to="/">Explore nearby washes</Link></section>}</div></>;
}
