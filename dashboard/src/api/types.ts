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

  // evaluation
  evaluation_json?: string

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
  | 'imported'
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

export interface FsboScrapeStatus {
  running: boolean
  job_id: string | null
  log_lines: string[]
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  phase: string
}

export type CourtRecordCaseStatus = 'new' | 'qualified' | 'junk' | 'ingested'

export interface CourtRecordCounty {
  id: number
  county: string
  state: string
  court_id: string
  appraiser_url: string | null
  appraiser_type: string | null
  active: number
  last_scraped_at: string | null
  created_at: string
  updated_at: string
  case_count: number
  ingested_count: number
}

export interface CourtRecordCase {
  id: number
  county_id: number | null
  case_number: string
  court_id: string
  case_type: string
  file_date: string | null
  case_title: string | null
  deceased_name: string | null
  pr_name: string | null
  pr_address: string | null
  pr_role: string | null
  property_address: string | null
  property_city: string | null
  property_state: string | null
  property_zip: string | null
  apn: string | null
  assessed_value: number | null
  market_value: number | null
  match_confidence: string | null
  case_url: string | null
  case_hash: string
  lead_id: string | null
  status: CourtRecordCaseStatus
  created_at: string
  updated_at: string
  county_name: string | null
}

export interface CourtRecordStats {
  total_cases: number
  new_cases: number
  qualified_cases: number
  ingested_cases: number
  with_property: number
  total_counties: number
  active_counties: number
  by_county: Record<string, number>
}

export interface CourtRecordScrapeStatus {
  running: boolean
  job_id: string | null
  log_lines: string[]
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  phase: string
}

export interface CountyScouting {
  fips: string
  county: string
  state: string
  population: number
  median_home_value: number
  search_term: string
  scouted_at: string | null
  pre_foreclosure_count: number | null
  tax_delinquent_count: number | null
  probate_count: number | null
  vacant_sfr_count: number | null
  total_distressed: number | null
  static_score: number
  scouted_score: number | null
  last_harvested_at: string | null
  harvest_count: number
  leads_generated: number
  regulatory_tier: string
  updated_at: string
}

export interface CountyScoutingStats {
  total: number
  eligible: number
  scouted: number
  harvested: number
  top_counties: CountyScouting[]
}

export interface ScoutPipelineStatus {
  running: boolean
  job_id: string | null
  log_lines: string[]
  started_at: string | null
  completed_at: string | null
  phase: string
}

export interface DistressedProperty {
  address: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  violation_type: string
  violation_subtype: string
  severity: number
  date_opened: string
  case_id: string
  source_city: string
}

// ── Call Recordings ───────────────────────────────────────────

export type CallScore = 'Strong' | 'Average' | 'Needs Work'
export type SellerSentiment = 'Hot' | 'Warm' | 'Cold' | 'Dead'

export interface MyPerformanceGrade {
  controlled_conversation: string
  uncovered_motivation: string
  handled_objections: string
  momentum_loss: string
  score: number
  summary: string
}

export interface SellerMotivationGrade {
  core_reason: string
  motivation_level: number
  emotional_or_logical: string
  timeline: string
  overall_sentiment: SellerSentiment
  summary: string
}

export interface CallRecording {
  id: number
  seller_name: string
  property_address: string | null
  call_date: string | null
  file_path: string | null
  file_name: string | null
  file_type: string | null
  transcript: string | null
  my_performance_json: string | null
  seller_motivation_json: string | null
  call_score: CallScore | null
  next_action: string | null
  next_action_due: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CallRecordingStats {
  total: number
  transcribed: number
  graded: number
  by_score: Record<string, number>
}

// ── Underwriting ─────────────────────────────────────────────

export interface UnderwritingReport {
  id: number
  lead_id: string
  arv_propstream: number | null
  arv_county: number | null
  arv_zillow: number | null
  arv_final: number | null
  arv_confidence: number | null
  arv_sources_json: string | null
  repair_estimate_low: number | null
  repair_estimate_high: number | null
  repair_notes: string | null
  mao_70: number | null
  mao_65: number | null
  assignment_fee_low: number | null
  assignment_fee_high: number | null
  cash_on_cash_buyer: number | null
  holding_costs: number | null
  photo_urls_json: string | null
  street_view_url: string | null
  zillow_url: string | null
  county_assessor_url: string | null
  propstream_url: string | null
  condition_assessment: string | null
  situation_summary: string | null
  discrepancies_json: string | null
  overall_grade: string | null
  recommendation: string | null
  status: string
  created_at: string
  updated_at: string
  // joined
  address_full?: string
  owner_name?: string
  lead?: Lead
}

export interface EvaluationStatus {
  running: boolean
  log_lines: string[]
  started_at: string | null
  completed_at: string | null
  total: number
  processed: number
  passed: number
  failed: number
  phase: string
}

// ── KPI ──────────────────────────────────────────────────────

export interface ConversionFunnel {
  transitions: Record<string, number>
  current: Record<string, number>
  days_back: number
}

export interface CallMetrics {
  calls_made: number
  contacted: number
  interested: number
  voicemails: number
  contact_rate: number
  interest_rate: number
  days_back: number
}

export interface DailyActivity {
  day: string
  calls: number
  interested: number
  queued: number
  total_transitions: number
}

export interface SourceRoi {
  source: string
  total_leads: number
  queued: number
  contacted: number
  interested: number
  in_underwriting: number
  closed_won: number
}
