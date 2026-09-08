import {useEffect, useMemo, useState} from 'react';
import {MapPin, ShieldCheck} from 'lucide-react';
import type {QueueBucket, QueueSignal, RankedWash, WashType} from '../domain/models';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {useWashRadar} from '../state/WashRadarContext';
import {Modal} from './Modal';
import {analytics} from '../services/analytics';
import {submitWashTypeContribution} from '../services/washTypeTrust';

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
const washTypeOptions: WashType[] = ['touchless', 'soft-cloth', 'automatic', 'self-serve', 'hand-wash', 'tunnel'];

export function ReportModal({open, initialWash, onClose}: {open: boolean; initialWash?: RankedWash; onClose: () => void}) {
  const {washes, submitReport, currentPosition} = useWashRadar();
  const [washId, setWashId] = useState(initialWash?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<WashType[]>([]);
  const wash = useMemo(() => washes.find((item) => item.id === washId), [washId, washes]);
  const initialWashId = initialWash?.id;

  useEffect(() => {
    if (!open || !initialWashId) return;
    setWashId(initialWashId);
    setMessage('');
    setFailed(false);
    setSelectedTypes([]);
    analytics.track('queue_report_started', {washId: initialWashId});
  }, [open, initialWashId]);

  const send = async (kind: QueueSignal['kind'], queueBucket?: QueueBucket) => {
    if (!wash) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const verification = await submitReport({washId: wash.id, kind, queueBucket});
      setMessage(verification === 'nearby'
        ? 'Thanks — your nearby report is helping drivers right now.'
        : 'Thanks — saved as a remote report with lower weight.');
      window.setTimeout(() => { setMessage(''); setWashId(''); setSelectedTypes([]); onClose(); }, 1500);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'The report could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const sendTypes = async () => {
    if (!wash || !selectedTypes.length) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const result = await submitWashTypeContribution(wash.id, selectedTypes);
      setMessage(result.verification === 'nearby'
        ? 'Thanks — your nearby wash-type confirmation was added to the confidence score.'
        : 'Thanks — your remote wash-type report was saved with low weight.');
      analytics.track('wash_type_reported', {washId: wash.id, verification: result.verification, count: selectedTypes.length});
      window.setTimeout(() => { setMessage(''); setWashId(''); setSelectedTypes([]); onClose(); }, 1800);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'The wash type could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const toggleType = (type: WashType) => setSelectedTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={failed ? 'Report could not be sent' : message ? 'Report received' : wash ? 'What do you see?' : 'Choose a nearby wash'}
      description={message || (wash ? 'One tap is enough. Nearby reports carry much more weight; remote reports still help but cannot establish a wash type by themselves.' : 'Pick the wash you are looking at.')}
    >
      {!message && !wash && (
        <div className="wash-picker">
          {washes.slice(0, 12).map((item) => (
            <button key={item.id} onClick={() => { setWashId(item.id); setFailed(false); setSelectedTypes([]); analytics.track('queue_report_started', {washId: item.id}); }}>
              <span><strong>{item.name}</strong><small>{item.address}</small></span><b>{item.distanceKm.toFixed(1)} km</b>
            </button>
          ))}
        </div>
      )}
      {!message && wash && (
        <>
          <div className="proximity-note">
            {currentPosition ? <ShieldCheck size={18} /> : <MapPin size={18} />}
            <span>{currentPosition ? 'Your proximity will be verified privately.' : 'Share location for stronger evidence. Remote contributions remain low-weight.'}</span>
          </div>
          <div className="report-options">
            {queueOptions.map((option) => <button disabled={busy} key={option.bucket} onClick={() => void send('queue', option.bucket)}>{option.label}</button>)}
          </div>
          <p className="option-divider">Operational issue</p>
          <div className="report-options issues">
            {issueOptions.map((option) => <button disabled={busy} key={option.kind} onClick={() => void send(option.kind)}>{option.label}</button>)}
          </div>

          <p className="option-divider">Optional · What type of wash is this?</p>
          <p className="wash-type-help">Select every type you are confident this location offers. One nearby driver alone does not make a type “verified”; independent evidence is combined into a confidence score.</p>
          <div className="wash-type-report-options">
            {washTypeOptions.map((type) => <button type="button" aria-pressed={selectedTypes.includes(type)} className={selectedTypes.includes(type) ? 'selected' : ''} disabled={busy} key={type} onClick={() => toggleType(type)}>{WASH_TYPE_CONFIG[type].label}</button>)}
          </div>
          <button className="secondary-button full" disabled={busy || !selectedTypes.length} onClick={() => void sendTypes()}>Share wash type</button>
        </>
      )}
      {failed && wash && <button className="secondary-button full" disabled={busy} onClick={() => { setMessage(''); setFailed(false); }}>Try again</button>}
    </Modal>
  );
}
