/**
 * BaselineReqs Integration Helper
 *
 * Centralises all outbound calls from BaselineDocs → BaselineReqs so that
 * both the standard delete flow and the admin delete flow share identical
 * logic.  All functions fail open — if BaselineReqs is unreachable or
 * BASELINEREQS_DOMAIN is not configured, operations proceed normally.
 *
 * URL construction: each call is directed to the tenant's own subdomain on
 * baselinereqs.com (e.g. acme.baselinereqs.com) so tenant isolation is
 * enforced at the network level, not just in query params.
 */

import { logger } from '@/lib/logger'

/** Timeout for all outbound BaselineReqs calls (ms). */
const TIMEOUT_MS = 3000

export interface BaselineReqsReference {
  attachment_id: string
  attachment_title: string
  item_id: string
  item_title: string
  item_type: string
  item_req_number: string
  project_id: string
  project_name: string
  project_pid: string
  reqs_url: string
}

export interface BaselineReqsLinksResult {
  linked: boolean
  count: number
  references: BaselineReqsReference[]
}

/**
 * Build the canonical public URL for a BaselineDocs document.
 * e.g.  https://acme.baselinedocs.com/documents/<uuid>
 */
export function buildDocumentUrl(subdomain: string, documentId: string): string {
  return `https://${subdomain}.baselinedocs.com/documents/${documentId}`
}

/**
 * Build the BaselineReqs base URL for a specific tenant.
 * e.g.  https://acme.baselinereqs.com
 */
function buildBaselineReqsUrl(subdomain: string): string {
  const domain = process.env.BASELINEREQS_DOMAIN
  return `https://${subdomain}.${domain}`
}

/**
 * Check whether any BaselineReqs items reference this document URL.
 * Returns null if the integration is not configured or the request fails
 * (fail-open — callers should treat null as "no references known").
 *
 * @param revalidate  Next.js fetch revalidation seconds. Default 0 (no-store)
 *                    — always pass 0 for delete-guard calls so you get fresh
 *                    data. Pass 300 for badge fetches where a 5-minute cache
 *                    is acceptable.
 */
export async function checkBaselineReqsReferences(
  subdomain: string,
  documentId: string,
  revalidate: number | false = false
): Promise<BaselineReqsLinksResult | null> {
  const domain = process.env.BASELINEREQS_DOMAIN
  const secret = process.env.INTEGRATION_SECRET

  if (!domain || !secret) {
    // Integration not configured — skip silently
    return null
  }

  const docUrl = buildDocumentUrl(subdomain, documentId)
  const baseUrl = buildBaselineReqsUrl(subdomain)

  try {
    const res = await fetch(
      `${baseUrl}/api/integrations/docs-links?doc_url=${encodeURIComponent(docUrl)}&subdomain=${encodeURIComponent(subdomain)}`,
      {
        headers: { 'x-integration-key': secret },
        next: revalidate === false ? undefined : { revalidate },
        cache: revalidate === false ? 'no-store' : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )

    if (!res.ok) {
      logger.warn(
        { subdomain, documentId, status: res.status },
        'BaselineReqs reference check returned non-OK status'
      )
      return null
    }

    return (await res.json()) as BaselineReqsLinksResult
  } catch (err) {
    logger.warn(
      { subdomain, documentId, error: err instanceof Error ? err.message : String(err) },
      'BaselineReqs reference check failed — proceeding with delete'
    )
    return null
  }
}

/**
 * Check BaselineReqs references across ALL versions of a document.
 *
 * Each version has its own UUID and therefore its own canonical URL.
 * BaselineReqs stores links by URL, so a requirement linked to vA stays
 * linked to that specific URL even after v1 is released. This function
 * fetches in parallel for every version ID and merges the results so the
 * badge always reflects the full picture regardless of which version was
 * originally linked.
 *
 * Deduplicates by attachment_id in case the same requirement somehow
 * references multiple versions of the same document.
 */
export async function checkBaselineReqsReferencesForAllVersions(
  subdomain: string,
  versionIds: string[],
  revalidate: number | false = false
): Promise<BaselineReqsLinksResult | null> {
  if (versionIds.length === 0) return null

  const results = await Promise.all(
    versionIds.map((id) => checkBaselineReqsReferences(subdomain, id, revalidate))
  )

  // Merge all non-null results
  const allReferences: BaselineReqsReference[] = []
  const seenAttachmentIds = new Set<string>()

  for (const result of results) {
    if (!result?.linked) continue
    for (const ref of result.references) {
      if (!seenAttachmentIds.has(ref.attachment_id)) {
        seenAttachmentIds.add(ref.attachment_id)
        allReferences.push(ref)
      }
    }
  }

  if (allReferences.length === 0) {
    return { linked: false, count: 0, references: [] }
  }

  return {
    linked: true,
    count: allReferences.length,
    references: allReferences,
  }
}

/**
 * Notify BaselineReqs that a document URL is now broken (document deleted).
 * Fire-and-forget — failures are logged but do not block the caller.
 */
export async function markBaselineReqsLinksBroken(
  subdomain: string,
  documentId: string
): Promise<void> {
  const domain = process.env.BASELINEREQS_DOMAIN
  const secret = process.env.INTEGRATION_SECRET

  if (!domain || !secret) return

  const docUrl = buildDocumentUrl(subdomain, documentId)
  const baseUrl = buildBaselineReqsUrl(subdomain)

  try {
    const res = await fetch(`${baseUrl}/api/integrations/docs-links/mark-broken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-key': secret,
      },
      body: JSON.stringify({ doc_url: docUrl, subdomain }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      logger.warn(
        { subdomain, documentId, docUrl, status: res.status },
        'BaselineReqs mark-broken returned non-OK status'
      )
    } else {
      logger.info(
        { subdomain, documentId, docUrl },
        'BaselineReqs links marked as broken'
      )
    }
  } catch (err) {
    logger.warn(
      { subdomain, documentId, error: err instanceof Error ? err.message : String(err) },
      'BaselineReqs mark-broken call failed'
    )
  }
}
