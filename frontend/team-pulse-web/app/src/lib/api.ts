// =============================================
// Typed client for the nextgen-standup-bot API.
// Every endpoint the web chat consumes lives here.
// NOTE: there is deliberately NO "start session"
// call - the standup is started only by the
// backend scheduler; the UI joins it.
// =============================================

import type {
  AdoProposal,
  AnswerResult,
  BootstrapData,
  ConfirmResult,
  Health,
  Member,
  Question,
  SummaryData,
  WorkItem,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

export const MEMBER_NAME =
  process.env.NEXT_PUBLIC_STANDUP_MEMBER || "Anand";

export const TEAM_ID =
  process.env.NEXT_PUBLIC_STANDUP_TEAM_ID || "";

type Envelope<T> = { success: boolean; message?: string; data: T };

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const json = (await res.json().catch(() => ({}))) as Partial<Envelope<T>> & {
    message?: string;
  };
  if (!res.ok || json.success === false) {
    throw new ApiError(json.message || `Request failed (${res.status})`, res.status);
  }
  return (json as Envelope<T>).data;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------- health ----------

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new ApiError("API unreachable", res.status);
  return (await res.json()) as Health;
}

// ---------- web chat (join-only) ----------

export async function bootstrap(
  memberName: string = MEMBER_NAME,
  teamId?: string
): Promise<BootstrapData> {
  const params = new URLSearchParams({ memberName });
  const id = teamId || TEAM_ID;
  if (id) params.set("teamId", id);
  return request<BootstrapData>(`/api/web-chat/bootstrap?${params}`);
}

export async function getSchedule(teamId?: string) {
  const id = teamId || TEAM_ID;
  const q = id ? `?teamId=${encodeURIComponent(id)}` : "";
  return request<{ cron: string; scheduleTime: string; startedBy: string }>(
    `/api/web-chat/schedule${q}`
  );
}

export async function getSessionQuestions(
  sessionId: number
): Promise<Question[]> {
  return request<Question[]>(`/api/web-chat/sessions/${sessionId}/questions`);
}

export async function answerQuestion(
  questionId: number,
  body: { response: string; status?: string }
): Promise<AnswerResult> {
  return request<AnswerResult>(
    `/api/web-chat/questions/${questionId}/answer`,
    jsonInit("POST", body)
  );
}

export async function getSummary(sessionId: number): Promise<SummaryData> {
  return request<SummaryData>(`/api/web-chat/sessions/${sessionId}/summary`);
}

// ---------- Azure DevOps proposals ----------

export async function getAdoProposals(
  sessionId: number
): Promise<AdoProposal[]> {
  return request<AdoProposal[]>(
    `/api/web-chat/sessions/${sessionId}/ado-proposals`
  );
}

export async function confirmAdoUpdates(
  sessionId: number,
  updates: Array<{ updateId?: number; ticketId?: string; status?: string; comment?: string }>
): Promise<ConfirmResult[]> {
  return request<ConfirmResult[]>(
    `/api/web-chat/sessions/${sessionId}/ado-updates/confirm`,
    jsonInit("POST", { updates })
  );
}

// ---------- insights / reports ----------

export async function generateInsights(sessionId: number) {
  return request<unknown>(
    `/api/insights/generate`,
    jsonInit("POST", { sessionId })
  );
}

export async function getReport(sessionId: number) {
  const res = await fetch(`${API_BASE}/api/reports/${sessionId}`);
  if (!res.ok) throw new ApiError("Report not found", res.status);
  return res.json();
}

export function reportPdfUrl(sessionId: number): string {
  return `${API_BASE}/api/reports/${sessionId}/pdf`;
}

// ---------- escalations ----------

export async function addEscalation(payload: {
  work_item_id?: number | null;
  team_member_id?: number | null;
  severity: string;
  escalation_reason: string;
  notified_to?: string | null;
}) {
  return request<unknown>(`/api/escalations`, jsonInit("POST", payload));
}

// ---------- teams ----------

export async function getTeams(): Promise<Array<{ id: number; team_name?: string }>> {
  const res = await fetch(`${API_BASE}/api/teams`);
  if (!res.ok) throw new ApiError("Failed to fetch teams", res.status);
  return (await res.json()) as Array<{ id: number; team_name?: string }>;
}

export async function getTeamMembers(teamId: string | number): Promise<Member[]> {
  const res = await fetch(`${API_BASE}/api/teams/${teamId}/members`);
  if (!res.ok) throw new ApiError("Failed to fetch members", res.status);
  return (await res.json()) as Member[];
}

// ---------- work items ----------

export async function getWorkItemsByMember(
  memberName: string
): Promise<WorkItem[]> {
  const res = await fetch(
    `${API_BASE}/api/work-items/${encodeURIComponent(memberName)}`
  );
  if (!res.ok) throw new ApiError("Failed to fetch work items", res.status);
  const data = await res.json();
  return Array.isArray(data) ? (data as WorkItem[]) : [];
}

export async function saveWorkItemSnapshot(item: {
  external_ticket_id: string;
  team_member_id: number;
  source_system?: string;
  title?: string;
  state?: string;
  priority?: string | null;
  inactive_days?: number;
  days_in_state?: number;
  last_updated?: string | null;
  state_changed?: string | null;
}) {
  return request<{ id: number }>(
    `/api/work-items`,
    jsonInit("POST", { source_system: "azure-devops", ...item })
  );
}
