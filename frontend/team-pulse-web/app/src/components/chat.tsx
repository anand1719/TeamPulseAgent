"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  User,
  Circle,
  Menu,
  X,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  Clock,
  ShieldAlert,
  FileWarning,
} from "lucide-react";
import {
  addEscalation,
  answerQuestion,
  bootstrap,
  confirmAdoUpdates,
  getHealth,
  getWorkItemsByMember,
  MEMBER_NAME,
  reportPdfUrl,
} from "../lib/api";
import type {
  AdoProposal,
  AnalysisResult,
  BootstrapData,
  ConfirmResult,
  Health,
  Member,
  Progress,
  Question,
  Team,
  WorkItem as WorkItemType,
} from "../lib/types";

type ChatPhase = "loading" | "scheduled" | "active" | "completed" | "error";

type Message = {
  id: number;
  sender: "bot" | "user";
  text: string;
  time: string;
  analysis?: AnalysisResult;
};

type ProposalDraft = {
  updateId?: number;
  ticketId: string;
  title: string;
  currentState: string;
  status: string;
  comment: string;
  // Set once this proposal has been pushed to Azure DevOps, so a page
  // reload still shows the card as applied instead of "not yet sent".
  applied?: boolean;
  appliedStatus?: string;
};

function timeNow(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapWorkItem(w: WorkItemType): WorkItemType & { label: string } {
  return {
    ...w,
    label: w.external_ticket_id || String(w.id ?? ""),
  };
}

// Raw ado_updates row as returned by /api/web-chat/bootstrap and
// /api/web-chat/answers (snake_case, straight from Postgres).
function mapProposal(p: AdoProposal): ProposalDraft {
  const applied = p.applied === true || !!p.applied_status;
  return {
    updateId: p.id,
    ticketId: p.ticket_id || p.external_ticket_id || "",
    title: p.title || "",
    currentState: p.current_state || "",
    // An applied status is history, not a suggestion, so it wins over
    // the (now out of date) proposal.
    status:
      (applied ? p.applied_status || "" : "") ||
      p.proposed_status ||
      p.current_state ||
      "",
    comment: p.proposed_comment || "",
    applied,
    appliedStatus: applied
      ? p.applied_status || p.proposed_status || ""
      : "",
  };
}

function statusForCountdown(scheduleTime: string): Date {
  // NEXT occurrence of scheduleTime ("HH:MM" or "HH:MM:SS") in local
  // time. While today's time is still ahead we count down to it; once
  // it has passed the next occurrence is tomorrow at the same time.
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(scheduleTime || "");
  const now = new Date();
  const next = new Date(now);
  if (!match) {
    next.setHours(18, 0, 0, 0); // fallback for a missing/invalid value
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }
  next.setHours(
    Number(match[1]),
    Number(match[2]),
    match[3] ? Number(match[3]) : 0,
    0
  );
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

// TODAY'S occurrence of scheduleTime, with NO tomorrow rollover.
// Used by the countdown grace window: once today's time has passed
// we get a negative "how long ago" instead of a far-future target.
function todaysOccurrence(scheduleTime: string): Date {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(scheduleTime || "");
  const today = new Date();
  if (!match) {
    today.setHours(18, 0, 0, 0); // same fallback as statusForCountdown
    return today;
  }
  today.setHours(
    Number(match[1]),
    Number(match[2]),
    match[3] ? Number(match[3]) : 0,
    0
  );
  return today;
}

// Grace window: how long after the scheduled time the UI keeps
// showing "Starting…" (instead of rolling over to tomorrow) while
// waiting for the scheduler to create today's session.
const COUNTDOWN_GRACE_MS = 2 * 60 * 1000;

function formatCountdown(target: Date): string {
  const ms = Math.max(0, target.getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Chat() {
  const [phase, setPhase] = useState<ChatPhase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workItems, setWorkItems] = useState<Array<WorkItemType & { label: string }>>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [currentUser, setCurrentUser] = useState(MEMBER_NAME);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [session, setSession] = useState<BootstrapData["session"]>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<Question[]>([]);
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [schedule, setSchedule] = useState<BootstrapData["schedule"] | null>(null);
  const [countdown, setCountdown] = useState("");
  const [proposals, setProposals] = useState<ProposalDraft[]>([]);
  const [confirmResults, setConfirmResults] = useState<ConfirmResult[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // Session id the current chat history belongs to. When bootstrap
  // reports a different session (a new day's standup, or none at all
  // after a reset), the old conversation is dropped so the previous
  // standup's chat never bleeds into the next one.
  const sessionScopeRef = useRef<number | null>(null);

  const pushMessage = useCallback(
    (sender: "bot" | "user", text: string, analysis?: AnalysisResult) => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), sender, text, time: timeNow(), analysis },
      ]);
    },
    []
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Health badge (polled)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await getHealth();
        if (alive) setHealth(h);
      } catch {
        if (alive) setHealth(null);
      }
    };
    poll();
    const t = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  // Bootstrap + scheduled-state polling.
  // The standup is started ONLY by the scheduler:
  // while today's session does not exist we poll
  // every 60s until the scheduler creates it.
  const applyBootstrap = useCallback((d: BootstrapData) => {
    setTeam(d.team ?? null);
    setMembers(d.members ?? []);
    setCurrentUser(d.member?.name ?? MEMBER_NAME);
    setMemberId(d.member?.id ?? null);
    setSchedule(d.schedule ?? null);
    setWorkItems((d.workItems ?? []).map(mapWorkItem));
    setProgress(d.progress ?? null);
    setSession(d.session ?? null);
    const sessionId = d.session?.id ?? null;
    if (sessionId !== sessionScopeRef.current) {
      sessionScopeRef.current = sessionId;
      setMessages([]);
      setPendingQuestions([]);
      setProposals([]);
      setConfirmResults(null);
      setSummaryText(null);
    }
    if (!d.standupScheduled || !d.session) {
      setPhase("scheduled");
      return;
    }
    const qs = d.questions ?? [];
    setPendingQuestions(qs.filter((q) => q.question_status === "PENDING"));
    if (d.sessionCompleted) {
      setSummaryText("Your evening standup is complete for today. 🌙");
      setPhase("completed");
      setProposals((d.adoProposals ?? []).map(mapProposal));
    } else {
      setPhase("active");
    }
  }, []);

  const runBootstrap = useCallback(async () => {
    try {
      const d = await bootstrap(MEMBER_NAME);
      applyBootstrap(d);
      return d;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to connect to the standup API");
      setPhase("error");
      return null;
    }
  }, [applyBootstrap]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await runBootstrap();
      if (!cancelled && d && !d.standupScheduled) {
        // first scheduled-state poll happens via the
        // interval below; nothing else to do here
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runBootstrap]);

  // Re-poll in "scheduled" (waiting for today's session) and in
  // "completed" (a reset / re-run may have replaced today's session —
  // applyBootstrap then wipes the old conversation and flips to
  // "active"). The "active" phase does not poll: it is driven by
  // question answers instead.
  useEffect(() => {
    if (phase !== "scheduled" && phase !== "completed") return;
    const t = setInterval(() => {
      runBootstrap();
    }, 60000);
    return () => clearInterval(t);
  }, [phase, runBootstrap]);

  // Countdown to the next scheduled standup. Kept running in both
  // "scheduled" and "completed" phases: per the product decision the
  // user always sees the next standup timer, even when today's
  // standup is already done. Once the configured time has passed,
  // statusForCountdown() points at tomorrow's occurrence, so the
  // timer rolls over to ~24h.
  //
  // Grace window: in the "scheduled" phase, for COUNTDOWN_GRACE_MS
  // after today's time passes we show "Starting…" instead of rolling
  // over, covering the gap until the scheduler creates today's
  // session (picked up by the 60s poll or "Check now"). After the
  // grace expires — or in the "completed" phase — the normal
  // rollover applies.
  useEffect(() => {
    if (
      (phase !== "scheduled" && phase !== "completed") ||
      !schedule?.scheduleTime
    ) {
      return;
    }
    const scheduleTime = schedule.scheduleTime;
    const tick = () => {
      if (phase === "scheduled") {
        const now = Date.now();
        const passedMs = now - todaysOccurrence(scheduleTime).getTime();
        if (passedMs >= 0 && passedMs < COUNTDOWN_GRACE_MS) {
          setCountdown("Starting…");
          return;
        }
      }
      const target = statusForCountdown(scheduleTime);
      setCountdown(formatCountdown(target));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [phase, schedule]);

  // ---------- answering ----------

  // Shared answer path for both the question card (comment + status)
  // and the fallback bottom composer (plain text, no pending question).
  async function submitAnswer(current: Question, comment: string, status?: string) {
    const text = comment.trim();
    if ((!text && !status) || sending) return;
    setInput("");
    setSending(true);
    // The user bubble always shows what was typed; a status-only
    // submit still leaves a visible trace of the chosen status.
    pushMessage("user", text || `Status → ${status}`);
    try {
      const result = await answerQuestion(current.id, {
        response: text,
        status,
      });
      if (result.alreadyAnswered) {
        pushMessage("bot", "That question was already answered — moving on.");
        return;
      }
      const a = result.analysis;
      pushMessage(
        "bot",
        result.nextQuestion
          ? "✅ Response recorded — here's your next question:"
          : "Thanks! That was the last one — compiling your standup.",
        a
      );
      if (a?.blocker_detected) {
        pushMessage(
          "bot",
          "⚠️ I detected a blocker in your update. Use the Escalate button below so the team lead gets notified."
        );
      }
      setProgress(result.progress ?? null);
      if (result.completed) {
        if (result.summary?.summary) {
          setSummaryText(result.summary.summary);
        }
        setProposals((result.adoProposals ?? []).map(mapProposal));
        setPhase("completed");
      } else if (result.nextQuestion) {
        setPendingQuestions([result.nextQuestion, ...pendingQuestions.slice(1)]);
      } else {
        setPendingQuestions(pendingQuestions.slice(1));
      }
    } catch (e) {
      pushMessage("bot", `Sorry, something went wrong: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setSending(false);
    }
  }

  // Question card submit: comment + ticket status.
  function handleCardSubmit(comment: string, status: string) {
    const current = pendingQuestions[0];
    if (!current) return;
    void submitAnswer(current, comment, status);
  }

  // Fallback bottom composer — only reachable when the active phase
  // has no pending question card on screen.
  function handleSend() {
    const current = pendingQuestions[0];
    if (!current) return;
    void submitAnswer(current, input);
  }

  async function handleEscalate() {
    if (!session || !memberId) return;
    try {
      await addEscalation({
        work_item_id: null,
        team_member_id: memberId,
        severity: "HIGH",
        escalation_reason: "Blocker reported during evening standup (web chat)",
        notified_to: null,
      });
      pushMessage("bot", "🚨 Escalation recorded — the team lead has been notified.");
    } catch (e) {
      pushMessage("bot", `Escalation failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async function handleRefreshWorkItems() {
    setRefreshing(true);
    try {
      const items = await getWorkItemsByMember(currentUser);
      setWorkItems(items.map(mapWorkItem));
    } catch {
      // keep current items on failure
    } finally {
      setRefreshing(false);
    }
  }

  // ---------- ADO proposal confirmation ----------

  function updateProposal(index: number, patch: Partial<ProposalDraft>) {
    setProposals((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }

  async function handleConfirmUpdates() {
    const sid = session?.id;
    if (!sid || !proposals.length || confirming) return;
    setConfirming(true);
    setConfirmResults(null);
    try {
      const results = await confirmAdoUpdates(
        sid,
        proposals.map((p) => ({
          updateId: p.updateId,
          ticketId: p.ticketId,
          status: p.status,
          comment: p.comment,
        }))
      );
      setConfirmResults(results);
      // Show the pushed status in the card itself (the select was
      // showing the pre-confirmation proposal) and re-read the
      // work-item cards so they no longer show the old state.
      setProposals((prev) =>
        prev.map((p) => {
          const r = p.updateId
            ? results.find((x) => x.updateId === p.updateId)
            : undefined;
          if (!r?.success) return p;
          const appliedStatus = r.status || p.status;
          return {
            ...p,
            applied: true,
            appliedStatus,
            status: appliedStatus,
          };
        })
      );
      if (results.some((r) => r.success)) {
        void handleRefreshWorkItems();
      }
    } catch (e) {
      setConfirmResults([
        {
          success: false,
          error: e instanceof Error ? e.message : "Confirmation failed",
        },
      ]);
    } finally {
      setConfirming(false);
    }
  }

  // ---------- render ----------

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <p className="animate-pulse text-sm text-slate-500">
          Connecting to TeamPulse…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
        <FileWarning className="text-red-500" size={32} />
        <p className="text-sm text-slate-600">{loadError}</p>
        <button
          onClick={() => {
            setPhase("loading");
            setLoadError(null);
            runBootstrap();
          }}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 font-sans dark:bg-black">
      {/* Sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-72 flex-col bg-slate-900 p-6 transition-transform md:relative md:translate-x-0 ${
          mobileMenu ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">TeamPulse</h1>
          <button
            className="text-slate-400 md:hidden"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <span
            className={`h-2 w-2 rounded-full ${
              health ? "bg-green-500" : "bg-red-500"
            }`}
          />
          {health ? "API online" : "API offline"}
        </div>

        {team?.team_name && (
          <p className="mt-2 text-xs text-slate-400">{team.team_name}</p>
        )}

        <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Members
        </p>
        <div className="mt-2 space-y-1">
          {members.map((m) => (
            <Member
              key={m.id}
              name={m.name}
              status={m.name === currentUser ? "online" : "offline"}
            />
          ))}
        </div>

        {/* Next-standup timer — always visible so the member sees when
            the next standup runs, even when today's standup is done. */}
        <div className="mt-auto rounded-xl bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <Clock size={18} className="shrink-0 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-slate-200">
                {phase === "completed" && countdown
                  ? `Next standup in ${countdown}`
                  : "Evening Standup"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Runs once per day at{" "}
                {schedule?.scheduleTime?.slice(0, 5) || "18:00"} — started
                automatically by the scheduler.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main chat column */}
      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <button
              className="text-slate-600 md:hidden dark:text-slate-300"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {currentUser}
              </h2>
              <p className="text-xs text-slate-500">
                {phase === "scheduled"
                  ? "Waiting for the evening scheduler"
                  : phase === "completed"
                  ? "Standup completed"
                  : "Evening standup in progress"}
              </p>
            </div>
          </div>
          {progress && phase === "active" && (
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
              {progress.answered}/{progress.total} answered
            </span>
          )}
        </header>

        {phase === "scheduled" ? (
          <ScheduledScreen
            countdown={countdown}
            scheduleTime={schedule?.scheduleTime}
            onPollNow={() => runBootstrap()}
          />
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto p-6">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {phase === "active" && pendingQuestions[0] && (
                <div className="mt-2 flex flex-col gap-2">
                  <QuestionCard
                    question={pendingQuestions[0]}
                    showGreeting={messages.length === 0}
                    pendingCount={pendingQuestions.length}
                    scheduleTime={schedule?.scheduleTime ?? null}
                    deadline={session?.response_deadline ?? null}
                    sending={sending}
                    onSubmit={handleCardSubmit}
                  />
                  {messages.some((m) => m.analysis?.blocker_detected) && (
                    <button
                      onClick={handleEscalate}
                      className="flex items-center gap-2 self-start rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <ShieldAlert size={14} /> Escalate blocker
                    </button>
                  )}
                </div>
              )}
              {phase === "completed" && summaryText && (
                <MessageBubble
                  message={{
                    id: -2,
                    sender: "bot",
                    text: `Thanks! ${summaryText} 🤖`,
                    time: timeNow(),
                  }}
                />
              )}
              {phase === "completed" && session?.id && (
                <a
                  href={reportPdfUrl(session.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 self-start rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download size={14} /> Download PDF report
                </a>
              )}
              {phase === "completed" && proposals.length > 0 && (
                <AdoProposalsCard
                  proposals={proposals}
                  results={confirmResults}
                  confirming={confirming}
                  onChange={updateProposal}
                  onConfirm={handleConfirmUpdates}
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Bottom composer is a fallback: while a question card is
            on screen the card itself holds the comment box + status
            dropdown, so a second input would be redundant. */}
        {phase === "active" && !pendingQuestions[0] && (
          <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mx-auto flex max-w-2xl items-center gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type your update…"
                disabled={sending}
                className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Work items panel */}
      <aside className="hidden w-80 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-6 xl:flex dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Azure DevOps work items
          </h3>
          <button
            onClick={handleRefreshWorkItems}
            disabled={refreshing}
            className="text-slate-400 hover:text-blue-600 disabled:opacity-50"
            title="Refresh from Azure DevOps"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {workItems.map((item) => (
            <WorkItemCard key={`${item.label}-${item.id}`} item={item} />
          ))}
          {!workItems.length && (
            <p className="text-xs text-slate-500">
              No active work items found for {currentUser}.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ---------------- Components ---------------- */

function Member({
  name,
  status,
}: {
  name: string;
  status: "online" | "away" | "offline";
}) {
  const colors = {
    online: "bg-green-500",
    away: "bg-yellow-500",
    offline: "bg-slate-500",
  };

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs">
        {name.charAt(0)}
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-950 ${colors[status]}`}
        />
      </div>
      <span className="text-sm text-slate-300">{name}</span>
    </div>
  );
}

// Renders the backend question text, converting **bold** markdown
// (e.g. "Reviewing code – **Doing**") into <strong> so the raw
// asterisks never show up in the UI.
function renderRichText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// ADO work-item states offered in the question card's status
// dropdown (same list the proposals card uses for editing).
const ADO_STATUS_OPTIONS = ["New", "To Do", "Doing", "In Review", "Done", "Closed"];

// ISO timestamp -> "HH:MM" local clock, e.g. the session's
// response deadline "2026-10-06T10:46:00.000Z" -> "16:16".
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Dedicated card for the current standup question in the active
// phase. Shows the work-item context (ticket, title, state, age)
// as structured chips plus the question text — instead of dumping
// everything into a plain chat bubble. The answer controls (comment
// box + ticket status dropdown) live inside the card, mirroring the
// Teams adaptive card layout.
function QuestionCard({
  question,
  showGreeting,
  pendingCount,
  scheduleTime,
  deadline,
  sending,
  onSubmit,
}: {
  question: Question;
  showGreeting?: boolean;
  pendingCount?: number;
  scheduleTime?: string | null;
  deadline?: string | null;
  sending: boolean;
  onSubmit: (comment: string, status: string) => void;
}) {
  const hasWorkItem = Boolean(question.ticket_id || question.work_item_title);
  // Pre-select the ticket's current state when it is a known ADO
  // state, otherwise fall back to "Doing".
  const initialStatus =
    question.work_item_state &&
    ADO_STATUS_OPTIONS.includes(question.work_item_state)
      ? question.work_item_state
      : "Doing";
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState(initialStatus);
  // Submit requires a comment, or an explicitly changed status.
  const statusChanged = status !== initialStatus;
  const canSubmit = Boolean(comment.trim()) || statusChanged;

  function handleSubmit() {
    if (sending || !canSubmit) return;
    onSubmit(comment.trim(), status);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Bot size={15} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Evening standup question
              </p>
              {(scheduleTime || deadline) && (
                <p className="text-[10px] text-slate-400">
                  {scheduleTime && <>Scheduled {scheduleTime.slice(0, 5)}</>}
                  {scheduleTime && deadline && " · "}
                  {deadline && <>respond by {formatClock(deadline)}</>}
                </p>
              )}
            </div>
          </div>
          {typeof question.days_in_state === "number" &&
            question.days_in_state > 0 && (
              <span className="text-[10px] text-slate-400">
                {question.days_in_state}d in state
              </span>
            )}
        </div>
      </div>

      <div className="px-5 py-4">
        {showGreeting && (
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            You have {pendingCount ?? 1} active work item
            {(pendingCount ?? 1) === 1 ? "" : "s"} today. Let&apos;s do your
            evening standup. 🌙
          </p>
        )}

        {hasWorkItem && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {question.ticket_id && (
              <span className="font-semibold text-blue-600">
                {question.ticket_id}
              </span>
            )}
            {question.work_item_title && (
              <span className="text-slate-600 dark:text-slate-300">
                {question.work_item_title}
              </span>
            )}
            {question.work_item_state && (
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Circle size={8} className="fill-current" />
                {question.work_item_state}
              </span>
            )}
          </div>
        )}

        <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {renderRichText(question.question)}
        </p>

        {/* Answer controls — mirrors the Teams adaptive card
            (Input.Text comment + Input.ChoiceSet status). */}
        <label className="mt-4 block text-xs text-slate-500">
          Comment
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={3}
            placeholder="Type your update…"
            disabled={sending}
            className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        <div className="mt-3 flex items-end justify-between gap-3">
          <label className="text-xs text-slate-500">
            Ticket status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={sending}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {ADO_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleSubmit}
            disabled={sending || !canSubmit}
            className="flex h-9 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={14} /> Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isBot = message.sender === "bot";

  return (
    <div className={`flex gap-3 ${isBot ? "" : "flex-row-reverse"}`}>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isBot ? "bg-blue-100 text-blue-600" : "bg-slate-800 text-white"
        }`}
      >
        {isBot ? <Bot size={18} /> : <User size={18} />}
      </div>

      <div className={`max-w-xl ${isBot ? "" : "text-right"}`}>
        <div
          className={`inline-block rounded-2xl px-5 py-3 text-left text-sm ${
            isBot ? "rounded-tl-sm bg-white shadow-sm" : "rounded-tr-sm bg-blue-600 text-white"
          }`}
        >
          {message.text}
        </div>

        {message.analysis && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {message.analysis.sentiment && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  message.analysis.sentiment === "POSITIVE"
                    ? "bg-green-100 text-green-700"
                    : message.analysis.sentiment === "NEGATIVE"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {message.analysis.sentiment}
              </span>
            )}
            {message.analysis.blocker_detected && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                ⚠ blocker
              </span>
            )}
            {message.analysis.risk_detected && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                risk
              </span>
            )}
          </div>
        )}

        <p className="mt-1 text-[10px] text-slate-400">{message.time}</p>
      </div>
    </div>
  );
}

function WorkItemCard({
  item,
}: {
  item: WorkItemType & { label: string };
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 transition hover:border-blue-300 hover:shadow-sm dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-600">
          {item.label}
        </span>
        {typeof item.days_in_state === "number" && (
          <span className="text-[10px] text-slate-400">
            {item.days_in_state}d in state
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
        {item.title || "Untitled"}
      </p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <Circle size={9} className="fill-current" />
        {item.state || item.status || "New"}
      </div>
    </div>
  );
}

function ScheduledScreen({
  countdown,
  scheduleTime,
  onPollNow,
}: {
  countdown: string;
  scheduleTime?: string;
  onPollNow: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-3xl">
        🌙
      </div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Evening standup starts at {scheduleTime?.slice(0, 5) || "18:00"}
      </h2>
      <p className="max-w-md text-sm text-slate-500">
        Your standup is started automatically by the scheduler once per day —
        questions for your Azure DevOps work items will appear here. No manual
        start needed.
      </p>
      <div className="rounded-2xl bg-slate-900 px-8 py-4 font-mono text-2xl text-green-400">
        {countdown}
      </div>
      <button
        onClick={onPollNow}
        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Check now
      </button>
    </div>
  );
}

function AdoProposalsCard({
  proposals,
  results,
  confirming,
  onChange,
  onConfirm,
}: {
  proposals: ProposalDraft[];
  results: ConfirmResult[] | null;
  confirming: boolean;
  onChange: (index: number, patch: Partial<ProposalDraft>) => void;
  onConfirm: () => void;
}) {
  const anyApplied =
    proposals.length > 0 &&
    proposals.every(
      (p) =>
        p.applied ||
        (p.updateId &&
          results?.find((r) => r.updateId === p.updateId)?.success)
    );

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <p className="text-sm font-semibold text-slate-800">
          Proposed Azure DevOps Updates
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Review, edit if needed, then confirm to post comments (and status
          changes) to the board.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {proposals.map((p, i) => {
          const result = p.updateId
            ? results?.find((r) => r.updateId === p.updateId)
            : undefined;
          const applied = !!p.applied || !!result?.success;
          const appliedStatus = result?.status || p.appliedStatus || "";
          return (
            <div key={`${p.ticketId}-${i}`} className="px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-600">
                  {p.ticketId}
                </span>
                {applied ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                    <CheckCircle2 size={14} /> Applied
                    {appliedStatus ? ` → ${appliedStatus}` : ""}
                  </span>
                ) : result ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                    <XCircle size={14} /> Failed
                  </span>
                ) : null}
              </div>

              {p.title && (
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {p.title}
                </p>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr]">
                <label className="text-xs text-slate-500">
                  Status
                  <select
                    value={p.status}
                    disabled={applied || confirming}
                    onChange={(e) => onChange(i, { status: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-60"
                  >
                    {["New", "To Do", "Doing", "In Review", "Done", "Closed"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="text-xs text-slate-500">
                  Comment
                  <textarea
                    value={p.comment}
                    disabled={applied || confirming}
                    onChange={(e) => onChange(i, { comment: e.target.value })}
                    rows={2}
                    className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                  />
                </label>
              </div>

              {result && !result.success && result.error && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  {result.error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
        <span className="text-xs text-slate-500">
          {anyApplied
            ? "All updates applied to Azure DevOps ✅"
            : "Nothing is pushed until you confirm."}
        </span>
        <button
          onClick={onConfirm}
          disabled={confirming || anyApplied || !!results}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {confirming ? "Applying…" : "Confirm Updates"}
        </button>
      </div>
    </div>
  );
}

