import {Clock3, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useWashRadar} from '../state/WashRadarContext';

export function QueueSessionBanner() {
  const {session, washes, finishSession} = useWashRadar();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);
  if (!session) return null;
  const wash = washes.find((item) => item.id === session.washId);
  const seconds = Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000));
  const display = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  return (
    <section className="session-banner" aria-live="polite">
      <div><Clock3 size={22} /><span><small>YOU’VE BEEN WAITING · {wash?.name}</small><strong>{display}</strong></span></div>
      <button onClick={() => void finishSession('completed')}>Wash started</button>
      <button className="quiet" onClick={() => void finishSession('completed')}>Finished waiting</button>
      <button className="icon-button inverse" onClick={() => void finishSession('cancelled')} aria-label="Cancel queue timer"><X size={18} /></button>
    </section>
  );
}
