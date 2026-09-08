import {createClient} from '@supabase/supabase-js';
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

export async function importFullGtaCatalogue(onProgress?: (progress: CatalogueImportProgress) => void): Promise<CatalogueImportResult> {
  const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
  });

  let discovered = 0;
  let imported = 0;
  let updated = 0;
  let completed = 0;

  for (const query of GTA_QUERIES) {
    let pageToken: string | undefined;
    let page = 0;
    do {
      const {data, error} = await client.functions.invoke('wash-ingest', {
        body: {action: 'text', query, ...(pageToken ? {pageToken} : {})},
      });
      if (error || data?.error) {
        throw new Error(`${query.replace(/^car wash in /, '')}: ${data?.error || error?.message || 'Google Places import failed.'}`);
      }

      discovered += Number(data?.discovered ?? 0);
      imported += Number(data?.imported ?? 0);
      updated += Number(data?.updated ?? 0);
      pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
      page++;

      // Guard against an unexpected endless pagination response.
      if (page >= 5) pageToken = undefined;
    } while (pageToken);

    completed++;
    onProgress?.({
      area: query.replace(/^car wash in /, ''),
      completed,
      total: GTA_QUERIES.length,
      discovered,
      imported,
      updated,
    });
  }

  return {discovered, imported, updated, areasCompleted: completed};
}

export const GTA_IMPORT_QUERY_COUNT = GTA_QUERIES.length;
