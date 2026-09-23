import { isPlaneJsonRecord } from '../../shared/plane-json-record'

/**
 * Plane list endpoints are cursor paginated: the payload carries `results`
 * plus `next_cursor` / `next_page_results`. Bounds are deliberate — a
 * mis-scoped filter must not spend the whole per-minute budget walking pages.
 */

export const PLANE_PAGE_SIZE = 100
const DEFAULT_MAX_ITEMS = 250
const DEFAULT_MAX_PAGES = 20

export type PlanePageResult = {
  items: unknown[]
  /** True when the walk stopped at a bound rather than the end of the data. */
  truncated: boolean
}

export async function listAllPages(
  fetchPage: (cursor: string | undefined) => Promise<unknown>,
  options: { maxItems?: number; maxPages?: number } = {}
): Promise<PlanePageResult> {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const items: unknown[] = []
  let cursor: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const payload = await fetchPage(cursor)
    // Some Plane deployments return a bare array for small collections.
    if (Array.isArray(payload)) {
      items.push(...payload)
      return { items: items.slice(0, maxItems), truncated: items.length > maxItems }
    }
    const record = isPlaneJsonRecord(payload) ? payload : {}
    // Why: the payload is unvalidated JSON; a proxy error page or an odd
    // deployment can put a string or object under `results`.
    items.push(...(Array.isArray(record.results) ? record.results : []))
    const nextCursor = typeof record.next_cursor === 'string' ? record.next_cursor : undefined
    const hasMore = record.next_page_results === true && Boolean(nextCursor)
    // Why: data ending exactly on the bound is complete, not truncated. Checking
    // the bound first made a project of exactly 100 items report a false
    // "results were cut off".
    if (items.length >= maxItems) {
      return { items: items.slice(0, maxItems), truncated: hasMore || items.length > maxItems }
    }
    if (!hasMore) {
      return { items, truncated: false }
    }
    cursor = nextCursor
  }
  return { items, truncated: true }
}
