import {
  Activity,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  GitPullRequest,
  LoaderCircle,
  Play,
  Radar,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wrench,
} from 'lucide-react';
import {FormEvent, useCallback, useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {
  createHqTask,
  loadHqSnapshot,
  planHqGoal,
  reviewHqApproval,
  runHqScan,
  updateHqTask,
  type HqAgent,
  type HqPriority,
  type HqSnapshot,
  type HqTask,
} from '../services/hq';
import '../hq.css';

const agentIcons = {
  chief: Building2,
  product: Target,
  engineering: Wrench,
  data: Database,
  growth: Rocket,
  operations: ShieldCheck,
} as const;

const priorityRank: Record<HqPriority, number> = {urgent: 4, high: 3, normal: 2, low: 1};

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeAgo(value?: string | null) {
  if (!value) return 'No run yet';
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function HQPage() {
  const [snapshot, setSnapshot] = useState<HqSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [goal, setGoal] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAgent, setTaskAgent] = useState('chief');

  const load = useCallback(async () => {
    try {
      setSnapshot(await loadHqSnapshot());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'WashRadar HQ could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeTasks = useMemo(() => (snapshot?.tasks ?? [])
    .filter((task) => task.status !== 'done')
    .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()), [snapshot]);

  const pendingApprovals = (snapshot?.approvals ?? []).filter((item) => item.status === 'pending');
  const ops = snapshot?.operational ?? {};
  const activeWashes = asNumber(ops.active_washes);
  const washesWithHours = asNumber(ops.washes_with_hours);
  const hoursCoverage = activeWashes ? Math.round((washesWithHours / activeWashes) * 100) : 100;
  const appOpens = asNumber(ops.app_opens_7d);
  const searches = asNumber(ops.searches_7d);
  const searchRate = appOpens ? Math.round((searches / appOpens) * 100) : 0;

  const execute = async (key: string, work: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await work();
      toast.success(success);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'HQ action failed.');
    } finally {
      setBusy('');
    }
  };

  const submitGoal = async (event: FormEvent) => {
    event.preventDefault();
    const clean = goal.trim();
    if (clean.length < 8) return;
    await execute('goal', async () => {
      await planHqGoal(clean);
      setGoal('');
    }, 'Chief of Staff created a coordinated plan.');
  };

  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    const clean = taskTitle.trim();
    if (clean.length < 3) return;
    await execute('task', async () => {
      await createHqTask({title: clean, agentKey: taskAgent, priority: 'normal'});
      setTaskTitle('');
    }, 'Task added to HQ.');
  };

  if (error) {
    return <section className="hq-shell">
      <div className="hq-locked">
        <ShieldCheck size={34} />
        <p className="eyebrow">FOUNDER ONLY</p>
        <h1>WashRadar HQ</h1>
        <p>{error}</p>
        <p className="hq-muted">Sign in with an administrator account, then reopen this page.</p>
        <Link className="secondary-button" to="/admin">Back to admin</Link>
      </div>
    </section>;
  }

  if (!snapshot) {
    return <section className="hq-shell hq-loading"><LoaderCircle className="hq-spin" size={30} /><p>Opening WashRadar HQ…</p></section>;
  }

  return <section className="hq-shell">
    <div className="hq-topbar">
      <div>
        <p className="eyebrow">FOUNDER CONTROL CENTRE</p>
        <h1>WashRadar HQ</h1>
        <p>Six operating agents, one shared brain, founder approval for consequential actions.</p>
      </div>
      <div className="hq-top-actions">
        <span className="hq-zero"><CircleDollarSign size={17} /> ZERO-COST MODE · $0</span>
        <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void load()}><RefreshCcw size={16} /> Refresh</button>
        <button className="primary-button" disabled={Boolean(busy)} onClick={() => void execute('scan', runHqScan, 'All six agents completed a live health scan.')}><Activity size={16} /> {busy === 'scan' ? 'Scanning…' : 'Run company scan'}</button>
      </div>
    </div>

    <div className="hq-kpis">
      <Kpi icon={Database} label="Active washes" value={String(activeWashes)} detail={`${hoursCoverage}% hours coverage`} />
      <Kpi icon={Activity} label="Queue reports · 24h" value={String(asNumber(ops.queue_reports_24h))} detail={`${asNumber(ops.nearby_queue_reports_24h)} nearby verified`} />
      <Kpi icon={Users} label="App opens · 7d" value={String(appOpens)} detail={`${searches} searches · ${searchRate}% signal`} />
      <Kpi icon={ClipboardCheck} label="Active HQ work" value={String(activeTasks.length)} detail={`${pendingApprovals.length} waiting approval`} />
      <Kpi icon={GitPullRequest} label="Open PRs" value={snapshot.github.available ? String(snapshot.github.openPullRequests) : '—'} detail={snapshot.github.available ? `${snapshot.github.recentFailedRuns.length} recent failed runs` : 'GitHub unavailable'} />
      <Kpi icon={CircleDollarSign} label="AI spend" value="$0.00" detail="Paid providers disabled" />
    </div>

    <div className="hq-command-grid">
      <form className="hq-command-card hq-goal-card" onSubmit={(event) => void submitGoal(event)}>
        <div className="hq-section-title"><Sparkles size={20} /><div><p className="eyebrow">CHIEF OF STAFF</p><h2>Give the company a goal</h2></div></div>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Example: Get WashRadar ready for a Scarborough public launch with trustworthy queue data and a partner outreach plan." maxLength={1200} />
        <div className="hq-form-row"><small>HQ creates coordinated work across Product, Engineering, Data, Growth and Operations.</small><button className="primary-button" disabled={busy === 'goal' || goal.trim().length < 8}>{busy === 'goal' ? 'Planning…' : 'Plan & assign'}</button></div>
      </form>

      <form className="hq-command-card" onSubmit={(event) => void submitTask(event)}>
        <div className="hq-section-title"><ClipboardCheck size={20} /><div><p className="eyebrow">QUICK ASSIGN</p><h2>Add a task</h2></div></div>
        <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="What needs to be done?" maxLength={180} />
        <div className="hq-form-row">
          <select value={taskAgent} onChange={(event) => setTaskAgent(event.target.value)}>
            {snapshot.agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.name}</option>)}
          </select>
          <button className="secondary-button" disabled={busy === 'task' || taskTitle.trim().length < 3}>Assign</button>
        </div>
      </form>
    </div>

    <section className="hq-office">
      <div className="hq-section-heading">
        <div><p className="eyebrow">LIVE COMPANY</p><h2>Your operating team</h2></div>
        <span>{snapshot.agents.length} agents · event-driven · no always-on compute</span>
      </div>

      <div className="hq-agent-grid">
        {snapshot.agents.slice(0, 3).map((agent) => <AgentCard key={agent.key} agent={agent} snapshot={snapshot} />)}
        <article className="hq-brain">
          <div className="hq-brain-orbit"><BrainCircuit size={38} /></div>
          <p className="eyebrow">THE BRAIN</p>
          <h3>Shared WashRadar memory</h3>
          <strong>{snapshot.memory.length}</strong>
          <span>recent decisions & observations</span>
          <small>Production data + HQ tasks + agent runs + founder decisions</small>
        </article>
        {snapshot.agents.slice(3).map((agent) => <AgentCard key={agent.key} agent={agent} snapshot={snapshot} />)}
      </div>
    </section>

    <div className="hq-lower-grid">
      <section className="hq-panel hq-work-panel">
        <div className="hq-section-heading">
          <div><p className="eyebrow">WORK QUEUE</p><h2>What the company is doing</h2></div>
          <span>{activeTasks.length} active</span>
        </div>
        <div className="hq-task-list">
          {activeTasks.length === 0 && <div className="hq-empty"><CheckCircle2 size={24} /><p>No active tasks. Run a company scan or give HQ a goal.</p></div>}
          {activeTasks.slice(0, 16).map((task) => <TaskRow key={task.id} task={task} agents={snapshot.agents} busy={busy} onUpdate={(status) => execute(`task-${task.id}`, () => updateHqTask(task.id, {status}), status === 'done' ? 'Task completed.' : 'Task updated.')} />)}
        </div>
      </section>

      <div className="hq-side-stack">
        <section className="hq-panel">
          <div className="hq-section-heading"><div><p className="eyebrow">APPROVAL CENTRE</p><h2>Needs you</h2></div><span>{pendingApprovals.length}</span></div>
          {pendingApprovals.length === 0 ? <div className="hq-empty compact"><ShieldCheck size={22} /><p>No actions are waiting for approval.</p></div> :
            pendingApprovals.slice(0, 6).map((approval) => <article className="hq-approval" key={approval.id}>
              <strong>{approval.summary}</strong>
              <small>{approval.action_type} · {timeAgo(approval.requested_at)}</small>
              <div><button className="secondary-button" onClick={() => void execute(`reject-${approval.id}`, () => reviewHqApproval(approval.id, 'rejected'), 'Action rejected.')}>Reject</button><button className="primary-button" onClick={() => void execute(`approve-${approval.id}`, () => reviewHqApproval(approval.id, 'approved'), 'Action approved.')}>Approve</button></div>
            </article>)}
        </section>

        <section className="hq-panel">
          <div className="hq-section-heading"><div><p className="eyebrow">SHARED MEMORY</p><h2>What HQ remembers</h2></div></div>
          <div className="hq-memory-list">
            {snapshot.memory.slice(0, 6).map((item) => <article key={item.id}><span>{item.category}</span><strong>{item.title}</strong><p>{item.body}</p><small>{timeAgo(item.created_at)} · {item.source}</small></article>)}
          </div>
        </section>
      </div>
    </div>

    <footer className="hq-footer-note">
      <ShieldCheck size={17} />
      <span>Month 1 safeguard: paid AI is disabled. External emails, production changes, spending, contracts and other consequential actions are not autonomous.</span>
      <Link to="/admin">Admin tools</Link>
    </footer>
  </section>;
}

function Kpi({icon: Icon, label, value, detail}: {icon: typeof Radar; label: string; value: string; detail: string}) {
  return <article className="hq-kpi"><div><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AgentCard({agent, snapshot}: {agent: HqAgent; snapshot: HqSnapshot}) {
  const Icon = agentIcons[agent.key as keyof typeof agentIcons] ?? Radar;
  const tasks = snapshot.tasks.filter((task) => task.agent_key === agent.key && task.status !== 'done');
  const working = tasks.filter((task) => task.status === 'in_progress').length;
  const latest = snapshot.runs.find((run) => run.agent_key === agent.key);
  const state = working > 0 ? 'working' : tasks.length > 0 ? 'queued' : 'idle';

  return <article className="hq-agent-card">
    <div className="hq-agent-head"><span className={`hq-agent-avatar ${state}`}><Icon size={22} /></span><span className={`hq-status-dot ${state}`} /></div>
    <p className="eyebrow">{agent.department}</p>
    <h3>{agent.name}</h3>
    <p>{agent.purpose}</p>
    <div className="hq-agent-stats"><span><b>{tasks.length}</b> active tasks</span><span>Level {agent.automation_level}</span></div>
    <div className="hq-agent-run"><small>{latest ? latest.summary : 'Ready for first run.'}</small><time>{timeAgo(latest?.completed_at ?? latest?.started_at)}</time></div>
  </article>;
}

function TaskRow({task, agents, busy, onUpdate}: {task: HqTask; agents: HqAgent[]; busy: string; onUpdate: (status: 'in_progress' | 'done' | 'blocked') => Promise<void>}) {
  const owner = agents.find((agent) => agent.key === task.agent_key)?.name ?? 'Unassigned';
  return <article className="hq-task-row">
    <span className={`hq-priority ${task.priority}`}>{task.priority}</span>
    <div className="hq-task-copy"><strong>{task.title}</strong><p>{task.detail}</p><small>{owner} · {task.status.replaceAll('_', ' ')} · {timeAgo(task.updated_at)}</small></div>
    <div className="hq-task-actions">
      {task.status !== 'in_progress' && <button disabled={busy === `task-${task.id}`} onClick={() => void onUpdate('in_progress')}><Play size={14} /> Start</button>}
      {task.status !== 'blocked' && <button disabled={busy === `task-${task.id}`} onClick={() => void onUpdate('blocked')}>Block</button>}
      <button className="done" disabled={busy === `task-${task.id}`} onClick={() => void onUpdate('done')}><CheckCircle2 size={14} /> Done</button>
    </div>
  </article>;
}
