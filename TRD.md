# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부
- **서비스명:** 정담이
- **기반 문서:** `PRD.md`
- **목적:** 사용자 흐름을 구현 가능한 아키텍처, API, 데이터 모델, 보안 정책, 테스트 기준으로 정의한다.
- **범위:** 해커톤 웹 프로토타입 및 시연
- **원칙:** 핵심 가치 우선, 최소 데이터 수집, 명시적 동의, 서버 측 권한 검증, 비진단적 AI 사용

> 본 서비스는 의료기기나 임상 진단 시스템이 아니다. AI는 인지활동·일상 건강 변화에 관한 참고용 요약만 제공하며 질환, 인지기능, 위험도 또는 긴급도를 판정하지 않는다.

## 목차

- [0. PRD 정합성 및 우선순위](#s0)
- [1. 시스템 아키텍처](#s1)
- [2. 데이터 흐름과 기능 계약](#s2)
- [3. API 명세](#s3)
- [4. 데이터 저장 구조](#s4)
- [5. 저장소 구성 및 구현 계약](#s5)
- [6. 구현 단계](#s6)
- [7. 테스트 및 완료 기준](#s7)
- [8. 개인정보·AI 안전·배포 체크리스트](#s8)
- [9. 리스크 및 완료 판단](#s9)
- [10. 구현 상세 사양](#s10)

<a id="s0"></a>
## 0. PRD 정합성 및 우선순위

### 0.1 기술 선택

PRD는 Python·Streamlit·SQLite를 단일 환경의 빠른 시연 기술로 제안한다. 본 TRD는 브라우저 기반 프리뷰, 인증 사용자 간 데이터 분리, 사진의 비공개 저장 및 관계형 기록 관리를 위해 **Next.js App Router + TypeScript, Vercel(배포 후보), Supabase(PostgreSQL/Auth/Storage)** 를 선택한다. 기술 선택 변경은 PRD의 사용자 가치와 완료 기준을 바꾸지 않는다. 요금·한도·지역·이용 조건은 배포 시점의 공식 안내를 확인한다.

P0 핵심 흐름: 동의 → 예시/업로드 사진 → 질문·답변 3턴 → 키워드·요약 및 복약/컨디션 직접 입력 저장 → 활동 요약 재조회. AI 장애 시에도 fallback으로 완주한다. 보호자 공유는 P2다. 사용성 목표(6명 이상, 5/6명 이상 성공, 완주 3분 이내, 평균 만족도 4.0/5 이상)는 실제 테스트로 판정하며 문서만으로 달성을 주장하지 않는다.

### 0.2 우선순위

| 우선순위 | 범위 | 완료 판단 |
|---|---|---|
| P0 — 시연 필수 | 동의, 예시/업로드 사진, 3턴, AI/fallback, 요약·체크인 저장 및 재조회 | AI 장애에도 완주, 새 조회에서 결과 확인 |
| P1 — 안전·운영 | 인증, 본인 데이터 격리, private Storage, 삭제, 검증·오류 처리 | 비인가 접근 차단, 철회·삭제 결과 확인, 안전 테스트 통과 |
| P2 — 확장 | 보호자 초대·승인·공유 동의·요약 전용 조회·철회 | 관계와 동의가 유효할 때만 조회, 철회 즉시 차단 |

P2는 P0 시연 전에 필수로 요구하지 않는다. 공개 배포 또는 실제 사용자 데이터 처리 전에는 P1의 안전장치를 생략하지 않는다.

<a id="s1"></a>
## 1. 시스템 아키텍처

### 1.1 기술 스택과 경계

| 영역 | 선택 | 책임 |
|---|---|---|
| UI/API | Next.js App Router, TypeScript | 화면, 인증·동의·입력·소유권 검증, 상태 전이 |
| 배포 | Vercel 후보 | HTTPS, PR Preview, 환경별 비밀값 주입 |
| DB/Auth/파일 | Supabase PostgreSQL, Auth, private Storage | 관계형 저장, 인증, RLS, 사진 객체 |
| AI | Gemini 등 서버 호출 provider | 첫 질문, 답변 기반 후속 질문, 세션 요약 |
| 검증 | Zod, Vitest/Jest, Playwright | 입력·AI 출력 스키마, 단위/통합/E2E 검사 |

```text
[어르신/보호자 브라우저] --HTTPS--> [Next.js UI/API]
                                      ├─ Auth·동의·권한 검증
                                      ├─ 대화 상태 전이·저장 처리
                                      └─ 서버 어댑터
                                          ├─ Supabase Auth
                                          ├─ PostgreSQL + RLS
                                          ├─ private Storage
                                          └─ AI API
```

일반 사용자 요청은 해당 사용자의 JWT/RLS 정책 아래 처리한다. AI 키와 `service_role`은 서버 비밀값이다. 일반 API 경로에서 RLS 우회 용도로 사용하지 않는다. 제한된 관리/삭제 worker만 별도 운영 절차에 따라 사용한다(§10.3, §10.4).

### 1.2 역할과 화면

- **어르신:** 본인의 동의, 사진, 세션, 메시지, 요약, 체크인을 생성·조회·삭제한다.
- **보호자(P2):** 초대·어르신 승인·활성 연결·공유 동의가 모두 유효할 때 요약 및 직접 입력 체크 항목만 읽는다. 원본 사진·대화는 읽지 않는다.
- **담당자:** MVP에서 기관별 관리 기능은 구현하지 않는다.

`role` 값이나 화면 숨김만으로 권한을 부여하지 않는다. 권한은 매 요청에서 서버/RLS로 확인한다. P2 미구현 시 보호자 화면·경로를 제공하지 않는다. 주요 어르신 흐름은 로그인 → 동의 → 사진 선택/업로드 → 회상 대화 3턴 → 오늘 기록 → DB에서 요약 재조회다. 저장 실패 시 입력을 유지하고 재시도하도록 한다.

해커톤 시연에는 데모 계정 또는 참여자별 체험 계정을 사용할 수 있다. 정상 인증·동의·소유권 검증은 유지하고 우회 모드는 제공하지 않는다. 가상 사용자·허가된 이미지로 시연하며, 공용 계정은 개인 데이터를 입력하지 않고 가상 데이터만 사용한다.

<a id="s2"></a>
## 2. 데이터 흐름 및 기능 계약

### 2.1 동의·인증

1. Supabase Auth로 사용자를 인증하고 데이터에 사용자 UUID를 연결한다.
2. 저장·AI 전송 목적, 전달 데이터, 보관·삭제 방법을 쉬운 문장으로 안내하고 동의 문서 버전·시각을 기록한다.
3. 저장 또는 AI 처리 동의가 없거나 철회된 경우 세션 생성, 사진 업로드, AI 요청을 거부한다.
4. P2 초대는 만료·일회성 무작위 코드, 보호자의 인증된 입력, 어르신 최종 승인 순으로 진행한다. 코드 원문은 저장·로그에 남기지 않는다. 공유 동의나 연결 철회 후 보호자 조회를 즉시 차단한다.

### 2.2 사진·3턴 대화

- JPEG/PNG/WebP만 허용한다. 확장자·MIME뿐 아니라 signature와 실제 디코딩을 검사하며 최대 5 MiB, 무작위 UUID 객체명, private 버킷을 사용한다. SVG·실행 형식은 거부한다.
- 저장·AI 동의와 소유권을 확인한 뒤 세션과 사진을 연결한다. 사진 연결 전 진행할 수 없다. AI에는 승인된 이미지 바이너리와 최소 문맥만 보낸다. 실명, 로그인 정보, 보호자 정보, 타 사용자 기록은 보내지 않는다.
- 답변마다 소유권, 상태, 예상 turn, 길이, 멱등성 키를 서버에서 검사한다. 답변 저장 성공 후 다음 질문을 요청·저장한다. 세 번째 답변 뒤에는 후속 질문 없이 요약한다.
- 질문은 사용자의 설명을 우선하고 비단정적으로 작성한다. 사진만으로 인물 신원·관계, 날짜·장소·사건을 사실처럼 추측하지 않는다.
- AI 호출은 timeout 15초, 1회 재시도 후 fallback을 사용한다. fallback도 실패하면 고정 질문 템플릿으로 진행한다. AI 문구에는 참고용임을 표시한다.

### 2.3 체크인·건강 안전

복약·컨디션은 사용자가 직접 선택한 값만 저장하며 대화에서 추론하지 않는다. 사용자 입력과 AI 요약을 구분한다. `health_mention_note`는 실제 발화의 중립적인 불편 표현 요약 또는 `null`이다. 진단, 치매 가능성, 점수·위험도, 치료·복약 권고는 포함하지 않는다. 전문 상담 안내는 AI 판단이 아닌 고정 문구이며 응급도 분류는 제공하지 않는다.

### 2.4 AI 입력·출력 계약

서버에서 최소 데이터 요청을 구성하고 JSON parse → Zod/JSON Schema → 안전 검증을 수행한다. 호출별로 별도 검증 스키마를 둔다. 이미지는 공개 URL/Storage 경로가 아닌 서버 SDK의 승인된 바이너리 전달로 제공한다.

**첫 질문 입력/출력**
```json
{"photo_type":"sample","instruction":"보이는 내용만 참고해 열린 질문 하나를 작성하고 인물·관계·날짜·장소를 추측하지 않는다."}
{"question":"이 사진을 보시니 어떤 기억이 떠오르시나요?"}
```

**후속 질문 입력/출력**
```json
{"turn_number":2,"current_answer":"가족과 바닷가에 갔어요.","recent_context":[{"role":"assistant","content":"이 사진을 보시니 어떤 기억이 떠오르시나요?"},{"role":"user","content":"가족과 바닷가에 갔어요."}]}
{"question":"그날 기억나는 장면이나 느낌이 있으신가요?"}
```
현재 답변과 최대 최근 4개 메시지만 전송하며 메시지당 최대 1,000자다. turn은 2~3이며 세 번째 답변 후 후속 질문을 요청하지 않는다.

**요약 입력/출력**
```json
{"messages":[{"turn_number":1,"content":"가족과 바닷가에 갔어요."},{"turn_number":2,"content":"파도 소리가 기억나요."},{"turn_number":3,"content":"즐거웠어요."}]}
{"recall_keywords":["가족","바닷가"],"activity_summary":"사용자는 가족과 바닷가에 갔던 기억과 파도 소리에 대한 느낌을 이야기했습니다.","health_mention_note":null}
```

검증 제한: `question` 1~240자, `recall_keywords` 0~5개(각 1~40자), `activity_summary` 1~600자, `health_mention_note` null 또는 1~240자. 공백만인 값, 누락, 초과 길이, 진단·위험·관계 단정은 거부하고 재시도 1회 후 fallback한다. 체크인 값은 AI가 만들거나 덮어쓰지 않으며 fallback 건강 메모는 항상 `null`이다.

### 2.5 오류 처리

| 상황 | 서버 처리 | 사용자 안내 |
|---|---|---|
| AI 오류/timeout/잘못된 JSON | 재시도 1회 후 fallback | 기본 질문/요약으로 계속 진행 |
| 업로드 실패 | 진행/완료 상태 확정 금지, 안전한 오류 코드 기록 | 사진 재선택·재시도 |
| 답변/체크인 저장 실패 | 성공 표시 금지, 멱등 재시도 | 입력 보존 후 재시도 |
| 요약 저장 실패 | 완료 확정 금지, 재시도 가능 상태 유지 | 저장되지 않았음을 안내 |
| 권한/동의 없음 | 데이터 반환 없이 거부 | 재로그인/동의·연결 확인 |
| 부분 삭제 실패 | deletion request 추적·재시도 | 완료로 표시하지 않고 상태 안내 |

<a id="s3"></a>
## 3. API 명세

모든 API의 기준 경로는 `/api/v1`이다. 서버는 인증, Zod 입력 검증, 소유권, 동의, 상태 전이를 확인한다. 비공개 타 사용자 리소스는 `404` 또는 일관된 권한 오류로 응답한다. AI/Storage 비밀값은 반환하지 않는다.

| Method / path | 요청/목적 | 권한·검증 | 성공/오류 |
|---|---|---|---|
| `GET /api/v1/me` | 사용자·역할 | 인증 | `{user}` / `401` |
| `POST /api/v1/consents` | `{consent_type,granted,document_version}` | 본인, type allowlist, 이력 보존 | `{consent}` / `400,401` |
| `POST /api/v1/sessions` | `{photo_source,sample_id?}` | 본인, 저장·AI 동의, sample allowlist | `{session_id,status}` / `400,401,403` |
| `POST /api/v1/sessions/{id}/photo` | multipart photo | 소유자·동의·signature·decode·크기 | `{photo_attached:true}` / `400,403,413,415,5xx` |
| `POST /api/v1/sessions/{id}/turns` | `{answer,turn_number,idempotency_key}` | 소유자·상태·순서·길이·중복 키 | `{saved_turn,next_question,status}` / `400,403,409,5xx` |
| `POST /api/v1/sessions/{id}/complete` | 대화 요약 완료 | 답변 3개·소유자·멱등성 | `{summary,status}` / `403,409,5xx` |
| `PATCH /api/v1/sessions/{id}/checkin` | medication/condition/note | 소유자·enum·길이·직접 입력 | `{checkin}` / `400,403,409,5xx` |
| `GET /api/v1/sessions` | 목록·cursor | 본인·페이지 제한 | `{items,next_cursor}` / `401` |
| `GET /api/v1/sessions/{id}` | 세션·메시지·요약 | 본인 또는 P2 요약 projection 권한 | `{session,messages,summary}` / `403/404` |
| `DELETE /api/v1/sessions/{id}` | 삭제 요청 | 본인 재확인·소유권·삭제 추적 | `{deletion_status,request_id}` / `403,404,5xx` |
| `POST /api/v1/caregiver/invitations` (P2) | 초대 생성 | senior·공유 동의·rate limit | `{invitation,expires_at}` / `403,429` |
| `POST /api/v1/caregiver/accept` (P2) | `{code}` | caregiver 인증·hash·만료·미사용 | `{link_status:"pending_senior_approval"}` / `400,404,410` |
| `POST /api/v1/caregiver/links/{id}/approve` (P2) | 승인 | 해당 senior·공유 동의 | `{status:"active"}` / `403,409` |
| `DELETE /api/v1/caregiver/links/{id}` (P2) | 철회 | senior 소유·즉시 차단 | `{status:"revoked"}` / `403,404` |
| `GET /api/v1/caregiver/summaries` (P2) | 요약 전용 목록 | caregiver·active link·공유 동의 | `{items,next_cursor}` / `401,403` |

코드: `400` 입력 오류, `401` 미인증, `403` 권한/동의 거부, `404` 미존재/비공개 리소스, `409` 상태 충돌·중복, `413` 크기 초과, `415` 미지원 형식, `429` 제한 초과, `5xx` 일시 장애. 요청 본문·로그에는 사진, 대화 전문, 토큰, 초대 코드, API 키를 넣지 않는다.

<a id="s4"></a>
## 4. 데이터 저장 구조

### 4.1 원칙·보관·삭제

사진 바이너리는 private Supabase Storage에, DB에는 객체 경로만 저장한다. 최소 수집·가상 시연 데이터를 원칙으로 한다. 동의 문서 버전·시각·철회 이력을 기록한다. 보관기간은 완료 후 90일을 기본 제안으로 하며 운영 전에 확정한다. 만료/사용자 삭제는 Storage와 DB를 함께 처리하며 완결 전에 성공으로 표시하지 않는다. 외부 AI 보관·학습 조건을 확인할 수 없으면 실제 민감 데이터를 보내지 않는다. 로그에 대화·사진 URL·토큰·초대 코드·키를 기록하지 않는다.

### 4.2 논리 모델·스키마

```text
auth.users 1:1 profiles
profiles 1:N consent_records
profiles 1:N sessions 1:N messages
sessions 1:1 summaries; sessions 1:1 checkins
P2: profiles ↔ caregiver_links ↔ profiles
```

| 테이블 | 핵심 필드·제약 |
|---|---|
| `profiles` | `id UUID PK/FK auth.users`, `role TEXT CHECK senior/caregiver`, `created_at TIMESTAMPTZ` |
| `consent_records` | `id UUID PK`, `user_id UUID FK`, `consent_type TEXT CHECK data_storage/ai_processing/caregiver_sharing`, `document_version TEXT`, `granted_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ NULL`; 이력 보존 |
| `sessions` | `id UUID PK`, `user_id UUID FK`, `photo_source TEXT CHECK sample/upload`, `photo_path TEXT NULL`, `started_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ NULL`, `status TEXT CHECK created/in_progress/awaiting_summary/completed/failed` |
| `messages` | `id UUID PK`, `session_id UUID FK ON DELETE CASCADE`, `turn_number SMALLINT CHECK 1..3`, `role TEXT CHECK assistant/user`, `content TEXT`, `(session_id,turn_number,role) UNIQUE` |
| `checkins` | `session_id UUID PK/FK`, `medication_status TEXT CHECK taken/not_taken/not_recorded`, `condition_status TEXT CHECK good/okay/unwell/not_recorded`, `condition_note TEXT NULL CHECK char_length <= 500`; 사용자 직접 입력 |
| `summaries` | `id UUID PK`, `session_id UUID UNIQUE FK`, `participation_count SMALLINT CHECK 0..3`, `recall_keywords TEXT[]`, `activity_summary TEXT`, `health_mention_note TEXT NULL`, `summary_source TEXT CHECK ai/fallback` |
| `caregiver_links` (P2) | senior/caregiver UUID FK, invite hash·expiry, `status CHECK pending/active/revoked/expired`, 승인·철회 시각 |
| `deletion_requests` | `id UUID PK`, `session_id UUID NULL`, `resource_type TEXT`, `resource_id UUID`, `status TEXT CHECK pending/retry/complete/failed`, `attempts INT NOT NULL DEFAULT 0`, `next_attempt_at TIMESTAMPTZ`, `last_error_code TEXT NULL`, `created_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ NULL`; 본문·객체 URL 미저장 |

`sessions.status`의 허용값은 §10.2와 동일하며 이 문서 전체에서 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`만 사용한다. 주요 인덱스: `sessions(user_id,started_at DESC)`, `messages(session_id,turn_number,created_at)`, `caregiver_links(caregiver_user_id,status)`, `deletion_requests(status,next_attempt_at)`. 세션 삭제 시 메시지·요약·체크인은 cascade한다. Storage 객체는 별도 삭제 worker가 처리한다.

### 4.3 접근 제어

모든 사용자 데이터에 RLS를 적용한다. 본인 세션만 접근 가능하고 자식 테이블은 상위 세션 소유권을 검사한다. P2 caregiver SELECT는 활성 링크·활성 공유 동의·caregiver ID가 모두 일치할 때 요약 projection에만 허용한다. caregiver 쓰기 및 원본 메시지/사진 접근은 금지한다. Storage는 private이며 `{auth.uid()}/{random_uuid}` 경로 정책을 적용한다. 서명 URL은 서버에서 권한 확인 후 필요한 경우에만 짧게 발급한다.

<a id="s5"></a>
## 5. 저장소 구성 및 구현 계약

```text
app/(auth)/login/page.tsx
app/(senior)/{page.tsx,photo/page.tsx,session/[id]/page.tsx}
app/(senior)/session/[id]/checkin/page.tsx
app/(senior)/summary/[id]/page.tsx
app/(senior)/settings/records/page.tsx
app/(caregiver)/summaries/page.tsx       # P2
app/api/v1/.../route.ts
components/
lib/{auth,consent,permissions,conversation,storage,validation,summaries,prompts}.ts
lib/ai/{base,provider,fallback}.ts
supabase/migrations/; tests/{unit,integration,e2e}/
public/sample-photos/; .env.example; README.md
```

모듈 책임: `conversation.ts`는 상태 전이·turn·멱등성, `ai/*`는 provider/timeout/retry/JSON/fallback, `storage.ts`는 signature·decode·크기·private 업로드/삭제, `permissions.ts`는 서버 권한 검사, `summaries.ts`는 스키마·안전 규칙을 담당한다. UI에서 AI를 직접 호출하지 않는다.

환경변수 이름은 `.env.example`에만 둔다: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AI_PROVIDER`, `GEMINI_API_KEY`, `MAX_IMAGE_SIZE_MB=5`, `DATA_RETENTION_DAYS=90`. `SUPABASE_SERVICE_ROLE_KEY`는 일반 앱 요청에 설정하지 않는 것을 기본으로 한다. 비밀값에 `NEXT_PUBLIC_` 접두사를 붙이거나 Git에 커밋하지 않는다.

<a id="s6"></a>
## 6. 구현 단계

1. **P0:** 접근성 홈·인증·동의, 사진 업로드 검증, 3턴 대화·저장, AI 스키마/fallback, 체크인, 요약 재조회.
2. **P1:** 소유자 RLS, 동의 철회, 전체 삭제·부분 실패 재시도, 보관 작업, 오류·네트워크 테스트.
3. **P2:** 인증된 초대, 어르신 승인, 공유 동의, 요약 전용 조회, 즉시 철회 및 권한 E2E.

음성 STT/TTS, 기관 연동, 인지 점수·치매 판정, 임상적 효과 주장, caregiver의 원본 대화·사진 열람은 MVP에서 제외한다.

<a id="s7"></a>
## 7. 테스트 및 PRD 완료 기준

| 요구 | 검증 | 완료 기준 |
|---|---|---|
| 사진 선택/업로드 | 정상·위장 MIME·손상·과대 파일 | 유효 파일만 수용 |
| 사진 기반 3턴 | 질문/답변 순서와 AI fallback | 순서 보장, AI 장애에도 완주 |
| 비단정·안전 요약 | 관계/장소 단정, 진단/위험/치료 fixture | 위험 출력 미노출 |
| 요약·체크인 | DB 새 조회 | 사용자 직접 체크인, 완료 자료 100% 저장 |
| 동의·삭제 | 미동의/철회, 삭제·부분 실패 | 처리 차단, 완결 전 성공 미표시 |
| 사용성 | 익명 ID 6명 이상, 시나리오 체크리스트 | 5/6명 이상 성공, 3분/만족도 4.0 목표 실측 보고 |
| P2 보호자 | 승인·동의·철회 접근 | 철회 즉시 차단, 미구현이면 미측정으로 보고 |

단위: 상태 전이·turn·멱등성·동의·파일·AI schema·fallback. 통합: 실제 JWT RLS·Storage·삭제. E2E: 어르신 핵심 흐름, P2 구현 후 보호자 흐름. 보고에는 가명 ID·집계 수치만 남기며 미실행 목표는 “미검증”으로 표시한다.

<a id="s8"></a>
## 8. 개인정보·AI 안전·배포 체크리스트

- [ ] 목적·전송 데이터·보관/삭제를 쉬운 말로 안내하고 미동의 시 차단
- [ ] AI 제공자 데이터 정책과 배포 플랜 한도 확인
- [ ] 가상 사용자·허가 이미지 사용
- [ ] 비단정 프롬프트·안전 출력 테스트
- [ ] 진단·위험도·치료 권고 차단, 전문기관 고정 안내
- [ ] 동의 철회·삭제 UI와 재시도 상태 확인
- [ ] 실제 JWT로 RLS positive/negative access 검증
- [ ] 서버 환경변수에만 키 보관, 비밀값·대화·사진 로그 금지
- [ ] 사진 signature·크기 검사 및 private Storage 확인
- [ ] 의료·응급 판단을 하지 않고 필요 시 전문기관 문의 안내

<a id="s9"></a>
## 9. 리스크 및 완료 판단

| 리스크 | 대응 |
|---|---|
| 무료 플랜 한도 변경 | 배포 전 공식 문서 확인, 시연 데이터 제한, 대체 구성 준비 |
| 서버리스 로컬 상태 소실 | 영속 데이터는 DB/Storage에 저장, 로컬 파일시스템을 영속 저장소로 사용하지 않음 |
| AI 부정확·유도 | 비단정 prompt, schema·안전 검증, fallback |
| 민감 기록 노출 | 동의·최소 수집·private Storage·RLS·삭제·가상 데이터 |
| 권한 오류 | API/DB 소유권 검사, 실제 JWT negative test |
| 일정 초과 | P0 우선, P2 후속 |
| 저장/삭제 실패 | 멱등 재시도, 실패 상태 추적, 성공 허위 표시 금지 |

완료는 동의 후 사진 선택, 3턴, 체크인, 요약 저장·재조회를 수행하고 AI 장애에도 fallback으로 흐름이 끝날 때 판단한다. PRD 수치는 실제 테스트로 판정한다. 설계 문서는 구현·CI·배포 증거를 대신하지 않는다.

---

<a id="s10"></a>
# 10. 구현 상세 사양

> 이 절은 구현 시 적용할 설계 기준이다. SQL/workflow는 저장소 환경에 맞는 migration/CI 파일로 옮겨 실행한다. 문서에 있는 것만으로 구현·테스트 성공을 주장하지 않으며 실제 결과는 CI·테스트 DB·배포 smoke test로 확인한다.

## 10.1 환경별 배포 및 대체안

| 환경 | 구성 | 검사 |
|---|---|---|
| Local | `.env.local`, 개발 Supabase, 가상 계정 | `npm ci`, lint, typecheck, unit/integration, build |
| Preview | PR별 테스트 Supabase·테스트 AI 키 | 운영 데이터 금지, 로그인·동의·3턴·저장 재조회 E2E |
| Demo/Production | 별도 Supabase, 제한 계정, 허가 이미지, 플랫폼 secrets | RLS·삭제·철회·fallback 사전 검사, 배포 후 smoke test |

순서: Node/package manager와 lockfile 고정 → 비밀값 제외 확인 → 개발 DB migration/RLS → A/B 접근 테스트 → lint/typecheck/unit/integration/build → Preview E2E → Demo 승인 및 사후 데이터 정리. OAuth redirect와 환경 변수를 환경별로 분리한다. Vercel 불가 시 HTTPS·Next.js App Router/API·환경변수·로그·환경 분리를 지원하는 Node 호스팅으로 이전한다. Supabase 대체 시 PostgreSQL·인증·private storage·JWT 권한·삭제 재시도와 테스트를 재구현하기 전 민감 데이터 시연을 중단한다. AI 장애 시 고정 질문과 로컬 요약으로 진행한다.

## 10.2 세션 상태 전이 및 원자성

**유일한 허용 상태 집합은 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`다.** §4.2 표, DB CHECK, API, 코드 enum, 테스트 모두 이 집합을 사용한다.

| 현재 | 조건 | 다음 | 처리 |
|---|---|---|---|
| `created` | 사진 등록 및 저장/AI 동의 활성 | `in_progress` | 첫 assistant 질문을 한 번 저장, 조건 미충족 시 거부 |
| `in_progress` | turn 1~2 예상 답변 저장 | `in_progress` | 답변 저장 후 다음 질문, 중복 요청은 이전 결과 반환 |
| `in_progress` | turn 3 답변 저장 | `awaiting_summary` | 후속 질문 없이 요약 작업 시작 |
| `awaiting_summary` | 검증된 AI/fallback 요약 저장 | `completed` | summary 1개와 완료 시각 확정 |
| 진행 상태 | 취소/복구 불가 오류 | `failed` | 민감 콘텐츠를 로그에 남기지 않음; 재시도 가능한 오류는 진행 상태 유지 |
| `completed` | 추가 turn/complete 요청 | `completed` | `409`; 별도 허용 계약 외에는 불변 |

서버는 행 잠금 또는 조건부 update와 DB transaction으로 순서를 보장한다. `(session_id,turn_number,role)` UNIQUE로 중복을 막는다. idempotency 레코드에는 사용자/세션/key, 요청 hash, 응답 결과, 만료 시각을 둔다. 같은 key·같은 본문은 기존 결과 반환, 같은 key·다른 본문은 `409`다. 외부 AI 호출은 DB transaction 밖에서 수행한다: 답변 저장 → 작업 상태 기록 → AI 호출 → 검증 → 조건부 결과 저장. 완료는 사용자 답변 3개와 summary가 있을 때만 허용한다.

사진/DB 삭제는 분산 트랜잭션이 아니다. `deletion_requests`에서 상태·시도 횟수·다음 시각·안전한 오류 코드만 관리하고, Storage 삭제 성공 확인 후 DB 삭제를 수행한다. 작업 재실행은 멱등이어야 한다.

## 10.3 PostgreSQL migration 및 RLS 기준 SQL

아래 SQL은 신규 테스트 프로젝트의 핵심 P0 schema 기준이다. 기존 DB에 무검토 적용하지 말고 순차 migration으로 조정한다. 실제 적용과 권한 테스트가 통과해야 완료로 본다.

```sql
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'senior' check (role in ('senior','caregiver')),
  created_at timestamptz not null default now()
);
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('data_storage','ai_processing','caregiver_sharing')),
  document_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);
create index consent_user_type_time_idx on public.consent_records(user_id,consent_type,granted_at desc);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'created'
    check (status in ('created','in_progress','awaiting_summary','completed','failed')),
  photo_source text not null check (photo_source in ('sample','upload')),
  photo_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create index sessions_user_started_idx on public.sessions(user_id,started_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  turn_number smallint not null check (turn_number between 1 and 3),
  role text not null check (role in ('assistant','user')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique(session_id,turn_number,role)
);
create index messages_session_turn_idx on public.messages(session_id,turn_number,created_at);

create table public.checkins (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  medication_status text not null default 'not_recorded'
    check (medication_status in ('taken','not_taken','not_recorded')),
  condition_status text not null default 'not_recorded'
    check (condition_status in ('good','okay','unwell','not_recorded')),
  condition_note text check (condition_note is null or char_length(condition_note) <= 500),
  updated_at timestamptz not null default now()
);
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  participation_count smallint not null check (participation_count between 0 and 3),
  recall_keywords text[] not null default '{}',
  activity_summary text not null check (char_length(activity_summary) between 1 and 600),
  health_mention_note text check (health_mention_note is null or char_length(health_mention_note) <= 240),
  summary_source text not null check (summary_source in ('ai','fallback')),
  created_at timestamptz not null default now()
);
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  resource_type text not null check (resource_type in ('session','photo')),
  resource_id uuid not null,
  status text not null default 'pending' check (status in ('pending','retry','complete','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index deletion_requests_due_idx on public.deletion_requests(status,next_attempt_at);

alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.checkins enable row level security;
alter table public.summaries enable row level security;
alter table public.deletion_requests enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy consent_select_own on public.consent_records for select to authenticated
  using (user_id = (select auth.uid()));
create policy consent_insert_own on public.consent_records for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy sessions_select_own on public.sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy sessions_insert_own on public.sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy sessions_update_own on public.sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sessions_delete_own on public.sessions for delete to authenticated
  using (user_id = (select auth.uid()));
create policy messages_owner_all on public.messages for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = messages.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = messages.session_id and s.user_id = (select auth.uid())));
create policy checkins_owner_all on public.checkins for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = checkins.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = checkins.session_id and s.user_id = (select auth.uid())));
create policy summaries_owner_all on public.summaries for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = summaries.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = summaries.session_id and s.user_id = (select auth.uid())));

-- Worker 전용: authenticated/anon은 deletion request를 읽거나 쓸 수 없다.
revoke all on public.deletion_requests from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.messages, public.checkins, public.summaries to authenticated;
```

`deletion_requests`에는 일반 사용자용 RLS policy나 grant를 두지 않는다. 삭제 worker는 사용자 요청 API와 분리된 비공개 백엔드 작업으로만 실행한다. Supabase `service_role`을 쓰는 경우 RLS를 우회하는 고권한 키임을 전제로, 키를 worker secret에만 보관하고 작업을 삭제 큐 처리로 한정하며 브라우저·일반 API에 전달하지 않는다. 가능하면 제한된 DB 함수/역할을 사용하고 실제 권한을 테스트한다. 동의와 상태 전이는 SQL 기준안 외에도 서버/API에서 검증한다. Storage RLS와 P2 caregiver 정책은 별도 migration·negative test 전에는 사용하지 않는다.

## 10.4 보관 만료 및 API 제한

완료 후 90일을 기본 보관기간으로 제안한다. 정기 작업은 매일 03:00 UTC, batch 최대 100건으로 실행한다. 만료 건은 deletion request 생성 → Storage 삭제 확인 → DB 삭제 순으로 처리한다. 실패 상태·시도 횟수·`next_attempt_at`·안전한 오류 코드만 보존하고 backoff 1분·5분·30분·최대 6시간을 적용한다. 재실행은 멱등이어야 한다. 사진 URL과 대화 본문은 로그에 남기지 않는다. 백업·AI 제공자 잔존 정책은 별도로 고지·검증한다.

| 대상 | 초기 제한 | 초과 처리 |
|---|---:|---|
| JSON 본문 | 64 KiB | `413` |
| 답변/체크인 메모 | 4,000자 / 500자 | `400` |
| 이미지 | 5 MiB, JPEG/PNG/WebP | `413`/`415` |
| 목록 페이지 | 기본 20, 최대 50 | `400` |
| AI | timeout 15초, 사용자 동시 2개, 재시도 1회 | 이후 fallback |
| 사용자 API | 60회/분/사용자 | `429`, `Retry-After` |
| 업로드 | 10회/시간/사용자 | `429` |
| AI 생성 | 20회/시간/사용자, 턴당 최대 2회 | 제한 시 fallback 또는 `429` |
| P2 초대 발급 | 5회/시간, 코드 15분·일회성 | `429` |

분산 배포에서 공유 저장소/플랫폼 기능으로 제한을 적용하며 프로세스 메모리 카운터만 사용하지 않는다. 실제 공급자 한도 검토 후 조정한다.

## 10.5 CI·테스트·증거

현재 `package.json` 스크립트가 확인되지 않았다는 전제에서 `lint`, `typecheck`, `test`를 구현 단계에서 필수로 추가한다. CI는 `--if-present`를 사용하지 않으므로 스크립트 누락 시 실패한다. PR CI는 lockfile 설치, lint, typecheck, unit test, migration 검증, production build를 수행한다. Preview E2E는 별도 테스트 DB/가상 데이터만 사용하고 secrets는 GitHub Actions secrets에만 둔다.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --run
      - run: npm run build
```

Workflow는 저장소 스크립트와 Node LTS 버전에 맞춰 실제 파일로 추가한다. Migration CI는 빈 DB에 전체 migration을 적용하고 RLS 검사는 실제 authenticated JWT로 수행한다.

| 테스트 | 준비 | 기대 결과 |
|---|---|---|
| RLS 소유권 | A/B JWT, A의 세션 | A 접근 허용, B 조회 비노출·수정/삭제 거부 |
| 동의 가드 | 미동의 또는 철회 | 세션·업로드·AI 요청 거부, 데이터 미생성 |
| 상태·turn | 정상, 건너뜀, 4번째 답변, 완료 후 재요청 | 정상만 허용, 충돌 `409`, 중복 row 없음 |
| 멱등성 | 같은 키/같은 본문, 같은 키/다른 본문 | 기존 결과 재응답 / `409` |
| AI 안전 | JSON 오류·누락·길이 초과·진단/관계 단정·timeout | 위험 출력 미노출, 재시도 후 fallback |
| 업로드 | 허용 파일·MIME 위장·손상·과대·SVG | 정상만 허용, 나머지 거부 |
| 저장/삭제 | summary 실패, Storage 삭제 실패 후 재시도 | 완료/삭제 허위 표시 없음, 재시도 수렴 |
| 보관 작업 | 만료/미만료, 실패 객체 | 만료만 enqueue, 실패 추적, 로그 PII 없음 |

CI 보고에는 run URL, commit SHA, 통과/실패 건수, 환경만 남긴다. 사진·대화·실사용자 식별정보는 artifact/log에 넣지 않는다. 사용성 실측과 미실행 항목은 자동 테스트와 별도로 보고한다.

## 10.6 구현·검증 판정

이 문서는 설계 기준이며 점수나 구현 완료를 보장하지 않는다. 제출 증거로 migration 적용 결과, A/B RLS positive/negative test, CI run URL 및 성공 SHA, Preview/Demo smoke test, 6명 이상 사용성 결과(가명 ID·집계 수치), 미검증 P1/P2 및 잔여 위험을 제시한다. 실행하지 않은 항목은 “미검증”으로 표시한다.
