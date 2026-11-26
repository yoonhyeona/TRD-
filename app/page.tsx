"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import type { User } from "@supabase/supabase-js";

import { sampleIds, sampleLabels, sampleSvg, type SampleId } from "@/lib/sample-art";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type Summary = {
  recall_keywords: string[];
  activity_summary: string;
  health_mention_note: string | null;
  summary_source: "ai" | "fallback";
};
type Message = { turn_number: number; role: "assistant" | "user"; content: string };
type Checkin = {
  medication_status: "taken" | "not_taken" | "not_recorded";
  condition_status: "good" | "okay" | "unwell" | "not_recorded";
  condition_note: string | null;
};
type Session = {
  id: string;
  status: string;
  photo_source: "sample" | "upload";
  sample_id: SampleId | null;
  photo_url: string | null;
  messages: Message[];
  summaries: Summary[];
  checkins: Checkin[];
};
type SessionListItem = {
  id: string;
  status: string;
  started_at: string;
  summaries: Array<{ activity_summary: string; recall_keywords: string[]; summary_source: string }>;
};

const medicationLabels = {
  taken: "복용했어요",
  not_taken: "복용하지 않았어요",
  not_recorded: "기록하지 않을게요",
};
const conditionLabels = {
  good: "좋아요",
  okay: "보통이에요",
  unwell: "불편한 곳이 있어요",
  not_recorded: "기록하지 않을게요",
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "요청을 처리하지 못했습니다.");
  return data as T;
}

function SampleArt({ id }: { id: SampleId }) {
  return (
    <span
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: sampleSvg(id) }}
    />
  );
}

export default function Home() {
  const supabase = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? createSupabaseBrowser()
        : null,
    [],
  );
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [page, setPage] = useState<"new" | "history" | "privacy">("new");
  const [consentStorage, setConsentStorage] = useState(false);
  const [consentAi, setConsentAi] = useState(false);
  const [consented, setConsented] = useState(false);
  const [sampleId, setSampleId] = useState<SampleId>("seaside");
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [answer, setAnswer] = useState("");
  const [medication, setMedication] = useState<Checkin["medication_status"]>("not_recorded");
  const [condition, setCondition] = useState<Checkin["condition_status"]>("not_recorded");
  const [conditionNote, setConditionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmedDelete, setConfirmedDelete] = useState(false);

  const loadSessions = useCallback(async () => {
    const result = await requestJson<{ items: SessionListItem[] }>("/api/v1/sessions");
    setSessions(result.items);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const result = await requestJson<{ session: Session; photo_url: string | null }>("/api/v1/sessions/" + id);
    const loaded = { ...result.session, photo_url: result.photo_url };
    setSession(loaded);
    const saved = loaded.checkins?.[0];
    if (saved) {
      setMedication(saved.medication_status);
      setCondition(saved.condition_status);
      setConditionNote(saved.condition_note ?? "");
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase 설정이 없습니다. README의 로컬 실행 절차를 확인해 주세요.");
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sessionData) => {
      const activeUser = sessionData?.user ?? null;
      setUser(activeUser);
      if (!activeUser) {
        sessionStorage.removeItem("jeongdami-session");
        sessionStorage.removeItem("jeongdami-owner");
        setSessionId(null);
        setSession(null);
      }
    });
    void supabase.auth
      .getUser()
      .then(({ data }) => setUser(data.user))
      .catch(() => setError("로그인 상태를 확인하지 못했습니다."));
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (user) {
      const savedOwner = sessionStorage.getItem("jeongdami-owner");
      if (savedOwner && savedOwner !== user.id) {
        sessionStorage.removeItem("jeongdami-session");
        sessionStorage.removeItem("jeongdami-owner");
        setSessionId(null);
        setSession(null);
      } else {
        const savedSession = sessionStorage.getItem("jeongdami-session");
        if (savedSession) setSessionId(savedSession);
      }
      void loadSessions().catch((cause: Error) => setError(cause.message));
      void requestJson<{ data_storage: boolean; ai_processing: boolean }>("/api/v1/consents")
        .then((consents) => {
          setConsentStorage(consents.data_storage);
          setConsentAi(consents.ai_processing);
          setConsented(consents.data_storage && consents.ai_processing);
        })
        .catch((cause: Error) => setError(cause.message));
    }
  }, [user, loadSessions]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId).catch((cause: Error) => setError(cause.message));
  }, [sessionId, loadSession]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authenticate(false);
  }

  async function authenticate(createAccount: boolean) {
    if (!supabase) {
      setError("Supabase 설정이 없습니다. .env.local을 확인해 주세요.");
      return;
    }
    if (!email.trim() || password.length < 8) {
      setError("이메일을 입력하고 비밀번호를 8자 이상으로 설정해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setAuthMessage("");
    try {
      const result = createAccount
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        setError("로그인할 수 없습니다. 이메일과 비밀번호를 확인해 주세요.");
        return;
      }
      if (createAccount && !result.data.session) {
        setAuthMessage("가입 확인 이메일을 보낸 경우 메일의 안내를 완료해 주세요.");
      }
      setUser(result.data.session ? result.data.user : null);
    } catch {
      setError("인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConsents() {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/v1/consents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent_type: "data_storage", granted: consentStorage }),
      });
      await requestJson("/api/v1/consents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent_type: "ai_processing", granted: consentAi }),
      });
      setConsented(consentStorage && consentAi);
      if (!(consentStorage && consentAi)) setNotice("두 항목에 모두 동의해야 사진을 등록할 수 있습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "동의를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function startWithPhoto() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file) {
        const created = await requestJson<{ session_id: string }>("/api/v1/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photo_source: "upload" }),
        });
        const form = new FormData();
        form.set("file", file);
        await requestJson(`/api/v1/sessions/${created.session_id}/photo`, {
          method: "POST",
          body: form,
        });
        rememberSession(created.session_id);
      } else {
        const created = await requestJson<{ session_id: string }>("/api/v1/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photo_source: "sample", sample_id: sampleId }),
        });
        rememberSession(created.session_id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사진을 준비하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function beginConversation() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/v1/sessions/${sessionId}/start`, { method: "POST" });
      await loadSession(sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "대화를 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !session) return;
    const turn = session.messages.filter((message) => message.role === "user").length + 1;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ status: string }>(`/api/v1/sessions/${sessionId}/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turn_number: turn, answer }),
      });
      setAnswer("");
      if (result.status === "awaiting_summary") {
        await requestJson(`/api/v1/sessions/${sessionId}/complete`, { method: "POST" });
        setNotice("세 번의 이야기를 저장했어요.");
      }
      await loadSession(sessionId);
      await loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답변을 저장하지 못했습니다.");
      await loadSession(sessionId);
    } finally {
      setBusy(false);
    }
  }

  async function saveCheckin(event: FormEvent) {
    event.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/v1/sessions/${sessionId}/checkin`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          medication_status: medication,
          condition_status: condition,
          condition_note: conditionNote || null,
        }),
      });
      setNotice("안부를 저장했어요.");
      await loadSession(sessionId);
      await loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "안부를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllData() {
    if (!confirmedDelete) return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/v1/sessions", { method: "DELETE" });
      setSessions([]);
      setSession(null);
      rememberSession(null);
      setConsented(false);
      setConsentStorage(false);
      setConsentAi(false);
      setConfirmedDelete(false);
      setNotice("저장된 사진, 대화, 요약, 안부와 동의 기록을 삭제했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "데이터를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function rememberSession(id: string | null) {
    setSessionId(id);
    if (id && user) {
      sessionStorage.setItem("jeongdami-session", id);
      sessionStorage.setItem("jeongdami-owner", user.id);
    } else {
      sessionStorage.removeItem("jeongdami-session");
      sessionStorage.removeItem("jeongdami-owner");
    }
  }

  async function revokeConsents() {
    setConsented(false);
    setBusy(true);
    setError("");
    try {
      for (const consentType of ["data_storage", "ai_processing"] as const) {
        await requestJson("/api/v1/consents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent_type: consentType, granted: false }),
        });
      }
      setConsented(false);
      setConsentStorage(false);
      setConsentAi(false);
      setNotice("동의를 철회했습니다. 저장된 기록은 개인정보 메뉴에서 별도로 삭제할 수 있습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "동의를 철회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <main className="shell">
        <h1 className="brand">정담이</h1>
        <p className="subtitle">사진 한 장에서 시작하는 따뜻한 기억 이야기</p>
        <section className="card">
          <h2>로그인 또는 계정 만들기</h2>
          <p>기록을 본인 계정에 안전하게 저장하려면 로그인이 필요합니다.</p>
          <form className="stack" onSubmit={(event) => void signIn(event)}>
            <label className="label">이메일<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="label">비밀번호<input type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <div className="row">
              <button disabled={busy}>로그인</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void authenticate(true)}>계정 만들기</button>
            </div>
          </form>
          {authMessage && <p role="status">{authMessage}</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const summary = session?.summaries?.[0];
  const userAnswers = session?.messages.filter((message) => message.role === "user").length ?? 0;
  const currentQuestion = session?.messages.find(
    (message) => message.role === "assistant" && message.turn_number === userAnswers + 1,
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1 className="brand">정담이</h1>
          <p className="subtitle">사진 한 장에서 시작하는 따뜻한 기억 이야기</p>
        </div>
        <button className="secondary" onClick={() => {
          if (supabase) {
            void supabase.auth.signOut().catch(() => setError("로그아웃하지 못했습니다."));
          }
        }}>로그아웃</button>
      </header>
      <div className="notice" role="note">AI 요약은 참고용이며 의학적 진단이 아닙니다. 인물이나 사건은 추측하지 않고 직접 들려주신 이야기를 우선합니다.</div>
      <nav className="nav" aria-label="주 메뉴">
        <button aria-current={page === "new" ? "page" : undefined} onClick={() => setPage("new")}>새 기억 이야기</button>
        <button aria-current={page === "history" ? "page" : undefined} onClick={() => { setPage("history"); void loadSessions(); }}>지난 기록</button>
        <button aria-current={page === "privacy" ? "page" : undefined} onClick={() => setPage("privacy")}>개인정보</button>
      </nav>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {page === "new" && (
        <section className="card">
          {!consented && !sessionId && (
            <div className="stack">
              <h2>먼저 동의를 확인해 주세요</h2>
              <p>사진과 대화는 Supabase의 비공개 저장소와 데이터베이스에 저장됩니다. 외부 AI 처리를 위한 별도 동의를 받으며, 동의하지 않으면 진행할 수 없습니다.</p>
              <label><input type="checkbox" checked={consentStorage} onChange={(event) => setConsentStorage(event.target.checked)} /> 사진과 대화 저장에 동의합니다.</label>
              <label><input type="checkbox" checked={consentAi} onChange={(event) => setConsentAi(event.target.checked)} /> AI가 질문과 활동 요약을 만들도록 사진과 대화를 처리하는 데 동의합니다.</label>
              <button disabled={busy} onClick={() => void saveConsents()}>동의 저장 후 계속</button>
            </div>
          )}
          {consented && !sessionId && (
            <div className="stack">
              <h2>사진을 골라 주세요</h2>
              <p>샘플 그림은 실제 사진이 아닌 일러스트입니다. 실제 사진을 선택해도 사람의 신원이나 사건을 AI가 단정하지 않습니다.</p>
              <div className="sample-grid">
                {sampleIds.map((id) => (
                  <button key={id} className="sample-card" aria-pressed={!file && sampleId === id} onClick={() => { setFile(null); setSampleId(id); }}>
                    <SampleArt id={id} />
                    <strong>{sampleLabels[id]}</strong>
                    <span className="muted">샘플 일러스트</span>
                  </button>
                ))}
              </div>
              <label className="label">또는 내 사진 올리기 (JPG, PNG, WEBP · 최대 5MB)
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>
              {file && <p>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
              <button disabled={busy || (file !== null && file.size > 5 * 1024 * 1024)} onClick={() => void startWithPhoto()}>
                {busy ? "사진 준비 중…" : "이 사진으로 시작"}
              </button>
            </div>
          )}
          {sessionId && session && (
            <div className="stack">
              {session.photo_url && <Image className="photo" src={session.photo_url} alt="선택한 사진" width={800} height={500} unoptimized />}
              {session.status === "created" && <button disabled={busy} onClick={() => void beginConversation()}>회상 대화 시작하기</button>}
              {session.messages.map((message, index) => (
                <div key={`${message.turn_number}-${message.role}-${index}`} className={`message ${message.role}`}>
                  <strong>{message.role === "assistant" ? "정담이의 질문" : "내 이야기"}</strong>
                  <div>{message.content}</div>
                </div>
              ))}
              {session.status === "in_progress" && currentQuestion && (
                <form className="stack" onSubmit={(event) => void submitAnswer(event)}>
                  <label className="label">편하게 답변해 주세요 ({userAnswers + 1}/3)
                    <textarea maxLength={4000} required value={answer} onChange={(event) => setAnswer(event.target.value)} />
                  </label>
                  <button disabled={busy || !answer.trim()}>{busy ? "저장 중…" : "답변 저장"}</button>
                </form>
              )}
              {session.status === "awaiting_summary" && <p>요약을 정리하고 있어요…</p>}
              {summary && (
                <div className="stack">
                  <h2>오늘의 기억 요약</h2>
                  <p><strong>기억 단어:</strong> {summary.recall_keywords.join(" · ") || "기록된 단어 없음"}</p>
                  <p>{summary.activity_summary}</p>
                  {summary.health_mention_note && <p><strong>대화 중 건강 언급:</strong> {summary.health_mention_note}</p>}
                  <p className="muted">요약 출처: {summary.summary_source === "ai" ? "AI" : "로컬 대체 요약"}</p>
                  <div className="notice">이 활동 요약은 의학적 진단이나 건강 상태 판정이 아닙니다.</div>
                  <form className="stack" onSubmit={(event) => void saveCheckin(event)}>
                    <h3>오늘의 안부</h3>
                    <label className="label">복약 여부
                      <select value={medication} onChange={(event) => setMedication(event.target.value as Checkin["medication_status"])}>
                        {Object.entries(medicationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="label">건강 상태
                      <select value={condition} onChange={(event) => setCondition(event.target.value as Checkin["condition_status"])}>
                        {Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="label">직접 남길 건강 메모 (선택)
                      <textarea maxLength={500} value={conditionNote} onChange={(event) => setConditionNote(event.target.value)} />
                    </label>
                    <button disabled={busy}>안부 저장</button>
                    <p className="muted">건강 걱정이 있으면 의료 전문가와 상담해 주세요. 앱은 진단이나 복약 권고를 하지 않습니다.</p>
                  </form>
                  <button className="secondary" onClick={() => { rememberSession(null); setSession(null); setFile(null); }}>새 기억 이야기</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {page === "history" && (
        <section className="stack">
          <h2>지난 기억 다시 보기</h2>
          {sessions.filter((item) => item.status === "completed").length === 0 && <p>저장된 활동 요약이 아직 없습니다.</p>}
          {sessions.filter((item) => item.status === "completed").map((item) => (
            <article key={item.id} className="card">
              <p className="muted">{new Date(item.started_at).toLocaleString("ko-KR")}</p>
              <p>{item.summaries?.[0]?.activity_summary}</p>
              <button className="secondary" onClick={() => { rememberSession(item.id); setPage("new"); }}>기록 열기</button>
            </article>
          ))}
        </section>
      )}

      {page === "privacy" && (
        <section className="card stack">
          <h2>내 데이터 관리</h2>
          <p>저장된 사진, 대화, 요약과 안부 기록을 삭제할 수 있습니다. 삭제에 실패하면 오류를 표시하고 성공으로 처리하지 않습니다.</p>
          <button className="secondary" disabled={busy} onClick={() => void revokeConsents()}>저장 및 AI 처리 동의 철회</button>
          <label><input type="checkbox" checked={confirmedDelete} onChange={(event) => setConfirmedDelete(event.target.checked)} /> 내 모든 사진과 기록을 삭제하는 것에 동의합니다.</label>
          <button className="danger" disabled={busy || !confirmedDelete} onClick={() => void deleteAllData()}>내 데이터 모두 삭제</button>
          <p className="muted">공개 서비스 전에는 90일 보관 만료 작업과 삭제 재시도 worker를 추가로 구성해야 합니다.</p>
        </section>
      )}
    </main>
  );
}
