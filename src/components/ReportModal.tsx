import {useEffect, useMemo, useState} from 'react';
import {MapPin, ShieldCheck} from 'lucide-react';
import type {QueueBucket, QueueSignal, RankedWash} from '../domain/models';
import {useWashRadar} from '../state/WashRadarContext';
import {Modal} from './Modal';
import {analytics} from '../services/analytics';

const queueOptions: {label: string; bucket: QueueBucket}[] = [
  {label: 'NO QUEUE', bucket: 'none'},
  {label: '1–3 CARS', bucket: '1-3'},
  {label: '4–7 CARS', bucket: '4-7'},
  {label: '8–12 CARS', bucket: '8-12'},
  {label: '12+ / HUGE QUEUE', bucket: '12-plus'},
];
const issueOptions: {label: string; kind: QueueSignal['kind']}[] = [
  {label: 'WASH CLOSED', kind: 'closed'},
  {label: 'MACHINE BROKEN', kind: 'broken'},
  {label: 'LINE NOT MOVING', kind: 'stalled'},
  {label: 'PAYMENT PROBLEM', kind: 'payment'},
  {label: 'DRYER ISSUE', kind: 'dryer'},
  {label: 'OTHER ISSUE', kind: 'other'},
];

export function ReportModal({open, initialWash, onClose}: {open: boolean; initialWash?: RankedWash; onClose: () => void}) {
  const {washes, submitReport, currentPosition} = useWashRadar();
  const [washId, setWashId] = useState(initialWash?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const wash = useMemo(() => washes.find((item) => item.id === washId), [washId, washes]);

  useEffect(() => {
    if (!open || !initialWash) return;
    setWashId(initialWash.id);
    setMessage('');
    setFailed(false);
    analytics.track('queue_report_started', {washId: initialWash.id});
  }, [open, initialWash?.id]);

  const send = async (kind: QueueSignal['kind'], queueBucket?: QueueBucket) => {
    if (!wash) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const verification = await submitReport({washId: wash.id, kind, queueBucket, position: currentPosition ?? undefined});
      setMessage(verification === 'nearby'
        ? 'Thanks — your nearby report is helping drivers right now.'
        : 'Thanks — saved as a remote report with lower weight.');
      window.setTimeout(() => { setMessage(''); setWashId(''); onClose(); }, 1500);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'The report could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={failed ? 'Report could not be sent' : message ? 'Report received' : wash ? 'What do you see?' : 'Choose a nearby wash'}
      description={message || (wash ? 'One tap is enough. Nearby reports become live signals; remote reports are clearly weighted lower.' : 'Pick the wash you are looking at.')}
    >
      {!message && !wash && (
        <div className="wash-picker">
          {washes.slice(0, 12).map((item) => (
            <button key={item.id} onClick={() => { setWashId(item.id); setFailed(false); analytics.track('queue_report_started', {washId: item.id}); }}>
              <span><strong>{item.name}</strong><small>{item.address}</small></span><b>{item.distanceKm.toFixed(1)} km</b>
            </button>
          ))}
        </div>
      )}
      {!message && wash && (
        <>
          <div className="proximity-note">
            {currentPosition ? <ShieldCheck size={18} /> : <MapPin size={18} />}
            <span>{currentPosition ? 'Your proximity will be verified privately.' : 'Share location for a stronger live signal. Remote reports still help.'}</span>
          </div>
          <div className="report-options">
            {queueOptions.map((option) => <button disabled={busy} key={option.bucket} onClick={() => void send('queue', option.bucket)}>{option.label}</button>)}
          </div>
          <p className="option-divider">Operational issue</p>
          <div className="report-options issues">
            {issueOptions.map((option) => <button disabled={busy} key={option.kind} onClick={() => void send(option.kind)}>{option.label}</button>)}
          </div>
        </>
      )}
      {failed && wash && <button className="secondary-button full" disabled={busy} onClick={() => { setMessage(''); setFailed(false); }}>Try again</button>}
    </Modal>
  );
}
