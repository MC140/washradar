import {useState} from 'react';
import type {RankedWash} from '../domain/models';
import {useWashRadar} from '../state/WashRadarContext';
import {Modal} from './Modal';

export function AlertModal({wash, open, onClose}: {wash?: RankedWash; open: boolean; onClose: () => void}) {
  const {createAlert, auth} = useWashRadar();
  const [threshold, setThreshold] = useState(10);
  const [busy, setBusy] = useState(false);
  if (!wash) return null;
  return (
    <Modal open={open} onClose={onClose} title="Save a shorter-queue target." description={auth.signedIn ? 'This target will sync across your devices. Check WashRadar to see when the current wait meets it.' : 'Guest targets stay on this device. Check WashRadar to see when the current wait meets it.'}>
      <label className="field-label">Target wait
        <select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}>
          <option value={0}>No queue</option>
          <option value={5}>5 minutes or less</option>
          <option value={10}>10 minutes or less</option>
          <option value={20}>20 minutes or less</option>
        </select>
      </label>
      <button className="primary-button full" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await createAlert(wash.id, threshold); onClose(); } finally { setBusy(false); }
      }}>Save queue target</button>
    </Modal>
  );
}
