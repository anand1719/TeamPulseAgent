// =============================================
// Shared types for the TeamPulse web chat.
// Mirrors the nextgen-standup-bot API payloads.
// =============================================

export type Team = {
  id: number;
  team_name?: string;
  schedule_time?: string;
  timezone?: string;
  description?: string;
};

export type Member = {
  id: number;
  team_id?: number;
  name: string;
  email?: string;
  role?: string;
};

export type WorkItem = {
  id?: number | string;
  external_ticket_id?: string;
  db_id?: number;
  title?: string;
  state?: string;
  status?: string;
  days_inactive?: number;
  days_in_state?: number;
};

export type Question = {
  id: number;
  question: string;
  question_status: string;
  ticket_id?: string | null;
  work_item_title?: string | null;
  work_item_state?: string | null;
  days_in_state?: number | null;
  member_name?: string;
  sentiment?: string | null;
  blocker_detected?: boolean | null;
  risk_detected?: boolean | null;
  risk_reason?: string | null;
  response?: string | null;
};

export type Session = {
  id: number;
  status?: string;
  lifecycle_status?: string;
  standup_date?: string;
  response_deadline?: string | null;
};

export type ScheduleInfo = {
  cron: string;
  scheduleTime: string;
  startedBy: string;
};

export type Progress = {
  total: number;
  answered: number;
  noResponse: number;
  allAnswered: boolean;
};

export type AdoProposal = {
  id?: number;
  ticket_id?: string;
  external_ticket_id?: string;
  title?: string;
  current_state?: string;
  proposed_status?: string;
  proposed_comment?: string;
  applied_status?: string | null;
  applied?: boolean;
};

export type AnalysisResult = {
  sentiment?: string;
  blocker_detected?: boolean;
  risk_detected?: boolean;
  risk_reason?: string;
};

export type AnswerResult = {
  alreadyAnswered?: boolean;
  analysis?: AnalysisResult;
  nextQuestion?: Question | null;
  progress?: Progress;
  completed?: boolean;
  summary?: { summary?: string } | null;
  sessionId?: number;
  adoProposals?: AdoProposal[];
};

export type ConfirmResult = {
  ticketId?: string;
  updateId?: number;
  success: boolean;
  alreadyApplied?: boolean;
  status?: string | null;
  error?: string | null;
};

export type Insight = {
  summary?: string;
  blockers?: string | null;
  risks?: string | null;
  recommendations?: string | null;
  sentiment?: string;
  risk_level?: string;
};

export type SummaryData = {
  session?: Session | null;
  questions?: Question[];
  insight?: Insight | null;
  escalations?: unknown[];
  progress?: Progress;
  adoProposals?: AdoProposal[];
};

export type Health = {
  success: boolean;
  service: string;
  time: string;
};

export type BootstrapData = {
  standupScheduled: boolean;
  schedule?: ScheduleInfo;
  sessionCompleted?: boolean;
  team?: Team | null;
  members?: Member[];
  member?: Member | null;
  session?: Session | null;
  questions?: Question[];
  workItems?: WorkItem[];
  progress?: Progress;
  adoProposals?: AdoProposal[];
};
