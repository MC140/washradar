import {CheckCircle2, LockKeyhole, Radar, Sparkles, Trophy} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useEffect, useMemo, useState} from 'react';
import {contributorLevel} from '../domain/community';
import {getCommunityDashboard, type CommunityDashboard} from '../services/community';
import {useWashRadar} from '../state/WashRadarContext';
import '../community.css';

export function ChallengesPage() {
  const {auth} = useWashRadar();
  const [dashboard, setDashboard] = useState<CommunityDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getCommunityDashboard().then((value) => { if (active) setDashboard(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auth.signedIn]);

  const level = useMemo(() => contributorLevel(dashboard?.points ?? 0), [dashboard?.points]);
  const completed = dashboard?.challenges.filter((item) => Boolean(item.completedAt)).length ?? 0;

  return <section className="community-page">
    <div className="community-hero challenge-hero">
      <div><p className="eyebrow">RADAR CHALLENGES</p><h1>Help drivers. Build your Radar.</h1><p>Nearby, useful contributions unlock points and challenges. Remote reports still help the data model, but they do not earn Radar Points.</p></div>
      <div className="points-orb"><Radar size={24} /><strong>{dashboard?.points ?? 0}</strong><span>Radar Points</span></div>
    </div>

    {auth.signedIn && <div className="level-strip panel"><div><Trophy size={20} /><span>Level {level.level}</span><strong>{level.name}</strong></div><div className="level-progress"><i style={{width: `${Math.round(level.progress * 100)}%`}} /></div><small>{level.pointsToNext ? `${level.pointsToNext} points to the next level` : 'Top contributor level reached'}</small></div>}

    {!auth.signedIn && <div className="panel challenge-signin"><LockKeyhole /><div><h2>Keep your progress</h2><p>Sign in to save challenge progress, points and your contributor identity across devices.</p></div><Link className="primary-button" to="/profile">Sign in</Link></div>}

    <div className="section-heading"><div><p className="eyebrow">ACTIVE</p><h2>Challenges</h2></div><span>{completed}/{dashboard?.challenges.length ?? 0} complete</span></div>

    {loading ? <div className="panel community-loading">Loading challenges…</div> : <div className="challenge-grid">
      {(dashboard?.challenges ?? []).map((challenge) => {
        const done = Boolean(challenge.completedAt);
        const percent = Math.min(100, Math.round((challenge.progress / Math.max(challenge.goal, 1)) * 100));
        return <article className={'challenge-card ' + (done ? 'completed' : '')} key={challenge.id}>
          <div className="challenge-top"><span className="challenge-icon">{done ? <CheckCircle2 /> : <Sparkles />}</span><span className="point-badge">+{challenge.rewardPoints}</span></div>
          <p className="challenge-category">{challenge.category.replace('-', ' ')}</p>
          <h3>{challenge.title}</h3><p>{challenge.description}</p>
          <div className="challenge-progress"><i style={{width: `${percent}%`}} /></div>
          <div className="challenge-footer"><strong>{done ? 'Completed' : `${challenge.progress} / ${challenge.goal}`}</strong><span>{done ? 'Reward earned' : `${percent}%`}</span></div>
        </article>;
      })}
    </div>}

    <div className="panel reward-rules"><h2>How points work</h2><div className="reward-rule-grid"><span><b>+20</b>Nearby queue update</span><span><b>+75</b>Verified wait</span><span><b>+15</b>Nearby wash-type confirmation</span><span><b>Bonus</b>Challenge completion</span></div><p>Contribution points are capped daily to discourage farming. Challenge rewards are one-time. Radar Points never change the trust weight of a report.</p></div>
  </section>;
}
