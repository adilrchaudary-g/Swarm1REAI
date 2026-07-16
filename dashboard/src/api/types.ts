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

export interface BattleScore {
  objection_handling: number
  objection_notes: string
  conversation_control: number
  control_notes: string
  kept_on_phone: number
  phone_notes: string
  stayed_grounded: number
  grounded_notes: string
  overall: number
  summary: string
  // Legacy compat
  score?: number
}

export interface SellerMotivationGrade {
  core_reason: string
  motivation_level: number
  overall_sentiment: SellerSentiment
  summary: string
  // Legacy fields
  emotional_or_logical?: string
  timeline?: string
}

/** @deprecated Use BattleScore */
export type MyPerformanceGrade = BattleScore

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
  lead_id: string | null
  created_at: string
  updated_at: string
}

export interface CallRecordingStats {
  total: number
  transcribed: number
  graded: number
  pending_grade?: number
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
  total_dials: number
  unique_leads_called: number
  pickups: number
  interested: number
  voicemails: number
  no_answers: number
  bad_numbers: number
  pickup_rate: number
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

export interface TrackerKpis {
  calls_today: number
  real_convos_today: number
  voicemails_today: number
  bad_numbers_today: number
  pickup_rate: number
  real_leads_week: number
  calls_week: number
  disposition_breakdown: Record<string, number>
  history: TrackerDayPoint[]
}

export interface TrackerDayPoint {
  day: string
  calls: number
  convos: number
  leads: number
}

export interface DialStreak {
  current_streak: number
  best_streak: number
  total_active_days: number
  last_dial_date: string | null
}

// ── Contracts ───────────────────────────────────────────────

export type ContractStatus = 'draft' | 'pending_seller' | 'fully_signed' | 'voided' | 'expired'

export interface Contract {
  id: number
  lead_id: string
  contract_type: string
  status: ContractStatus
  contract_data_json: string
  purchaser_name: string | null
  purchaser_address: string | null
  seller_name: string | null
  seller_address: string | null
  property_address: string | null
  property_county: string | null
  property_state: string | null
  option_fee: number | null
  purchase_price: number | null
  amount_due_at_closing: number | null
  option_term_end_date: string | null
  closing_date: string | null
  purchaser_signature: string | null
  purchaser_signed_at: string | null
  seller_signature: string | null
  seller_signed_at: string | null
  signing_token: string | null
  signing_url: string | null
  signing_email_sent_at: string | null
  seller_email: string | null
  pdf_path: string | null
  signed_pdf_path: string | null
  created_at: string
  updated_at: string
  // joined
  address_full?: string
  owner_name?: string
}

export interface ContractData {
  lead_id: string
  contract_type?: string
  purchaser_name: string
  purchaser_address: string
  seller_name: string
  seller_address: string
  property_address: string
  property_county: string
  property_state: string
  option_fee: number
  purchase_price: number
  option_term_end_date: string
  closing_date: string
  seller_email?: string
  contract_date_day?: string
  contract_date_month?: string
  contract_date_year?: string
}

export interface UserSettings {
  purchaser_name?: string
  purchaser_address?: string
  gmail_user?: string
  gmail_app_password?: string
  [key: string]: string | undefined
}

// ── Agents ──────────────────────────────────────────────────

export interface AgentDefinition {
  agent_type: string
  display_name: string
  description: string | null
  prompt_template: string | null
  schedule: string
  enabled: number
  config_json: string
  created_at: string
  updated_at: string
  last_run_id: string | null
  last_run_status: string | null
  last_run_at: string | null
  running?: boolean
}

export interface AgentRun {
  run_id: string
  agent_type: string
  status: string
  phase: string
  started_at: string
  completed_at: string | null
  leads_scanned: number
  proposals_created: number
  ai_calls_made: number
  ai_available: number
  log_lines_json: string
  error: string | null
  result_json: string | null
}

export type ProposalStatus = 'pending' | 'approved' | 'denied' | 'revised'

export interface Proposal {
  id: number
  agent_type: string
  run_id: string
  title: string
  description: string | null
  payload_json: string
  priority: string
  status: ProposalStatus
  revision_notes: string | null
  resolved_at: string | null
  created_at: string
}

export interface AgentProxyStatus {
  scheduler_active: boolean
  running_agents: Record<string, boolean>
  proxy: {
    available: boolean
    queue_depth: number
    total_calls: number
  }
}

// ── Mega-Agent Chat ─────────────────────────────────────────────

export interface Conversation {
  id: number
  user_id: number
  title: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface ConversationMessage {
  id: number
  conversation_id: number
  role: 'user' | 'agent' | 'system'
  agent_type: string | null
  content: string
  metadata_json: string | null
  metadata: {
    actions_taken?: Array<{ operation: string; params?: Record<string, unknown>; result?: unknown; error?: string }>
    confirmation?: { id: number; action: string; description: string; params: Record<string, unknown> }
    confirmed?: boolean
    cancelled?: boolean
    data?: unknown
  } | null
  created_at: string
}

export interface ChatResponse {
  conversation_id: number
  agent_type: string
  content: string
  actions_taken?: Array<{ operation: string; params?: Record<string, unknown>; result?: unknown }>
  confirmation?: { id: number; action: string; description: string; params: Record<string, unknown> }
  data?: unknown
}

// ── Caller Availability Schedule ──────────────────────────────────

export type AvailabilityStatus = 'available' | 'unavailable'

export interface CallerAvailability {
  id: number
  user_id: number
  date: string
  status: AvailabilityStatus
  start_time: string | null
  end_time: string | null
  notes: string | null
  display_name: string
  username: string
  role?: string
  created_at: string
  updated_at: string
}

// ── Finances ──────────────────────────────────────────────────────

export interface Expense {
  id: number
  name: string
  category: string
  amount: number
  frequency: string
  active: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Revenue {
  id: number
  deal_address: string | null
  assignment_fee: number
  lead_id: string | null
  caller_user_id: number | null
  caller_name: string | null
  closed_at: string
  commission_paid: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PayrollEntry {
  id: number
  user_id: number
  caller_name: string
  week_start: string
  week_end: string
  hours_worked: number
  hourly_rate: number
  base_pay: number
  commission: number
  total_pay: number
  paid: number
  paid_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Activity Tracking ──────────────────────────────────────────────

export interface CallerDailyLog {
  id: number
  user_id: number
  caller_name: string
  log_date: string
  hours_claimed: number
  dials_claimed: number
  leads_set_claimed: number
  notes: string | null
  submitted_at: string
  updated_at: string
}

export interface ActivitySession {
  start: string
  end: string
  duration_min: number
  calls: number
}

export interface ActivityGap {
  after_session: number
  gap_minutes: number
  from: string
  to: string
}

export interface HourlyBreakdown {
  hour: number
  label: string
  dials: number
  billable: boolean
  threshold: number
}

export interface CallerActivity {
  user_id: number
  date: string
  total_calls: number
  active_minutes: number
  billable_hours: number
  hourly_breakdown: HourlyBreakdown[]
  sessions: ActivitySession[]
  buckets: Record<string, number>
  gaps: ActivityGap[]
  calls_per_hour: number | null
  first_call: string | null
  last_call: string | null
  disposition_counts: Record<string, number>
}

export interface ActivityDaySummary {
  user_id: number
  caller_name: string
  call_date: string
  actual_dials: number
  first_call: string
  last_call: string
  actual_leads_set: number
  actual_span_hours: number
  billable_hours: number
  non_billable_hours: Array<{ hour: number; dials: number }>
  hours_claimed: number | null
  dials_claimed: number | null
  leads_set_claimed: number | null
  log_notes: string | null
  log_submitted: boolean
  integrity_flags: string[]
}

export interface IntegrityCallerReport {
  user_id: number
  caller_name: string
  total_days_active: number
  logs_submitted: number
  logs_missing: number
  flagged_days: number
  total_actual_dials: number
  total_claimed_dials: number
  total_actual_hours: number
  total_claimed_hours: number
  hour_accuracy: number | null
  dial_accuracy: number | null
  trust_score: number | null
  flag_counts: Record<string, number>
}

export interface IntegrityReport {
  date_from: string
  date_to: string
  callers: IntegrityCallerReport[]
}

export interface FinanceSummary {
  monthly_overhead: number
  monthly_caller_cost: number
  total_monthly_cost: number
  total_revenue: number
  deal_count: number
  total_payroll: number
  unpaid_payroll: number
  active_callers: number
  profit: number
}
