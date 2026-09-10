import {appConfig, hasSupabaseConfiguration} from '../config/env';
import {DemoRepository} from './demoRepository';
import {SupabaseRepository} from './supabaseRepository';
import {UnavailableRepository, type ContributionMetrics, type WashRepository} from './repository';
import {supabaseClient} from './supabaseClient';

const emptyMetrics: ContributionMetrics = {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0};
const supabaseRepository = new SupabaseRepository();
const loadSupabaseMetrics = supabaseRepository.metrics.bind(supabaseRepository);

// A normal browser visitor has no Supabase auth session until they contribute or sign in.
// Avoid sending an RPC that can only describe a contributor in that state; this removes
// a noisy 401 from every read-only guest journey without creating anonymous users early.
supabaseRepository.metrics = async () => {
  const {data: {session}} = await supabaseClient.auth.getSession();
  return session ? loadSupabaseMetrics() : emptyMetrics;
};

export const repository: WashRepository = appConfig.demoMode
  ? new DemoRepository()
  : hasSupabaseConfiguration
    ? supabaseRepository
    : new UnavailableRepository();
