import {BadgeCheck, Star} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {Modal} from './Modal';
import {analytics} from '../services/analytics';
import {
  WASH_RATING_TAGS,
  getWashRatingSummary,
  submitWashRating,
  type WashRatingInput,
  type WashRatingSummary,
  type WashRatingTag,
} from '../services/washRatings';

const EMPTY_FORM: WashRatingInput = {overall: 0, quality: null, value: null, equipment: null, tags: []};

export function WashRatingPanel({washId}: {washId: string}) {
  const [summary, setSummary] = useState<WashRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<WashRatingInput>(EMPTY_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getWashRatingSummary(washId)
      .then((value) => { if (!cancelled) setSummary(value); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [washId]);

  const ratingLabel = useMemo(() => {
    if (!summary?.ratingCount || summary.rating === null) return 'No WashRadar ratings yet';
    return `${summary.rating.toFixed(1)} out of 5`;
  }, [summary]);

  const openRating = () => {
    const mine = summary?.myRating;
    setForm(mine ? {
      overall: mine.overall,
      quality: mine.quality,
      value: mine.value,
      equipment: mine.equipment,
      tags: mine.tags,
    } : EMPTY_FORM);
    setOpen(true);
  };

  const toggleTag = (tag: WashRatingTag) => {
    setForm((current) => {
      if (current.tags.includes(tag)) return {...current, tags: current.tags.filter((item) => item !== tag)};
      if (current.tags.length >= 3) {
        toast.message('Choose up to three highlights.');
        return current;
      }
      return {...current, tags: [...current.tags, tag]};
    });
  };

  const save = async () => {
    if (form.overall < 1) {
      toast.error('Choose an overall rating first.');
      return;
    }
    setBusy(true);
    try {
      const edited = Boolean(summary?.myRating);
      const next = await submitWashRating(washId, form);
      setSummary(next);
      analytics.track('rating_submitted', {
        washId,
        overall: form.overall,
        verifiedVisit: Boolean(next.myRating?.verifiedVisit),
        edited,
      });
      setOpen(false);
      toast.success(next.myRating?.verifiedVisit ? 'Rating saved · verified visit' : 'Rating saved. Thanks for helping other drivers.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your rating could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <section className="panel wash-rating-panel" aria-labelledby="washradar-rating-heading">
      <div className="rating-panel-heading">
        <div>
          <p className="eyebrow">WASHRADAR RATINGS</p>
          <h2 id="washradar-rating-heading">What drivers think</h2>
        </div>
        {!loading && <button className="secondary-button rate-wash-button" onClick={openRating}>{summary?.myRating ? 'Edit my rating' : 'Rate this wash'}</button>}
      </div>

      {loading ? <div className="rating-skeleton" aria-label="Loading WashRadar ratings" /> : !summary ?
        <div className="no-reports"><strong>Ratings temporarily unavailable</strong><p>The rest of this wash listing is still available.</p></div>
        : summary.ratingCount === 0 ?
          <div className="rating-empty">
            <div className="rating-empty-star"><Star size={24} /></div>
            <div><strong>No WashRadar ratings yet</strong><p>Be the first to leave a quick structured rating. No written review is required.</p></div>
          </div>
        : <>
          <div className="rating-overview">
            <div className="rating-score" aria-label={ratingLabel}>
              <strong>{summary.rating?.toFixed(1)}</strong>
              <span><Star size={18} fill="currentColor" /> {summary.ratingCount} {summary.ratingCount === 1 ? 'rating' : 'ratings'}</span>
            </div>
            <div className="rating-breakdown">
              <RatingMetric label="Wash quality" value={summary.quality} />
              <RatingMetric label="Value" value={summary.value} />
              <RatingMetric label="Equipment" value={summary.equipment} />
            </div>
          </div>

          {summary.verifiedVisitCount > 0 && <p className="verified-rating-note"><BadgeCheck size={16} /> {summary.verifiedVisitCount} {summary.verifiedVisitCount === 1 ? 'rating is' : 'ratings are'} backed by a verified WashRadar visit.</p>}

          {summary.tags.length > 0 && <div className="rating-tag-summary" aria-label="Common rating highlights">
            {summary.tags.slice(0, 4).map(({tag, count}) => <span key={tag}>{tagLabel(tag)} <b>{count}</b></span>)}
          </div>}
        </>}

      {summary?.myRating && <p className="my-rating-note"><Star size={14} fill="currentColor" /> Your rating: {summary.myRating.overall}/5 {summary.myRating.verifiedVisit && <><span>·</span> <BadgeCheck size={14} /> Verified visit</>}</p>}
    </section>

    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      title={summary?.myRating ? 'Edit my WashRadar rating' : 'Rate this wash'}
      description="Quick structured ratings help drivers judge wash quality without creating a free-text review feed."
    >
      <div className="rating-form">
        <RatingQuestion label="Overall rating" required value={form.overall || null} onChange={(value) => setForm((current) => ({...current, overall: value ?? 0}))} />

        <div className="rating-form-divider" />
        <p className="rating-form-hint"><strong>Optional details</strong><br />Add only the parts you feel confident rating.</p>
        <RatingQuestion label="Wash quality" value={form.quality} onChange={(value) => setForm((current) => ({...current, quality: value}))} />
        <RatingQuestion label="Value for money" value={form.value} onChange={(value) => setForm((current) => ({...current, value}))} />
        <RatingQuestion label="Equipment" value={form.equipment} onChange={(value) => setForm((current) => ({...current, equipment: value}))} />

        <div className="rating-form-divider" />
        <div className="rating-tags-heading"><div><strong>What stood out?</strong><span>Choose up to 3</span></div><small>{form.tags.length}/3</small></div>
        <div className="rating-tag-picker">
          {WASH_RATING_TAGS.map((tag) => <button
            type="button"
            key={tag.id}
            className={form.tags.includes(tag.id) ? 'selected' : ''}
            aria-pressed={form.tags.includes(tag.id)}
            onClick={() => toggleTag(tag.id)}
          >{tag.label}</button>)}
        </div>

        <p className="rating-privacy-note"><BadgeCheck size={15} /> Verified visit is assigned automatically only when WashRadar already has nearby queue or wait-timer evidence from your contributor session. It cannot be self-selected.</p>
        <button className="primary-button full rating-submit" disabled={busy || form.overall < 1} onClick={() => void save()}>{busy ? 'Saving…' : summary?.myRating ? 'Update rating' : 'Submit rating'}</button>
      </div>
    </Modal>
  </>;
}

function RatingMetric({label, value}: {label: string; value: number | null}) {
  return <div><span>{label}</span><strong>{value === null ? '—' : value.toFixed(1)}</strong></div>;
}

function RatingQuestion({label, value, onChange, required = false}: {label: string; value: number | null; onChange: (value: number | null) => void; required?: boolean}) {
  return <div className="rating-question">
    <div><strong>{label}</strong>{!required && value !== null && <button type="button" className="rating-clear" onClick={() => onChange(null)}>Clear</button>}</div>
    <div className="star-picker" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => <button
        type="button"
        key={star}
        aria-label={`${star} star${star === 1 ? '' : 's'}`}
        aria-pressed={value === star}
        className={value !== null && star <= value ? 'selected' : ''}
        onClick={() => onChange(star)}
      ><Star size={22} fill="currentColor" /></button>)}
      <span>{value ? `${value}/5` : required ? 'Choose' : 'Optional'}</span>
    </div>
  </div>;
}

function tagLabel(tag: WashRatingTag) {
  return WASH_RATING_TAGS.find((item) => item.id === tag)?.label ?? tag;
}
