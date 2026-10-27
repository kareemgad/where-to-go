/**
 * Reads for the review workflow.
 *
 * Every query is market-scoped by an explicit market_id the caller has already
 * been authorized for. None of these functions decides access — they are given
 * a market, not asked to find one — so a missing authorization check upstream
 * cannot turn into a cross-market read here.
 */

import type { Sql } from 'postgres';

export interface ReviewItem {
  readonly claimId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectLabel: string | null;
  readonly attributeKey: string;
  readonly value: unknown;
  readonly lifecycleState: string;
  readonly evidenceState: string;
  readonly sourceAuthority: string;
  readonly confidenceLabel: string;
  readonly highImpact: boolean;
  readonly conflicted: boolean;
  readonly hasApproval: boolean;
  readonly observedAt: Date;
}

const ITEM_COLUMNS = `
  claim_id         as "claimId",
  subject_kind     as "subjectKind",
  subject_id       as "subjectId",
  subject_label    as "subjectLabel",
  attribute_key    as "attributeKey",
  value,
  lifecycle_state  as "lifecycleState",
  evidence_state   as "evidenceState",
  source_authority as "sourceAuthority",
  confidence_label as "confidenceLabel",
  high_impact      as "highImpact",
  conflicted,
  has_approval     as "hasApproval",
  observed_at      as "observedAt"
`;

export interface QueueSummary {
  readonly total: number;
  readonly conflicted: number;
  readonly highImpact: number;
}

export async function queueSummary(sql: Sql, marketId: string): Promise<QueueSummary> {
  const rows = await sql<{ total: string; conflicted: string; highImpact: string }[]>`
    select
      count(*)                            as total,
      count(*) filter (where conflicted)  as conflicted,
      count(*) filter (where high_impact) as "highImpact"
    from claim_review_items
    where market_id = ${marketId}
  `;
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    conflicted: Number(row?.conflicted ?? 0),
    highImpact: Number(row?.highImpact ?? 0),
  };
}

/**
 * The queue, conflicts first.
 *
 * A conflict means the published page is currently saying nothing about an
 * attribute two credible sources disagree on, so it is the most consequential
 * kind of gap. After that, oldest observation first: a queue sorted by newest
 * hides its own backlog.
 */
export async function listQueueItems(
  sql: Sql,
  marketId: string,
  limit = 50,
): Promise<ReviewItem[]> {
  return sql<ReviewItem[]>`
    select ${sql.unsafe(ITEM_COLUMNS)}
    from claim_review_items
    where market_id = ${marketId}
    order by conflicted desc, high_impact desc, observed_at asc
    limit ${limit}
  `;
}

export interface EvidenceDetail {
  readonly evidenceId: string;
  readonly fieldPointer: string | null;
  readonly excerpt: string | null;
  readonly documentUrl: string | null;
  readonly publisher: string | null;
  readonly capturedAt: Date;
  readonly providerName: string;
  readonly attributionRequired: boolean;
  readonly attributionText: string | null;
  readonly storagePolicy: string;
}

export interface ConflictingClaim {
  readonly claimId: string;
  readonly value: unknown;
  readonly sourceAuthority: string;
  readonly evidenceState: string;
}

export interface PublishedValue {
  readonly version: number;
  readonly value: unknown;
  readonly evidenceState: string;
  readonly sourceAuthority: string;
  readonly publishedAt: Date;
  readonly materialized: boolean;
}

export interface DecisionRecord {
  readonly id: string;
  readonly action: string;
  readonly reason: string | null;
  readonly reviewerId: string | null;
  readonly reviewerEmail: string | null;
  readonly createdAt: Date;
}

export interface ReviewDetail {
  readonly item: ReviewItem;
  readonly evidence: EvidenceDetail | null;
  readonly conflicts: ConflictingClaim[];
  readonly current: PublishedValue | null;
  readonly decisions: DecisionRecord[];
}

/**
 * Everything needed to decide one claim.
 *
 * Returns null when the claim is not in this market, so a reviewer who edits a
 * claim id in the URL gets "not found" rather than another market's evidence.
 * The market is passed in rather than derived here for the same reason the list
 * queries take one.
 */
export async function loadReviewDetail(
  sql: Sql,
  marketId: string,
  claimId: string,
): Promise<ReviewDetail | null> {
  const items = await sql<ReviewItem[]>`
    select ${sql.unsafe(ITEM_COLUMNS)}
    from claim_review_items
    where claim_id = ${claimId} and market_id = ${marketId}
  `;
  const item = items[0];
  if (!item) return null;

  const [evidenceRows, conflictRows, currentRows, decisionRows] = await Promise.all([
    sql<EvidenceDetail[]>`
      select
        e.id            as "evidenceId",
        e.field_pointer as "fieldPointer",
        e.excerpt,
        d.url           as "documentUrl",
        d.publisher,
        d.captured_at   as "capturedAt",
        p.display_name         as "providerName",
        p.attribution_required as "attributionRequired",
        p.attribution_text     as "attributionText",
        p.storage_policy       as "storagePolicy"
      from claims c
      join evidence_records e on e.id = c.evidence_id
      join source_documents d on d.id = e.document_id
      join source_providers p on p.id = d.provider_id
      where c.id = ${claimId}
    `,
    sql<ConflictingClaim[]>`
      select
        conflicting_claim_id as "claimId",
        their_value          as value,
        their_authority      as "sourceAuthority",
        their_evidence       as "evidenceState"
      from app_claim_conflicts(${claimId})
    `,
    sql<PublishedValue[]>`
      select
        pa.version,
        pa.value,
        pa.evidence_state   as "evidenceState",
        pa.source_authority as "sourceAuthority",
        pa.published_at     as "publishedAt",
        pa.materialized
      from published_attributes_current pa
      where pa.subject_kind = ${item.subjectKind}::claim_subject_kind
        and pa.subject_id = ${item.subjectId}
        and pa.attribute_key = ${item.attributeKey}
    `,
    sql<DecisionRecord[]>`
      select
        vd.id,
        vd.action,
        vd.reason,
        vd.reviewer_id as "reviewerId",
        u.email        as "reviewerEmail",
        vd.created_at  as "createdAt"
      from verification_decisions vd
      left join auth.users u on u.id = vd.reviewer_id
      where vd.claim_id = ${claimId}
      order by vd.created_at desc
    `,
  ]);

  return {
    item,
    evidence: evidenceRows[0] ?? null,
    conflicts: conflictRows,
    current: currentRows[0] ?? null,
    decisions: decisionRows,
  };
}

export interface AuditEntry {
  readonly kind: 'decision' | 'publication' | 'rollback';
  readonly at: Date;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly claimId: string | null;
  readonly subjectLabel: string | null;
  readonly attributeKey: string;
  readonly detail: string;
}

/**
 * One chronological trail of what happened in this market.
 *
 * Decisions, publications and rollbacks live in three tables because they are
 * three different events, but a reviewer auditing a mistake is reading a story,
 * not three tables. Emails are joined in from auth.users so the trail names
 * people rather than uuids.
 */
export async function auditTrail(sql: Sql, marketId: string, limit = 100): Promise<AuditEntry[]> {
  return sql<AuditEntry[]>`
    with decisions as (
      select
        'decision'::text as kind,
        d.created_at     as at,
        d.reviewer_id    as actor_id,
        d.claim_id       as claim_id,
        c.subject_kind,
        c.subject_id,
        c.attribute_key,
        d.action::text || coalesce(': ' || d.reason, '') as detail
      from verification_decisions d
      join claims c on c.id = d.claim_id
      where app_claim_market(c.subject_kind, c.subject_id) = ${marketId}
    ),
    publications as (
      select
        case when pa.rolled_back_at is null then 'publication' else 'rollback' end as kind,
        coalesce(pa.rolled_back_at, pa.published_at) as at,
        coalesce(pa.rolled_back_by, pa.published_by) as actor_id,
        pa.published_from_claim_id as claim_id,
        pa.subject_kind,
        pa.subject_id,
        pa.attribute_key,
        case
          when pa.rolled_back_at is null then
            'published version ' || pa.version ||
            case when pa.materialized then '' else ' (no typed column yet)' end
          else
            'rolled back version ' || pa.version ||
            coalesce(': ' || pa.rollback_reason, '')
        end as detail
      from published_attributes pa
      where app_claim_market(pa.subject_kind, pa.subject_id) = ${marketId}
    ),
    combined as (
      select * from decisions
      union all
      select * from publications
    )
    select
      combined.kind,
      combined.at,
      combined.actor_id      as "actorId",
      u.email                as "actorEmail",
      combined.claim_id      as "claimId",
      combined.attribute_key as "attributeKey",
      combined.detail,
      app_claim_subject_label(combined.subject_kind, combined.subject_id) as "subjectLabel"
    from combined
    left join auth.users u on u.id = combined.actor_id
    order by combined.at desc
    limit ${limit}
  `;
}

export interface PublishedAttributeRow {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectLabel: string | null;
  readonly attributeKey: string;
  readonly version: number;
  readonly value: unknown;
  readonly publishedAt: Date;
}

/** Live published values in this market, for the rollback view. */
export async function livePublishedValues(
  sql: Sql,
  marketId: string,
  limit = 100,
): Promise<PublishedAttributeRow[]> {
  return sql<PublishedAttributeRow[]>`
    select
      pa.subject_kind  as "subjectKind",
      pa.subject_id    as "subjectId",
      pa.attribute_key as "attributeKey",
      pa.version,
      pa.value,
      pa.published_at  as "publishedAt",
      app_claim_subject_label(pa.subject_kind, pa.subject_id) as "subjectLabel"
    from published_attributes_current pa
    where app_claim_market(pa.subject_kind, pa.subject_id) = ${marketId}
    order by pa.published_at desc
    limit ${limit}
  `;
}
