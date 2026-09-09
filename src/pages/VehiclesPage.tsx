import {CarFront, Check, Plus, ShieldCheck, Trash2} from 'lucide-react';
import {FormEvent, useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {addVehicle, getCommunityDashboard, removeVehicle, setPrimaryVehicle, type UserVehicle} from '../services/community';
import {useWashRadar} from '../state/WashRadarContext';
import '../community.css';

const currentYear = new Date().getFullYear();
const years = Array.from({length: currentYear - 1979 + 1}, (_, index) => currentYear + 1 - index);

export function VehiclesPage() {
  const {auth} = useWashRadar();
  const [vehicles, setVehicles] = useState<UserVehicle[]>([]);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [nickname, setNickname] = useState('');
  const [vin, setVin] = useState('');

  const reload = async () => {
    const dashboard = await getCommunityDashboard();
    setVehicles(dashboard.vehicles);
  };

  useEffect(() => { void reload(); }, [auth.signedIn]);

  if (!auth.signedIn) return <section className="community-page"><div className="panel sign-in-gate"><CarFront size={34} /><h1>My Cars</h1><p>Sign in to save vehicles privately and use them for future wash compatibility and personalized recommendations.</p><Link className="primary-button" to="/profile">Sign in</Link></div></section>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await addVehicle({year, make, model, nickname, vin});
      toast.success('Vehicle added.');
      setMake(''); setModel(''); setNickname(''); setVin(''); setShowForm(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vehicle could not be added.');
    } finally { setBusy(false); }
  };

  return <section className="community-page">
    <div className="community-hero"><div><p className="eyebrow">MY CARS</p><h1>Your garage, your wash preferences.</h1><p>Save your vehicles now. WashRadar can use this foundation for vehicle-specific wash compatibility and recommendations without making your vehicle list public.</p></div><button className="primary-button" onClick={() => setShowForm((value) => !value)}><Plus size={17} /> Add vehicle</button></div>

    {showForm && <form className="panel vehicle-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">NEW VEHICLE</p><h2>Add a car</h2></div><ShieldCheck size={22} /></div>
      <div className="vehicle-fields">
        <label>Year<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Make<input value={make} onChange={(event) => setMake(event.target.value)} placeholder="Volkswagen" required maxLength={60} /></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Taos" required maxLength={80} /></label>
        <label>Nickname <small>optional</small><input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Black Taos" maxLength={40} /></label>
      </div>
      <label>VIN <small>optional · 17 characters</small><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} placeholder="Optional VIN" maxLength={17} autoCapitalize="characters" /></label>
      <p className="privacy-hint">Vehicle details are visible only to your account. VIN is optional and is not needed for normal WashRadar use.</p>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Adding…' : 'Add vehicle'}</button></div>
    </form>}

    {!vehicles.length && !showForm ? <div className="panel empty-garage"><CarFront size={42} /><h2>No vehicles yet</h2><p>Add your car so WashRadar can grow into vehicle-aware wash recommendations.</p><button className="secondary-button" onClick={() => setShowForm(true)}>Add your first car</button></div> : <div className="vehicle-grid">
      {vehicles.map((vehicle) => <article className={'panel vehicle-card ' + (vehicle.isPrimary ? 'primary-vehicle' : '')} key={vehicle.id}>
        <div className="vehicle-icon"><CarFront /></div><div className="vehicle-copy"><p className="eyebrow">{vehicle.isPrimary ? 'PRIMARY VEHICLE' : 'VEHICLE'}</p><h2>{vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}</h2>{vehicle.nickname && <p>{vehicle.year} {vehicle.make} {vehicle.model}</p>}{vehicle.vin && <small>VIN ending {vehicle.vin.slice(-4)}</small>}</div>
        <div className="vehicle-actions">{!vehicle.isPrimary && <button className="secondary-button" onClick={async () => {setBusy(true); try {await setPrimaryVehicle(vehicle.id); await reload(); toast.success('Primary vehicle updated.');} catch (error) {toast.error(error instanceof Error ? error.message : 'Could not update vehicle.');} finally {setBusy(false);}}}><Check size={15} /> Make primary</button>}<button className="icon-danger" aria-label="Remove vehicle" onClick={async () => {if (!window.confirm('Remove this vehicle from WashRadar?')) return; setBusy(true); try {await removeVehicle(vehicle.id); await reload(); toast.success('Vehicle removed.');} catch (error) {toast.error(error instanceof Error ? error.message : 'Could not remove vehicle.');} finally {setBusy(false);}}><Trash2 size={17} /></button></div>
      </article>)}
    </div>}
  </section>;
}
