export interface Lead {
  lead_id: string
  property_id: string
  owner_id: string
  status: LeadStatus
  source: string | null
  persona_primary: string | null
  persona_scores_json: string | null
  motivation_score: number | null
  motivation_tier: MotivationTier | null
  arv_estimate: number | null
  mao: number | null
  router_decision: string | null
  router_reason: string | null
  distress_signals_json: string | null
  created_at: string
  updated_at: string

  // joined from properties
  address_full: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  property_type: string | null
  parcel_number: string | null
  skip_trace_count: number | null

  // joined from owners
  owner_name: string | null
  owner_type: string | null
  mailing_address: string | null

  // list grouping
  last_list_name: string | null

  // from list endpoint (JSON string)
  phones_json?: string

  // from detail endpoint only
  phone_numbers?: PhoneRecord[]
  email_addresses?: string[]
  notes?: LeadNote[]
  history?: StatusHistoryEntry[]

  // computed by normalizer
  distress_signals: string[]
  callable_phones: PhoneRecord[]
}

export interface PhoneRecord {
  phone_value: string
  phone_digits: string | null
  phone_type: string
  dnc: number | null
}

export interface LeadNote {
  id: number
  lead_id: string
  note_type: string
  content: string
  created_at: string
}

export interface StatusHistoryEntry {
  id: number
  lead_id: string
  from_status: string | null
  to_status: string
  reason: string | null
  created_at: string
}

export type MotivationTier = 'HOT' | 'WARM' | 'LUKEWARM' | 'COLD' | 'ICE'

export type LeadStatus =
  | 'new'
  | 'enriched'
  | 'scored'
  | 'queued'
  | 'contacted'
  | 'interested'
  | 'not_interested'
  | 'follow_up'
  | 'underwriting'
  | 'under_contract'
  | 'closed_won'
  | 'closed_lost'
  | 'dead'
  | 'archived'

export interface PipelineStats {
  total_leads: number
  by_status: Record<string, number>
  by_tier: Record<string, number>
  by_source: Record<string, number>
}

export interface SourceAdapter {
  source_id: string
  source_name: string
  data_quality_tier: string
  enabled: boolean
  last_run_at: string | null
  last_run_status: string | null
  last_run_count: number | null
}

export interface KpiSummary {
  total_leads: number
  deals_closed: number
  pipeline_value: number
  follow_ups_due: number
  by_status: Record<string, number>
  by_tier: Record<string, number>
  by_source: Record<string, number>
}

export interface MarketInfo {
  metro: string
  state: string
  counties: string[]
  median_price: number
  population: number
  cash_buyer_pct: number
  has_code_portal: boolean
  portal_id: string | null
  notes: string
  score: number
  blocked: boolean
  high_friction: boolean
  lead_count: number
}

export interface FollowUp {
  id: number
  lead_id: string
  follow_up_type: string
  scheduled_at: string
  completed_at: string | null
  outcome: string | null
  notes: string | null
  address_full?: string
  owner_name?: string
  lead_status?: string
}

// ── Social / Bandit Comments ────────────────────────────────

export type CommentStatus = 'new' | 'qualified' | 'junk' | 'duplicate' | 'ingested'

export interface SocialComment {
  id: number
  platform: string
  post_url: string
  post_type: 'own_ad' | 'competitor_ad' | 'community_post'
  commenter_name: string
  commenter_profile_url: string | null
  comment_text: string
  comment_date: string
  extracted_name: string | null
  extracted_phone: string | null
  extracted_address: string | null
  extracted_city: string | null
  extracted_state: string | null
  status: CommentStatus
  lead_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SocialCampaign {
  id: number
  platform: string
  campaign_name: string
  post_url: string
  post_type: 'own_ad' | 'competitor_ad' | 'community_post'
  target_market: string
  active: boolean
  total_comments: number
  qualified_comments: number
  last_scraped_at: string | null
  created_at: string
}

export interface SocialBanditStats {
  total_campaigns: number
  active_campaigns: number
  total_comments: number
  new_comments: number
  qualified_comments: number
  ingested_leads: number
  by_platform: Record<string, number>
  by_post_type: Record<string, number>
}

// ── Water Shutoffs ─────────────────────────────────────────

export type FoiaStatus = 'draft' | 'submitted' | 'processing' | 'received' | 'denied' | 'overdue'

export interface FoiaRequest {
  id: number
  city: string
  state: string
  agency_name: string
  agency_contact: string | null
  submission_method: string
  submitted_at: string | null
  expected_response_at: string | null
  status: FoiaStatus
  fee_amount: number | null
  notes: string | null
  file_received: number
  records_imported: number
  record_count: number
  ingested_count: number
  created_at: string
  updated_at: string
}

export interface WaterShutoffRecord {
  id: number
  foia_request_id: number | null
  service_address: string
  city: string | null
  state: string | null
  zip: string | null
  account_holder: string | null
  shutoff_date: string | null
  amount_owed: number | null
  status: 'new' | 'ingested'
  lead_id: string | null
  created_at: string
}

export interface WaterShutoffStats {
  total_requests: number
  pending_requests: number
  received_requests: number
  total_records: number
  new_records: number
  ingested_records: number
  by_city: Record<string, number>
}

// ── FSBOs ──────────────────────────────────────────────────

export type FsboListingStatus = 'new' | 'qualified' | 'junk' | 'ingested'

export interface FsboListing {
  id: number
  zillow_url: string | null
  address: string
  city: string | null
  state: string | null
  zip: string | null
  asking_price: number | null
  original_price: number | null
  zestimate: number | null
  days_on_market: number | null
  price_drops: number
  price_drop_pct: number | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  lot_sqft: number | null
  year_built: number | null
  photo_count: number | null
  description: string | null
  distress_score: number
  distress_flags_json: string | null
  status: FsboListingStatus
  lead_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FsboMarket {
  id: number
  metro: string
  state: string
  median_price: number | null
  zillow_search_url: string | null
  last_scanned_at: string | null
  listing_count: number
  active: number
  current_listings: number
  hot_listings: number
  created_at: string
}

export interface FsboStats {
  total_listings: number
  new_listings: number
  qualified_listings: number
  ingested_leads: number
  hot_listings: number
  avg_distress_score: number
  total_markets: number
  active_markets: number
  by_state: Record<string, number>
}
