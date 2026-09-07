import {Bell, CheckCircle2} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useWashRadar} from '../state/WashRadarContext';

export function AlertsPage() {
  const {alerts, washes, removeAlert} = useWashRadar();
  return <><section className="page-heading"><p className="eyebrow">YOUR NEXT WASH</p><h1>Less waiting. We’ll watch.</h1><p>Queue alerts appear in-app. Signed-in alerts sync across devices.</p></section>
    <div className="alerts-grid">{alerts.length ? alerts.map((alert) => {
      const wash = washes.find((item) => item.id === alert.washId);
      const triggered = Boolean(wash && wash.estimate.operatingStatus === 'open' && wash.estimate.waitMinutes <= alert.thresholdMinutes);
      return <article className="panel alert-card" key={alert.id}>{triggered ? <CheckCircle2 className="green-icon" /> : <Bell />}<p className="eyebrow">{triggered ? 'READY NOW' : 'WATCHING'}</p><h2>{wash?.name ?? 'Saved wash'}</h2><p>{triggered ? 'The current wait meets your target.' : 'Notify when the queue reaches ' + alert.thresholdMinutes + ' minutes or less.'}</p>{wash && <Link className="secondary-button" to={'/wash/' + wash.id}>View wash</Link>}<button className="text-button" onClick={() => void removeAlert(alert.id)}>Remove alert</button></article>;
    }) : <section className="empty-state"><Bell size={30} /><h2>No queue alerts.</h2><p>Open a wash and choose “Alert me.”</p><Link className="secondary-button" to="/">Explore nearby washes</Link></section>}</div></>;
}
