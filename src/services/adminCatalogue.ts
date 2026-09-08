import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import type {CatalogueImportProgress, CatalogueImportResult} from './repository';

const GTA_QUERIES = [
  'car wash in Toronto, Ontario, Canada',
  'car wash in North York, Ontario, Canada',
  'car wash in Scarborough, Ontario, Canada',
  'car wash in Etobicoke, Ontario, Canada',
  'car wash in York, Toronto, Ontario, Canada',
  'car wash in East York, Ontario, Canada',
  'car wash in Mississauga, Ontario, Canada',
  'car wash in Brampton, Ontario, Canada',
  'car wash in Caledon, Ontario, Canada',
  'car wash in Oakville, Ontario, Canada',
  'car wash in Burlington, Ontario, Canada',
  'car wash in Milton, Ontario, Canada',
  'car wash in Halton Hills, Ontario, Canada',
  'car wash in Vaughan, Ontario, Canada',
  'car wash in Richmond Hill, Ontario, Canada',
  'car wash in Markham, Ontario, Canada',
  'car wash in Aurora, Ontario, Canada',
  'car wash in Newmarket, Ontario, Canada',
  'car wash in King, Ontario, Canada',
  'car wash in Whitchurch-Stouffville, Ontario, Canada',
  'car wash in East Gwillimbury, Ontario, Canada',
  'car wash in Georgina, Ontario, Canada',
  'car wash in Pickering, Ontario, Canada',
  'car wash in Ajax, Ontario, Canada',
  'car wash in Whitby, Ontario, Canada',
  'car wash in Oshawa, Ontario, Canada',
  'car wash in Clarington, Ontario, Canada',
  'car wash in Uxbridge, Ontario, Canada',
  'car wash in Scugog, Ontario, Canada',
  'car wash in Brock, Ontario, Canada',
] as const;

const JOB_KEY = 'gta-full';

type ImportState = {
  next_index: number;
  total: number;
  last_area: string | null;
  last_error: string | null;
  page_token: string | null;
  page_number: number;
  completed_at: string | null;
};

type FsaAudit = {
  uniqueFsaCount: number;
  suspiciousSparse: {fsa: string; washCount: number}[];
  unknownPostal: number;
};

export async function importFullGtaCatalogue(onProgress?: (progress: CatalogueImportProgress) => void): Promise<CatalogueImportResult> {
  const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
  });

  const stateResponse = await client.functions.invoke('wash-ingest', {body: {action: 'state', jobKey: JOB_KEY}});
  if (stateResponse.error || stateResponse.data?.error) {
    throw new Error(stateResponse.data?.error || 'Saved GTA import progress could not be loaded.');
  }

  let state = (stateResponse.data?.state ?? null) as ImportState | null;
  let startIndex = Math.min(Math.max(Number(state?.next_index ?? 0), 0), GTA_QUERIES.length);

  if (startIndex >= GTA_QUERIES.length && state?.completed_at) {
    await saveCheckpoint(client, {nextIndex: 0, total: GTA_QUERIES.length, lastArea: 'Starting full refresh', pageToken: null, pageNumber: 0, completed: false});
    startIndex = 0;
    state = null;
  }

  let discovered = 0;
  let imported = 0;
  let updated = 0;
  let hoursRefreshed = 0;
  let typed = 0;

  for (let index = startIndex; index < GTA_QUERIES.length; index++) {
    const query = GTA_QUERIES[index];
    let pageToken: string | undefined = index === startIndex ? state?.page_token ?? undefined : undefined;
    let page = index === startIndex ? Number(state?.page_number ?? 0) : 0;

    do {
      const usedToken = pageToken;
      const {data, error} = await client.functions.invoke('wash-ingest', {
        body: {action: 'text', query, ...(usedToken ? {pageToken: usedToken} : {})},
      });

      if (error || data?.error) {
        const message = data?.error || error?.message || 'Google Places import failed.';
        await saveCheckpoint(client, {
          nextIndex: index,
          total: GTA_QUERIES.length,
          lastArea: query.replace(/^car wash in /, ''),
          lastError: message,
          pageToken: usedToken ?? null,
          pageNumber: page,
          completed: false,
        }).catch(() => undefined);
        throw new Error(`${query.replace(/^car wash in /, '')}: ${message}`);
      }

      discovered += Number(data?.discovered ?? 0);
      imported += Number(data?.imported ?? 0);
      updated += Number(data?.updated ?? 0);
      hoursRefreshed += Number(data?.hoursRefreshed ?? 0);
      typed += Number(data?.typed ?? 0);

      pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
      page++;
      if (page >= 5) pageToken = undefined;

      await saveCheckpoint(client, {
        nextIndex: pageToken ? index : index + 1,
        total: GTA_QUERIES.length,
        lastArea: query.replace(/^car wash in /, ''),
        lastError: null,
        pageToken: pageToken ?? null,
        pageNumber: pageToken ? page : 0,
        completed: false,
      });

      onProgress?.({
        phase: 'discovery',
        area: query.replace(/^car wash in /, ''),
        completed: pageToken ? index : index + 1,
        total: GTA_QUERIES.length,
        discovered,
        imported,
        updated,
        hoursRefreshed,
        typed,
      });
    } while (pageToken);
  }

  await saveCheckpoint(client, {
    nextIndex: GTA_QUERIES.length,
    total: GTA_QUERIES.length,
    lastArea: 'All GTA search areas completed',
    lastError: null,
    pageToken: null,
    pageNumber: 0,
    completed: true,
  });

  let offset = 0;
  let enrichedProcessed = 0;
  while (true) {
    const {data, error} = await client.functions.invoke('wash-ingest', {body: {action: 'enrich', offset, limit: 20}});
    if (error || data?.error) throw new Error(data?.error || error?.message || 'Saved wash enrichment failed.');

    enrichedProcessed += Number(data?.processed ?? 0);
    updated += Number(data?.updated ?? 0);
    hoursRefreshed += Number(data?.hoursRefreshed ?? 0);
    typed += Number(data?.typed ?? 0);

    onProgress?.({
      phase: 'enrichment',
      area: `Repairing saved Google details · ${enrichedProcessed} processed`,
      completed: GTA_QUERIES.length,
      total: GTA_QUERIES.length,
      discovered,
      imported,
      updated,
      hoursRefreshed,
      typed,
      enrichedProcessed,
    });

    if (data?.nextOffset === null || data?.nextOffset === undefined) break;
    offset = Number(data.nextOffset);
  }

  const auditResponse = await client.functions.invoke('wash-ingest', {body: {action: 'fsa-audit'}});
  if (auditResponse.error || auditResponse.data?.error) throw new Error(auditResponse.data?.error || 'FSA coverage audit failed.');
  const audit = auditResponse.data as FsaAudit;

  onProgress?.({
    phase: 'coverage',
    area: `FSA coverage audit · ${audit.uniqueFsaCount} prefixes represented`,
    completed: GTA_QUERIES.length,
    total: GTA_QUERIES.length,
    discovered,
    imported,
    updated,
    hoursRefreshed,
    typed,
    enrichedProcessed,
    uniqueFsaCount: audit.uniqueFsaCount,
    sparseFsaCount: audit.suspiciousSparse.length,
  });

  return {
    discovered,
    imported,
    updated,
    areasCompleted: GTA_QUERIES.length,
    hoursRefreshed,
    typed,
    enrichedProcessed,
    uniqueFsaCount: audit.uniqueFsaCount,
    sparseFsaCount: audit.suspiciousSparse.length,
    unknownPostal: audit.unknownPostal,
  };
}

async function saveCheckpoint(client: SupabaseClient, input: {
  nextIndex: number;
  total: number;
  lastArea: string;
  lastError?: string | null;
  pageToken?: string | null;
  pageNumber?: number;
  completed?: boolean;
}) {
  const {data, error} = await client.functions.invoke('wash-ingest', {
    body: {
      action: 'checkpoint',
      jobKey: JOB_KEY,
      nextIndex: input.nextIndex,
      total: input.total,
      lastArea: input.lastArea,
      lastError: input.lastError ?? null,
      pageToken: input.pageToken ?? null,
      pageNumber: input.pageNumber ?? 0,
      completed: input.completed ?? false,
    },
  });
  if (error || data?.error) throw new Error(data?.error || 'Catalogue progress could not be saved.');
}

export const GTA_IMPORT_QUERY_COUNT = GTA_QUERIES.length;
