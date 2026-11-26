# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부
- **서비스명:** 정담이
- **기반 문서:** `PRD.md` (정담이 해커톤 팀 아이디어 PRD)
- **목적:** PRD 사용자 흐름을 구현 가능한 아키텍처, API, 데이터 모델, 보안 정책, 테스트 기준으로 구체화한다.
- **범위:** 해커톤 웹 프로토타입 및 시연
- **설계 원칙:** 핵심 가치 우선, 빠른 프리뷰 배포, 최소 데이터 수집, 명시적 동의, 서버 측 권한 검증, 비진단적 AI 사용

> 본 문서는 프로토타입 기술 설계이며 의료기기·임상 진단 시스템 설계가 아니다. AI 결과는 인지활동과 일상 건강 변화에 관한 참고용 요약으로만 표시한다. 질환·인지기능·긴급도를 판정하지 않는다.

## 목차

- [0. PRD 정합성 및 우선순위](#s0)
- [1. 시스템 아키텍처](#s1)
- [2. 데이터 흐름과 기능 계약](#s2)
- [3. API 명세](#s3)
- [4. 데이터 저장 구조](#s4)
- [5. 저장소 구성 및 구현 계약](#s5)
- [6. 구현 단계](#s6)
- [7. 테스트 및 PRD 완료 기준](#s7)
- [8. 개인정보·AI 안전·배포 체크리스트](#s8)
- [9. 리스크 및 완료 판단](#s9)
- [10. 구현 상세 부록](#s10)

<a id="s0"></a>
## 0. PRD 정합성 및 우선순위

### 0.1 기술 선택과 범위

PRD의 Python·Streamlit·SQLite는 단일 환경에서 빠르게 시연하기 위한 선택이다. TRD는 브라우저 기반 프리뷰 배포, 인증 사용자 간 데이터 분리, 사진의 비공개 저장 및 관계형 기록 관리를 위해 **Next.js + Vercel + Supabase (PostgreSQL/Auth/Storage)** 를 선택한다. 기술 변경은 PRD 제품 범위나 완료 기준을 바꾸지 않는다. Vercel Hobby와 Supabase Free는 시작 후보이며 요금·한도·지역·이용 조건은 배포 시점의 공식 정책으로 확인한다.

P0 핵심 흐름은 동의 → 예시/업로드 사진 선택 → 사진을 참고한 질문과 답변 3턴 → 키워드·요약 및 복약/컨디션 직접 입력 저장 → 활동 요약 재조회다. AI 장애 시에도 fallback으로 완주한다. 보호자 공유는 핵심 흐름 안정화 후 P2로 추가한다. 사용성 목표(6명 이상, 5/6명 이상 성공, 완주 3분 이내, 만족도 평균 4.0/5 이상 등)는 실제 결과로 판정하며 문서만으로 달성을 주장하지 않는다.

### 0.2 MVP 우선순위

| 우선순위 | 범위 | 완료 판단 |
|---|---|---|
| P0 — 시연 필수 | 예시/업로드 사진, 동의, 3턴 대화, AI/fallback, 키워드·요약, 체크인, 저장·재조회 | 새로고침 후 기록 확인, AI 실패에도 완료 가능 |
| P1 — 안전·운영 | 인증, 본인 데이터 격리, private Storage, 삭제, 입력/출력 검증, 실패 안내 | 비인가 접근 차단, 철회·삭제 결과 확인, 안전 테스트 통과 |
| P2 — 확장 | 보호자 초대·승인·공유 동의·요약 전용 조회·철회 | 관계와 동의가 모두 활성일 때만 조회, 철회 즉시 차단 |

P2는 P0 시연 전에 필수로 요구하지 않는다. 공개 배포 또는 실제 사용자 데이터 처리 전에는 P1의 인증·권한·동의·삭제 안전장치를 생략하지 않는다.

<a id="s1"></a>
## 1. 시스템 아키텍처

### 1.1 기술 스택 및 경계

| 영역 | 선택 | 책임 |
|---|---|---|
| UI/API | Next.js App Router, TypeScript | 화면, 인증 세션 확인, 입력·동의·소유권 검증, 상태 전이 |
| 배포 | Vercel 후보 | HTTPS, PR Preview, 환경별 비밀값 주입 |
| DB/Auth/파일 | Supabase PostgreSQL, Auth, private Storage | 관계형 저장, 인증, RLS, 사진 객체 |
| 생성형 AI | Gemini 등 서버 호출 provider | 사진 기반 첫 질문, 답변 기반 후속 질문, 세션 요약 |
| 검증 | Zod, Vitest/Jest, Playwright | 입력·AI 출력 스키마, 규칙 테스트, 핵심 브라우저 흐름 |

```text
[어르신/보호자 브라우저] --HTTPS--> [Next.js UI/API]
                                      ├─ Auth 세션·동의·권한 검증
                                      ├─ 대화 상태 전이·저장 결과 처리
                                      └─ 서버 전용 어댑터
                                          ├─ Supabase Auth
                                          ├─ PostgreSQL + RLS
                                          ├─ private Storage
                                          └─ AI API
```

브라우저의 데이터 요청은 인증 사용자의 JWT/RLS 정책 아래 처리한다. AI 키와 `service_role`은 서버 비밀값이며 일반 사용자 요청에서 RLS 우회 용도로 사용하지 않는다. 관리자 작업이 필요하면 사용자 API와 분리된 제한된 환경에서만 실행한다.

### 1.2 역할과 주요 화면

- **어르신:** 본인의 동의, 사진, 세션, 메시지, 요약, 체크인을 생성·조회·삭제한다.
- **보호자(P2):** 초대·승인·활성 연결·공유 동의가 모두 유효한 경우에만 요약과 직접 입력 체크 항목을 읽는다. 원본 사진·대화는 읽지 않는다.
- **담당자:** MVP에서 기관별 다중 사용자 관리 기능을 구현하지 않는다.

`role`이나 화면 숨김만으로 권한을 부여하지 않는다. 보호자 권한은 매 요청에서 활성 `caregiver_links`와 유효한 공유 동의를 서버/RLS로 확인한다. P2 미구현 배포에서는 관련 화면과 경로를 제공하지 않는다.

주요 흐름은 홈/로그인 → 동의 → 사진 선택/업로드 → 회상 대화 3턴 → 오늘 기록 → DB에서 활동 요약 재조회다. 기록 화면에는 큰 글씨·고대비·명확한 저장 성공/실패를 제공한다. 로그인 실패는 민감 데이터를 표시하지 않으며 저장 실패 시 입력을 유지하고 재시도하도록 한다.

해커톤 시연에는 사전 준비한 데모 계정 또는 참여자별 체험 계정을 사용할 수 있다. 데모 계정도 정상 인증·동의·소유권·권한 검증을 거치며 우회 모드는 제공하지 않는다. 가상 사용자와 사용 허가된 이미지만 사용한다. 공용 계정은 개인 기록을 입력하지 않고 초기화 가능한 가상 데이터만 사용한다.

<a id="s2"></a>
## 2. 데이터 흐름과 기능 계약

### 2.1 동의·인증

1. Supabase Auth 사용자를 인증하고 데이터에 인증 사용자 UUID를 연결한다.
2. 저장 및 AI 전송 목적, 전달 데이터, 보관/삭제 방법을 쉬운 문장으로 안내하고 문서 버전·동의 시각을 기록한다.
3. 저장 또는 AI 처리 동의가 없거나 철회된 경우 사진 업로드, 세션 생성, AI 요청을 거부한다.
4. P2 초대는 만료·일회성 무작위 코드, 보호자의 인증된 입력, 어르신 최종 승인 순으로 진행한다. 코드 원문은 저장·로그에 남기지 않고 검증 가능한 해시만 보관한다. 공유 동의나 연결 철회 후 보호자 조회를 즉시 차단한다.

### 2.2 사진·3턴 대화

- 허용 형식은 JPEG/PNG/WebP다. 확장자·MIME뿐 아니라 파일 signature와 실제 디코딩을 검사하고 기본 최대 크기 5 MiB를 적용한다. SVG 및 실행 가능 형식은 거부한다. 객체명은 무작위 UUID이며 버킷은 private다.
- 세션 생성·사진 연결 전 저장 및 AI 동의를 확인한다. 사진이 연결되기 전 세션은 진행할 수 없다. AI에는 승인된 이미지 바이너리와 필요한 최소 대화 문맥만 전달한다. 실명, 계정 자격 증명, 보호자 정보, 타 사용자 기록은 보내지 않는다.
- 답변마다 소유권, 상태, 예상 turn, 길이, 멱등성 키를 서버에서 검증한다. 답변 저장 성공 후 다음 질문을 요청·저장한다. 세 번째 답변 뒤에는 후속 질문 없이 요약을 만든다.
- 질문은 사용자의 설명을 우선하고 비단정적으로 작성한다. 사진만으로 인물 신원·관계, 날짜·장소·사건을 사실처럼 추측하지 않는다.
- AI 호출은 15초 timeout, 1회 제한 재시도 후 fallback을 사용한다. fallback도 실패하면 고정 질문 템플릿으로 계속 진행한다. AI가 생성한 문구에는 참고용임을 표시한다.

### 2.3 체크인·건강 안전

복약·컨디션은 사용자가 직접 선택한 값만 저장하며 대화에서 추론하지 않는다. 사용자 입력과 AI 요약을 화면에서 구분한다. `health_mention_note`는 발화에 실제로 나온 불편 표현의 중립적 짧은 정리 또는 `null`이다. 진단명, 치매 가능성, 점수·위험도, 치료·복약 권고를 포함하지 않는다. 전문 상담 안내는 AI 판단이 아닌 고정 문구로 제공하며 응급도 분류는 하지 않는다.

### 2.4 AI 스키마 계약

서버는 요청마다 최소 데이터를 구성하고 JSON parse → Zod/JSON Schema 검증 → 안전 검증을 순서대로 수행한다. 구현 시 각 호출별로 별도 Zod 스키마를 둔다.

**첫 질문 입력** (이미지는 공개 URL/Storage 경로가 아니라 서버 SDK의 승인된 바이너리 전달로 제공):
```json
{"photo_type":"sample","instruction":"보이는 내용만 참고해 열린 질문 하나를 작성하고 인물·관계·날짜·장소를 추측하지 않는다."}
```
**첫 질문 출력:** `{"question":"이 사진을 보시니 어떤 기억이 떠오르시나요?"}`

**후속 질문 입력:**
```json
{"turn_number":2,"current_answer":"가족과 바닷가에 갔어요.","recent_context":[{"role":"assistant","content":"이 사진을 보시니 어떤 기억이 떠오르시나요?"},{"role":"user","content":"가족과 바닷가에 갔어요."}]}
```
**후속 질문 출력:** `{"question":"그날 기억나는 장면이나 느낌이 있으신가요?"}`

현재 답변과 최근 최대 4개 메시지만 보내며 메시지당 최대 1,000자다. `turn_number`는 2~3이며 세 번째 답변 후 후속 질문을 요청하지 않는다.

**요약 입력:**
```json
{"messages":[{"turn_number":1,"content":"가족과 바닷가에 갔어요."},{"turn_number":2,"content":"파도 소리가 기억나요."},{"turn_number":3,"content":"즐거웠어요."}]}
```
**요약 출력:**
```json
{"recall_keywords":["가족","바닷가"],"activity_summary":"사용자는 가족과 바닷가에 갔던 기억과 파도 소리에 대한 느낌을 이야기했습니다.","health_mention_note":null}
```

`question`: 1~240자 문자열. `recall_keywords`: 0~5개, 항목당 1~40자. `activity_summary`: 1~600자. `health_mention_note`: null 또는 1~240자의 실제 발화에 근거한 중립적 요약. 공백만인 값, 길이 초과, 필드 누락, 진단/위험/관계 단정은 거부하고 재시도 1회 후 fallback한다. 사용자 체크인 값은 AI가 만들거나 덮어쓰지 않는다. fallback 건강 메모는 항상 `null`이다.

### 2.5 오류 처리

| 상황 | 서버 처리 | 사용자 안내 |
|---|---|---|
| AI 오류/timeout/잘못된 JSON | 1회 재시도 후 안전한 fallback | 기본 질문/요약으로 계속 진행 |
| 업로드 실패 | 진행/완료 상태 확정 금지, 민감정보 없는 오류 코드 기록 | 사진 재선택·재시도 |
| 답변/체크인 저장 실패 | 성공 표시 금지, 멱등 재시도 | 입력 보존 후 재시도 |
| 요약 저장 실패 | 완료 확정 금지, 재시도 가능한 상태 유지 | 기록이 아직 저장되지 않았음을 표시 |
| 권한/동의 없음 | 데이터 반환 없이 거부 | 재로그인/동의·연결 확인 |
| 부분 삭제 실패 | deletion request 추적·재시도 | 완료로 표시하지 않고 처리 상태 안내 |

<a id="s3"></a>
## 3. API 명세

모든 애플리케이션 API의 기준 경로는 `/api/v1`이며 아래 경로는 실제 접두사를 포함한다. API는 인증, Zod 입력 검증, 소유권, 동의, 상태 전이를 서버에서 확인한다. 타 사용자 리소스는 `404` 또는 일관된 권한 오류로 응답한다. AI·Storage 비밀값은 반환하지 않는다.

| Method / path | 목적·요청 핵심 | 검증·권한 | 성공/주요 오류 |
|---|---|---|---|
| `GET /api/v1/me` | 사용자·역할 | 인증 세션 | `{user}` / `401` |
| `POST /api/v1/consents` | `{consent_type, granted, document_version}` | 본인, type allowlist, 이력 보존 | `{consent}` / `400,401` |
| `POST /api/v1/sessions` | `{photo_source,sample_id?}` | 본인, 저장·AI 동의, sample allowlist | `{session_id,status}` / `400,401,403` |
| `POST /api/v1/sessions/{id}/photo` | multipart photo | 소유자, 동의, signature·decode·크기 검사 | `{photo_attached:true}` / `400,403,413,415,5xx` |
| `POST /api/v1/sessions/{id}/turns` | `{answer,turn_number,idempotency_key}` | 소유자, 상태, 순서, 길이, 중복 키 | `{saved_turn,next_question,status}` / `400,403,409,5xx` |
| `POST /api/v1/sessions/{id}/complete` | 완료·요약 | 답변 3개, 소유자, 멱등성 | `{summary,status}` / `403,409,5xx` |
| `PATCH /api/v1/sessions/{id}/checkin` | medication/condition/note | 소유자, enum·길이, 사용자 직접 입력 | `{checkin}` / `400,403,409,5xx` |
| `GET /api/v1/sessions` | 목록·cursor | 본인, page size 제한 | `{items,next_cursor}` / `401` |
| `GET /api/v1/sessions/{id}` | 세션·메시지·요약 | 본인 또는 P2 요약 projection 권한 | `{session,messages,summary}` / `403/404` |
| `DELETE /api/v1/sessions/{id}` | 삭제 요청 | 본인 재확인, 소유권, 삭제 추적 | `{deletion_status,request_id}` / `403,404,5xx` |
| `POST /api/v1/caregiver/invitations` (P2) | 초대 생성 | senior, 공유 동의, 만료·rate limit | `{invitation,expires_at}` / `403,429` |
| `POST /api/v1/caregiver/accept` (P2) | `{code}` | caregiver 인증, hash·만료·미사용 | `{link_status:"pending_senior_approval"}` / `400,404,410` |
| `POST /api/v1/caregiver/links/{id}/approve` (P2) | 승인 | 해당 senior, 공유 동의 | `{status:"active"}` / `403,409` |
| `DELETE /api/v1/caregiver/links/{id}` (P2) | 철회 | senior 소유, 즉시 차단 | `{status:"revoked"}` / `403,404` |
| `GET /api/v1/caregiver/summaries` (P2) | 요약 전용 목록 | caregiver + active link + 공유 동의 | `{items,next_cursor}` / `401,403` |

상태 코드는 `400` 입력 오류, `401` 미인증, `403` 권한/동의 거부, `404` 미존재/비공개 리소스, `409` 상태 충돌·중복 요청, `413` 크기 초과, `415` 미지원 형식, `429` 제한 초과, `5xx` 일시 장애를 뜻한다. 요청 본문·로그에는 사진, 대화 전문, 토큰, 초대 코드, API 키를 넣지 않는다.

<a id="s4"></a>
## 4. 데이터 저장 구조

### 4.1 원칙·보관·삭제

사진 바이너리는 private Supabase Storage에, DB에는 객체 경로만 저장한다. 최소 수집·가상 시연 데이터를 원칙으로 한다. 동의 문서 버전·시각·철회 이력을 저장한다. 기본 보관기간은 완료 후 90일로 제안하며 운영 전 확정한다. 만료·사용자 요청 삭제는 Storage와 DB를 함께 처리하며 완결 전에 성공으로 표시하지 않는다. 외부 AI의 보관·학습 조건을 확인할 수 없으면 실제 민감 데이터를 전송하지 않는다. 앱 로그에 대화, 사진 URL, 토큰, 초대 코드, 키를 기록하지 않는다.

### 4.2 논리 모델·핵심 컬럼

```text
auth.users 1:1 profiles
profiles 1:N consent_records
profiles 1:N sessions 1:N messages
sessions 1:1 summaries
sessions 1:1 checkins
P2: profiles ↔ caregiver_links ↔ profiles
```

| 테이블 | 핵심 필드·제약 |
|---|---|
| `profiles` | `id UUID PK/FK auth.users`, `role TEXT CHECK senior/caregiver`, `created_at TIMESTAMPTZ` |
| `consent_records` | `id UUID PK`, `user_id UUID FK`, `consent_type TEXT CHECK data_storage/ai_processing/caregiver_sharing`, `document_version TEXT`, `granted_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ NULL`; 이력 보존 |
| `sessions` | `id UUID PK`, `user_id UUID FK`, `photo_source TEXT CHECK sample/upload`, `photo_path TEXT NULL`, `started_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ NULL`, `status TEXT CHECK created/in_progress/awaiting_summary/completed/failed`; 상태 허용값은 §10.2와 일치 |
| `messages` | `id UUID PK`, `session_id UUID FK ON DELETE CASCADE`, `turn_number SMALLINT CHECK 1..3`, `role TEXT CHECK assistant/user`, `content TEXT`, `(session_id,turn_number,role) UNIQUE` |
| `checkins` | `session_id UUID PK/FK`, `medication_status TEXT`, `condition_status TEXT`, `condition_note TEXT NULL`; 사용자 직접 입력 |
| `summaries` | `id UUID PK`, `session_id UUID UNIQUE FK`, `participation_count SMALLINT CHECK 0..3`, `recall_keywords TEXT[]`, `activity_summary TEXT`, `health_mention_note TEXT NULL`, `summary_source TEXT CHECK ai/fallback` |
| `caregiver_links` (P2) | `id UUID PK`, senior/caregiver UUID FK, `invite_code_hash TEXT NULL`, `invite_expires_at TIMESTAMPTZ NULL`, `status TEXT CHECK pending/active/revoked/expired`, approval/revocation timestamps |
| `deletion_requests` | `id UUID PK`, `session_id UUID NULL FK`, `resource_type TEXT`, `resource_id UUID`, `status TEXT CHECK pending/retry/complete/failed`, `attempts INT NOT NULL DEFAULT 0`, `next_attempt_at TIMESTAMPTZ`, `last_error_code TEXT NULL`, `created_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ NULL`; 민감 본문·객체 URL 저장 금지 |

`deletion_requests`에는 상태 재시도에 필요한 식별자와 오류 코드만 저장한다. 객체 URL이나 파일 내용은 저장하지 않으며, 제한된 삭제 worker만 읽고 쓸 수 있도록 별도 권한/RLS 정책을 적용한다. 핵심 인덱스는 `sessions(user_id, started_at DESC)`, `messages(session_id,turn_number,created_at)`, `caregiver_links(caregiver_user_id,status)`, `deletion_requests(status,next_attempt_at)`이다. 자식 메시지·요약은 세션 삭제에 cascade하지만 Storage 삭제는 별도 작업으로 처리한다.

### 4.3 접근 제어

모든 사용자 데이터 테이블에 RLS를 활성화한다. 세션은 `user_id = auth.uid()`인 본인만 읽고 쓰며, 자식 테이블은 상위 세션 소유권을 검사한다. caregiver SELECT는 활성 링크, 활성 공유 동의, caregiver ID가 모두 일치할 때 요약 projection에만 허용한다. caregiver 쓰기, 원본 메시지·사진 접근은 금지한다. Storage는 private이며 `{auth.uid()}/{random_uuid}` 경로 정책을 둔다. 서명 URL은 필요한 경우 서버에서 권한 확인 후 짧은 만료로 발급한다. `service_role`은 브라우저·일반 요청에서 사용하지 않는다.

<a id="s5"></a>
## 5. 저장소 구성 및 구현 계약

```text
TRD-/
├── app/(auth)/login/page.tsx
├── app/(senior)/{page.tsx,photo/page.tsx,session/[id]/page.tsx}
├── app/(senior)/session/[id]/checkin/page.tsx
├── app/(senior)/summary/[id]/page.tsx
├── app/(senior)/settings/records/page.tsx
├── app/(caregiver)/summaries/page.tsx       # P2
├── app/api/v1/.../route.ts
├── components/
├── lib/{auth,consent,permissions,conversation,storage,validation,summaries,prompts}.ts
├── lib/ai/{base,provider,fallback}.ts
├── supabase/migrations/
├── tests/{unit,integration,e2e}/
├── public/sample-photos/                    # 사용 허가된 이미지
├── .env.example
└── README.md
```

- `conversation.ts`: 상태 전이, 3턴 제한, 멱등성, 답변 저장 후 질문 생성 순서.
- `ai/*`: provider interface, timeout/retry, JSON parsing, 안전 fallback. UI에서 직접 AI를 호출하지 않는다.
- `storage.ts`: 파일 signature/decode/MIME/크기, UUID 객체명, private 업로드·삭제.
- `permissions.ts`: 세션 소유권·동의·보호자 관계의 서버 검사.
- `summaries.ts`: 응답 스키마·비진단 규칙·fallback 요약.

환경 변수는 `.env.example`에 이름만 둔다: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AI_PROVIDER`, `GEMINI_API_KEY`, `MAX_IMAGE_SIZE_MB=5`, `DATA_RETENTION_DAYS=90`. `SUPABASE_SERVICE_ROLE_KEY`는 미설정을 기본으로 한다. 키는 `NEXT_PUBLIC_` 접두사를 쓰거나 Git에 커밋하지 않는다.

<a id="s6"></a>
## 6. 구현 단계

1. **P0:** 접근성 홈·인증·동의, 사진 선택/업로드, 파일 검증, 3턴 대화/저장, AI JSON 검증과 fallback, 체크인, 요약 재조회.
2. **P1:** 소유자 RLS, 동의 철회, 삭제 및 부분 실패 재시도, 보관 작업, 오류·네트워크 테스트.
3. **P2:** 인증된 초대, 어르신 승인, 공유 동의, 요약 전용 projection, 즉시 철회 및 권한 E2E.

음성 STT/TTS, 기관 연동, 인지 점수·치매 판정, 임상적 효과 주장, caregiver의 원본 대화·사진 열람은 MVP에서 제외한다.

<a id="s7"></a>
## 7. 테스트 및 PRD 완료 기준

| 요구/목표 | 검증 | 완료 기준 |
|---|---|---|
| 사진 선택/업로드 | 정상 예시·업로드, 위장 MIME·손상·과대 파일 | 유효 파일만 수용 |
| 사진 기반 3턴 질문·답변 | 질문 3개/답변 3개 순서 및 fallback | 순서 보장, AI 장애에도 완주 |
| 비단정 질문·안전 요약 | 관계/장소 단정, 진단/위험/치료 출력 fixture | 위험 출력 미노출, fallback 적용 |
| 요약·체크인 저장 | 새 조회로 DB 결과 확인 | 체크인은 사용자 입력만, 완료 자료 100% 저장 |
| 동의·삭제 | 미동의/철회, 삭제 및 부분 실패 테스트 | 처리 차단, 삭제 완료 전 성공 미표시, 삭제 후 접근 거부 |
| 사용성 | 익명 ID 6명 이상, 전체 시나리오 체크리스트 | 6명 중 5명 이상 성공, 3분 목표·만족도 4.0/5 보고 |
| P2 보호자 조회 | 승인/동의/철회 권한 테스트 | 철회 즉시 차단. 미구현 상태는 미측정으로 보고 |

단위 테스트는 상태 전이·턴 제한·멱등성·동의·파일·AI schema·fallback을, 통합 테스트는 JWT 기반 RLS·Storage·삭제를, E2E는 어르신 핵심 흐름과 P2 보호자 흐름(구현 후)을 다룬다. 테스트 보고에는 가명 ID와 집계 수치만 남기며 사진·대화 전문은 저장하지 않는다. 미실행 목표는 “미검증”이라고 명시한다.

<a id="s8"></a>
## 8. 개인정보·AI 안전·배포 체크리스트

- [ ] 목적·전송 데이터·보관/삭제를 쉬운 말로 안내하고 동의 거부 시 진행 차단
- [ ] AI 제공자의 데이터 처리·보관·학습 정책 및 배포 플랜 한도 확인
- [ ] 가상 사용자·허가 이미지 사용
- [ ] 인물·관계·장소·기억 비단정 프롬프트와 안전 테스트
- [ ] 진단·위험도·치료 권고 차단 및 전문기관 고정 안내
- [ ] 동의 철회·삭제 UI와 재시도 상태 확인
- [ ] 실제 JWT로 RLS positive/negative access 검증
- [ ] 서버 환경변수에만 키 보관, 비밀값·대화·사진 로그 금지
- [ ] 사진 signature·크기 검사 및 private Storage 확인
- [ ] 의료·응급 판단을 하지 않고 필요 시 보호자/전문기관 문의 안내

<a id="s9"></a>
## 9. 리스크 및 완료 판단

| 리스크 | 대응 |
|---|---|
| 무료 플랜 한도·정책 변경 | 배포 전 공식 문서 확인, 시연 데이터 제한, 대체 구성 준비 |
| 서버리스 로컬 상태 소실 | 영속 데이터는 DB/Storage에 저장, 로컬 파일시스템을 영속 용도로 사용하지 않음 |
| AI 부정확·유도 | 비단정 prompt, schema·안전 검증, fallback |
| 사진·건강 기록 노출 | 동의·최소 수집·private Storage·RLS·삭제·가상 데이터 |
| 권한 오류 | API 및 DB 소유권 검사, 실제 JWT negative test |
| 일정 초과 | P0 우선, P2 후속 |
| 저장/삭제 부분 실패 | 멱등 재시도, 실패 상태 추적, 성공 허위 표시 금지 |

완료는 동의 후 사진을 선택하고 3턴 대화, 직접 체크인, 요약 저장·재조회를 수행하며 AI 장애 시에도 fallback으로 핵심 흐름을 완료할 수 있을 때 판단한다. PRD 수치는 실제 테스트 결과로 판정한다. 이 문서의 상세 설계는 실제 코드·CI·배포 테스트를 대신하지 않는다.

---

<a id="s10"></a>
# 10. 구현 상세 부록

> 이 절은 구현 단계에서 적용할 기준 사양이다. SQL과 CI는 프로젝트 환경에 맞춰 migration/workflow 파일로 옮겨 실행한다. 문서에 기재된 것만으로 구현·테스트 성공을 주장하지 않으며, 실제 결과는 CI·테스트 DB·배포 smoke test로 확인한다.

## 10.1 환경별 배포 및 공급자 대체

| 환경 | 구성 | 검증 |
|---|---|---|
| Local | `.env.local`, 개발 Supabase, 가상 계정·샘플 | `npm ci`, lint, typecheck, unit/integration, build |
| Preview | PR별 별도 테스트 Supabase·테스트 AI 키 | 운영 데이터 금지, 로그인·동의·3턴·저장 재조회 E2E |
| Demo/Production | 별도 Supabase, 제한 계정, 허가 이미지, 플랫폼 secret | RLS·삭제·철회·fallback 사전 확인, 배포 후 smoke test |

실행 순서: Node/package manager와 lockfile 고정 → 비밀값 제외 확인 → 개발 DB migration/RLS 적용 → 사용자 A/B 권한 테스트 → 정적 검사·단위/통합 테스트·build → Preview E2E → Demo 승인 및 사후 데이터 정리. OAuth redirect와 환경 변수를 환경별로 분리한다.

Vercel이 불가하면 HTTPS, Next.js App Router/API Route, 서버 환경변수, 로그, Preview/Production 분리를 지원하는 Node.js 호스팅으로 옮긴다. Supabase 대체 시 PostgreSQL·인증·private object storage·JWT 기반 권한·삭제 재시도와 통합 테스트를 재구현하기 전 민감 데이터 시연을 중단한다. AI 불가 시 provider adapter의 고정 질문·로컬 요약으로 동작시킨다.

## 10.2 세션 상태 전이 및 원자성

**유일한 허용 상태 집합은 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`다.** 이 값은 §4.2 데이터 모델, DB CHECK, API, 코드 enum, 테스트 모두에 동일하게 사용한다.

| 현재 | 조건/명령 | 다음 | 규칙 |
|---|---|---|---|
| `created` | 사진 등록 + 저장/AI 동의 활성 | `in_progress` | 첫 assistant 질문을 한 번 저장. 미등록/미동의면 거부 |
| `in_progress` | turn 1~2의 예상 답변 저장 | `in_progress` | 답변 저장 성공 후 다음 질문. 중복 요청은 이전 결과 재응답 |
| `in_progress` | turn 3 답변 저장 | `awaiting_summary` | 후속 질문 없음; 요약 작업 시작 |
| `awaiting_summary` | schema·안전 검증된 AI 또는 fallback 요약 저장 | `completed` | summary 1개 및 완료 시각을 함께 확정 |
| 진행 상태 | 취소/복구 불가 오류 | `failed` | 민감 콘텐츠를 로그에 넣지 않음; 재시도 가능한 장애는 진행 상태 유지 |
| `completed` | 추가 turn/complete 요청 | `completed` | `409`; 허용된 별도 수정 계약 외에는 불변 |

서버는 행 잠금 또는 조건부 update와 DB transaction으로 순서를 보장한다. `(session_id,turn_number,role)` UNIQUE로 중복 행을 막는다. idempotency 테이블에는 user/session/key, request hash, 응답 결과, 만료 시각을 저장한다. 동일 key·동일 본문은 기존 결과, 동일 key·다른 본문은 `409`다. 외부 AI를 DB transaction 내부에서 기다리지 않는다. 답변 저장 → 작업 상태 기록 → 외부 호출 → 검증 → 조건부 결과 저장 순으로 처리한다. 완료는 사용자 답변 3개와 summary가 있을 때만 허용한다.

사진 객체와 DB 삭제는 분산 트랜잭션이 아니다. §4.2 `deletion_requests`에서 상태·시도 횟수·다음 시각·안전한 오류 코드만 관리하고, Storage 삭제 성공 확인 후 DB 삭제를 수행한다. 재실행은 멱등이어야 한다.

## 10.3 PostgreSQL migration 및 RLS 기준 SQL

아래 SQL은 P0 핵심 테이블을 새 테스트 프로젝트에 만들기 위한 기준이다. 기존 schema에 무검토 적용하지 말고 순차 migration으로 조정한다. 상태 CHECK는 §10.2의 단일 집합과 일치한다.

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

-- deletion_requests는 사용자에게 직접 쓰기 권한을 주지 않고 제한된 worker만 처리한다.
revoke all on public.deletion_requests from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.messages, public.checkins, public.summaries to authenticated;
```

SQL은 소유자 RLS 기준이며 추가 business rule(동의 활성, 상태 전이)은 서버/API에서도 검사한다. 직접 테이블 쓰기를 제한하려면 사용자 쓰기 grant를 철회하고 검증된 서버 함수/API만 사용한다. Storage 버킷 RLS와 P2 caregiver 요약 정책은 별도 migration·negative test 전에는 사용하지 않는다.

## 10.4 보관 만료 및 API 제한 기준

보관 기본값은 완료 후 90일이다. 정기 작업은 매일 03:00 UTC 실행, batch 최대 100건을 기준으로 한다. 만료 건은 deletion request를 만들고 Storage 삭제 확인 후 DB 삭제한다. 실패는 pending/retry/complete/failed, 횟수, `next_attempt_at`, 안전한 오류 코드로 관리하고 backoff 1분·5분·30분·최대 6시간을 적용한다. 작업은 멱등이며 본문·사진 URL을 로그에 남기지 않는다. 앱 백업 및 AI 제공자 잔존 정책은 별도 고지·검증한다.

| 대상 | 초기 제한 | 초과 처리 |
|---|---:|---|
| JSON 본문 | 64 KiB | `413` |
| 답변/체크인 메모 | 4,000자 / 500자 | `400` |
| 이미지 | 5 MiB, JPEG/PNG/WebP | `413`/`415` |
| 목록 페이지 | 기본 20, 최대 50 | `400` |
| AI | timeout 15초, 사용자 동시 2개, 1회 재시도 | 이후 fallback |
| 인증 사용자 API | 60회/분/사용자 | `429`, `Retry-After` |
| 업로드 | 10회/시간/사용자 | `429` |
| AI 생성 | 20회/시간/사용자, 턴당 최대 2회 | 제한 시 fallback 또는 `429` |
| P2 초대 발급 | 5회/시간, 코드 15분·일회성 | `429` |

제한은 분산 배포에서 공유되는 저장소/플랫폼 기능으로 적용한다. 프로세스 메모리 카운터만 운영 제한 수단으로 사용하지 않는다. 실제 공급자 한도와 사용량 검토 후 조정한다.

## 10.5 CI·테스트·증거

CI는 lockfile 기반 설치, lint, typecheck, unit test, migration 검증, production build를 수행한다. **이 TRD는 `package.json`이 아직 확인되지 않았음을 전제로 하며, `lint`, `typecheck`, `test` 스크립트를 구현 단계에서 필수로 추가한다.** 따라서 CI에서는 `--if-present`를 쓰지 않는다. 스크립트가 없으면 CI가 실패해야 한다. Preview E2E는 별도 테스트 DB/가상 데이터만 사용하며 비밀값은 GitHub Actions secrets에만 둔다.

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

이 workflow는 저장소 스크립트·Node LTS 버전에 맞춰 실제 파일로 추가한다. Migration CI는 빈 DB에 전체 migration을 적용하고 RLS 테스트는 실제 authenticated JWT로 실행한다.

| 테스트 | 준비 | 기대 결과 |
|---|---|---|
| RLS 소유권 | A/B JWT, A의 세션 | A 접근 허용, B 조회 비노출·수정/삭제 거부 |
| 동의 가드 | 미동의 또는 철회 | 세션·업로드·AI 요청 거부, 데이터 미생성 |
| 상태·turn | 정상, 건너뜀, 4번째 답변, 완료 후 재요청 | 정상만 허용, 충돌은 `409`, 중복 row 없음 |
| 멱등성 | 같은 키/같은 본문, 같은 키/다른 본문 | 기존 결과 재응답 / `409` |
| AI 안전 | JSON 오류·누락·길이 초과·진단/관계 단정·timeout | 위험 출력 미노출, 1회 재시도 후 fallback |
| 업로드 | 허용 파일·MIME 위장·손상·과대·SVG | 정상만 허용, 나머지 거부 |
| 저장/삭제 | summary 실패, storage 삭제 실패 후 재시도 | 완료/삭제 허위 표시 없음, 재시도 후 수렴 |
| 보관 작업 | 만료/미만료, 실패 객체 | 만료 대상만 enqueue, 실패 추적, 로그에 PII 없음 |

CI 보고에는 run URL, commit SHA, 통과/실패 건수, 환경만 남긴다. 사진·대화·실사용자 식별정보는 artifact/log에 넣지 않는다. 실제 사용성 테스트 수치와 미실행 항목은 자동 테스트와 분리해 보고한다.

## 10.6 구현·검증 판정

이 TRD는 설계 단계의 적용 기준이며 특정 점수나 구현 완료를 보장하지 않는다. 제출 시 실제 증거로 뒷받침할 항목은 migration 적용 결과, A/B RLS positive/negative test, CI run URL 및 성공 SHA, Preview/Demo 배포 smoke test, 6명 이상 사용성 결과(가명 ID·집계 수치), 미검증 P1/P2와 잔여 위험이다. 실행하지 않은 항목은 완료가 아닌 “미검증”으로 표시한다.
