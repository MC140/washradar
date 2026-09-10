import {Clock3, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useWashRadar} from '../state/WashRadarContext';

export function QueueSessionBanner() {
  const {session, washes, finishSession} = useWashRadar();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session]);

  if (!session) return null;
  const wash = washes.find((item) => item.id === session.washId);
  const seconds = Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000));
  const display = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');

  return (
    <section className="session-banner" aria-live="polite">
      <div><Clock3 size={22} /><span><small>VERIFIED WAIT TIMER · {wash?.name}</small><strong>{display}</strong></span></div>
      <button onClick={() => void finishSession('completed')}>My wash started</button>
      <button className="icon-button inverse" onClick={() => void finishSession('cancelled')} aria-label="Cancel wait timer"><X size={18} /></button>
    </section>
  );
}
