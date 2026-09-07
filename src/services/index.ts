import {appConfig, hasSupabaseConfiguration} from '../config/env';
import {DemoRepository} from './demoRepository';
import {SupabaseRepository} from './supabaseRepository';
import {UnavailableRepository, type WashRepository} from './repository';

export const repository: WashRepository = appConfig.demoMode
  ? new DemoRepository()
  : hasSupabaseConfiguration
    ? new SupabaseRepository()
    : new UnavailableRepository();
