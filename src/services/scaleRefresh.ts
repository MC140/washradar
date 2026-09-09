import type {QueueSignal} from '../domain/models';
import {supabaseClient} from './supabaseClient';

export async function loadQueueSignals(washIds: string[]): Promise<QueueSignal[]> {
  const ids = [...new Set(washIds)].slice(0, 100);
  if (!ids.length) return [];
  const {data, error} = await supabaseClient.rpc('queue_signal_feed', {p_wash_ids: ids});
  if (error) throw new Error('Live queue updates are temporarily unavailable.');
  return (data ?? []) as QueueSignal[];
}
