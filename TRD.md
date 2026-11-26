# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부 · **서비스명:** 정담이
- **기반 문서:** `PRD.md` · **범위:** 해커톤 웹 프로토타입 및 시연
- **목적:** 사용자 흐름을 구현 가능한 아키텍처, API, 데이터 모델, 보안 경계와 검증 기준으로 정의한다.
- **설계 원칙:** 최소 데이터 수집, 명시적 동의, 서버 측 권한 검증, 비공개 사진 저장, 비진단적 AI 사용

> 본 서비스는 의료기기나 임상 진단 시스템이 아니다. AI는 인지활동·일상 건강 변화에 관한 참고용 요약만 제공하며 질환, 인지기능, 위험도 또는 긴급도를 판정하지 않는다.

## 목차

- [0. PRD 정합성 및 범위](#s0)
- [1. 아키텍처와 배포](#s1)
- [2. 데이터 흐름과 상태 전이](#s2)
- [3. API 및 AI 계약](#s3)
- [4. 데이터 모델과 권한](#s4)
- [5. 저장소 구성](#s5)
- [6. 구현 단계](#s6)
- [7. 테스트와 PRD 완료 기준](#s7)
- [8. 개인정보·AI 안전 체크리스트](#s8)
- [9. 리스크 및 완료 판단](#s9)
- [10. 구현 상세 사양](#s10)

<a id="s0"></a>
## 0. PRD 정합성 및 범위

PRD는 Python·Streamlit·SQLite를 단일 환경의 빠른 시연 기술로 제안한다. 본 TRD는 브라우저 기반 프리뷰 배포, 인증 사용자 간 데이터 분리, 사진의 비공개 저장 및 관계형 기록 관리를 위해 **Next.js App Router + TypeScript, Vercel(배포 후보), Supabase(PostgreSQL/Auth/Storage)** 를 선택한다. 기술 선택 변경은 PRD의 사용자 가치와 완료 기준을 바꾸지 않는다. 요금·한도·지역·이용 조건은 배포 시점의 공식 안내를 확인한다.

| 우선순위 | 범위 | 완료 판단 |
|---|---|---|
| P0 | 동의, 예시/업로드 사진, 질문·답변 3턴, AI/fallback, 체크인, 요약 저장·재조회 | AI 장애에도 완주하고 새 조회에서 결과 확인 |
| P1 | 인증, 소유권 격리, private Storage, 삭제, 검증·오류 처리 | 비인가 접근 차단, 철회·삭제 결과 확인, 보안 테스트 통과 |
| P2 | 보호자 초대·승인·공유 동의·요약 전용 조회·철회 | 관계와 동의가 모두 유효할 때만 조회, 철회 즉시 차단 |

P2는 P0 시연 전에 필수로 요구하지 않는다. 공개 배포 또는 실제 사용자 데이터 처리 전에는 P1 안전장치를 생략하지 않는다. 사용성 목표(참가자 6명 이상, 5/6명 이상 성공, 완주 3분 이내, 평균 만족도 4.0/5 이상)는 실제 결과로 판정하며 문서만으로 달성을 주장하지 않는다.

<a id="s1"></a>
## 1. 아키텍처와 배포

### 1.1 구성 요소와 보안 경계

| 구성 요소 | 기술 | 책임 및 권한 |
|---|---|---|
| 웹 UI/API | Next.js App Router, TypeScript | 인증 세션 확인, 입력·동의 검증, 권한 있는 RPC 호출, AI 오케스트레이션 |
| 배포 | Vercel 후보 | HTTPS, PR Preview, 환경별 변수 분리 |
| 인증/DB | Supabase Auth/PostgreSQL | 사용자 인증, 데이터 저장, RLS, 제한된 RPC |
| 사진 | Supabase private Storage | 인증 사용자별 객체 저장·읽기, 삭제 worker 정리 |
| AI | Gemini API 서버 전용 provider | 사진 기반 질문, 답변 기반 후속 질문, 세션 요약 |

```text
[브라우저] --HTTPS--> [Next.js UI/API: 인증·동의·검증]
                           ├─ 사용자 JWT로 제한된 DB RPC
                           ├─ 사용자 JWT로 Storage 업로드
                           ├─ 서버 전용 AI provider
                           └─ 비공개 deletion worker(별도 실행 주체)
```

브라우저에는 anon key만 둘 수 있으며 RLS가 항상 적용되어야 한다. AI 키와 `service_role` 키는 서버 비밀값이다. 일반 사용자 API는 `service_role`을 사용하지 않는다. 사용자 데이터 쓰기는 RLS만 믿고 직접 테이블에 허용하지 않고, 소유자·동의·상태·turn을 검증하는 제한된 RPC를 통해 수행한다(§4, §10.3). 삭제 worker만 큐 처리를 위해 격리된 권한을 가진다.

### 1.2 로컬·Preview·Demo 배포 순서

| 환경 | 자원 | 검증 기준 |
|---|---|---|
| Local | `.env.local`, 개발 Supabase, 가상 계정·샘플 | install, lint, typecheck, unit/integration, build |
| Preview | PR별 테스트 Supabase·테스트 AI 키 | 운영 DB/데이터 금지, 핵심 E2E 통과 |
| Demo/Production | 별도 Supabase, 제한 계정, 허가 이미지, 플랫폼 secrets | RLS·삭제·동의 철회·fallback 확인 후 배포 smoke test |

순서: Node/package manager와 lockfile 고정 → 비밀값 제외 확인 → 개발 DB migration/RLS 적용 → 사용자 A/B 권한 테스트 → lint/typecheck/unit/integration/build → Preview E2E → Demo 승인 → 시연 후 데이터 정리 및 임시 자격 증명 폐기. OAuth redirect와 환경 변수를 환경별로 분리한다. Vercel 사용 불가 시 HTTPS, Next.js App Router/API, 서버 환경변수, 로그 및 Preview/Production 분리를 지원하는 Node 호스팅으로 이전한다. Supabase 대체 시 PostgreSQL·인증·private storage·JWT 권한·삭제 재시도 및 통합 테스트를 재구현하기 전 민감 데이터 시연을 중단한다. AI 장애 시 provider adapter의 고정 질문·로컬 요약을 사용한다.

### 1.3 역할 및 데모

- 어르신은 본인 데이터만 생성·조회·삭제한다.
- P2 보호자는 승인된 활성 연결과 현재 공유 동의가 모두 유효할 때 요약 projection만 읽는다. 원본 사진·메시지 접근은 금지한다.
- `profiles.role`은 사용자 프로필 편집 대상이 아니다. 가입 시 신뢰된 DB trigger가 기본 `senior`를 설정한다. role 변경은 별도 관리자 provisioning만 가능하며 사용자 JWT의 UPDATE로 변경할 수 없다.
- 해커톤 데모 계정도 정상 인증·동의·권한 검증을 거치며 우회 모드는 제공하지 않는다. 참여자별 계정을 우선하고, 공용 계정은 개인 정보 없이 초기화 가능한 가상 데이터만 사용한다.

<a id="s2"></a>
## 2. 데이터 흐름과 상태 전이

### 2.1 동의 유효성

동의 이벤트는 append-only로 기록한다. 각 행은 `user_id`, `consent_type`, `granted`, `document_version`, 서버 생성 `created_at`을 가진다. 현재 상태는 해당 사용자·동의 종류의 최신 이벤트(정렬: `created_at DESC, id DESC`)로 결정한다. 최신 이벤트가 `granted=true`일 때만 활성이다. 클라이언트는 timestamp나 user_id를 지정할 수 없으며 RPC가 `auth.uid()`를 사용한다. 동의 취소는 기존 행 수정/삭제가 아니라 `granted=false` 이벤트 추가다. 저장 동의 또는 AI 처리 동의가 비활성일 때 세션 시작·사진 등록·AI 호출을 거부한다.

### 2.2 사진 등록 경계

1. `POST /sessions`는 동의를 검사한 뒤 `created` 상태 세션을 만든다. 이 단계에서는 대화 진행이 불가하다.
2. 업로드 사진은 임시 객체 키를 서버가 발급하고, 사용자 JWT로 Storage에 업로드한다. JPEG/PNG/WebP만 허용하며 extension/MIME/signature/실제 decode를 확인하고 최대 5 MiB, 무작위 객체명을 적용한다. SVG 및 실행 형식은 거부한다.
3. 업로드 성공 후 `attach_photo` RPC가 세션 소유권·`created` 상태·동의·객체 경로 prefix를 재검증하고 세션에 사진을 연결한다. RPC 실패 시 임시 객체를 즉시 삭제 시도하고, 실패는 정리 큐에 넣는다. 사진 연결 전 AI 호출과 turn 진행을 허용하지 않는다.
4. 예시 사진도 클라이언트가 임의 경로를 넘기지 않는다. 서버 allowlist의 `sample_id`를 승인 이미지로 resolve한 뒤 세션과 연결한다.
5. 사진 연결 성공 후 `POST /start`가 첫 질문을 생성·저장하고 `in_progress`로 전이한다(§3.1). `start` 요청이 재시도되면 기존 질문을 반환한다.

### 2.3 통일된 대화 완료 순서

**유일한 상태 집합:** `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`. DB CHECK, API, 타입, 테스트 모두 이 값을 사용한다.

| 현재 | 이벤트/조건 | 다음 | 처리 및 API 경계 |
|---|---|---|---|
| 없음 | 세션 생성, 동의 활성 | `created` | `POST /sessions`가 행만 생성. 사진 없음 |
| `created` | 사진 attach 성공 | `created` | `POST /sessions/{id}/photo`; 사진 연결만, AI 미호출 |
| `created` | `POST /start`, 사진 및 동의 유효 | `in_progress` | 첫 assistant 질문을 저장하고 상태 전이를 원자적으로 commit |
| `in_progress` | turn 1~2의 예상 답변 저장 | `in_progress` | `/turns`가 답변을 먼저 commit, 다음 질문은 외부 AI 호출 후 검증·저장 |
| `in_progress` | turn 3 답변 저장 성공 | `awaiting_summary` | `/turns`는 `next_question:null` 반환. 요약 작업은 아직 완료로 간주하지 않음 |
| `awaiting_summary` | `/complete`의 검증된 AI/fallback 요약 저장 | `completed` | summary 1개·완료 시각·상태를 원자적으로 commit |
| 진행 상태 | 복구 불가 오류/사용자 취소 | `failed` | 민감 본문 로그 금지. 재시도 가능한 오류는 현 상태 유지 |
| `completed` | 중복 complete | `completed` | 동일 멱등성 키는 기존 결과 반환 |
| `completed` | 추가 turn | `completed` | `409` |

`/turns`가 AI 다음 질문을 요청하다 실패해도 이미 저장된 사용자 답변은 유지한다. `next_question`이 없으면 재시도용 `POST /next-question`이 해당 turn의 assistant 질문을 멱등하게 생성한다. 세 번째 답변 뒤에는 `next-question`을 호출하지 않고 `/complete`를 요청한다. AI는 DB transaction 밖에서 호출한다: 상태/작업 commit → AI 요청 → 응답 검증 → 조건부 결과 저장. 완료는 사용자 답변 3개와 summary가 함께 존재할 때만 가능하다.

### 2.4 멱등성 및 오류 복구

멱등성 키는 `(user_id, route, key_hash)` 유일 레코드로 관리하고 `request_hash`, `state(in_progress/completed)`, 응답 결과, 생성/만료 시각을 저장한다. 동일 키·동일 hash는 저장된 결과를 반환한다. 동일 키·다른 hash는 `409`다. 중복 요청이 처리 중이면 `202`와 동일 operation ID를 반환하고 클라이언트는 상태 확인 API를 사용한다. 키는 최소 24바이트 무작위 값이며 저장기간은 24시간이다.

Storage와 DB는 분산 트랜잭션이 아니다. 삭제는 `deletion_requests` 상태를 기록하고 객체 삭제 확인 후 세션 데이터를 지운다. 재실행은 멱등이며 완료 전 성공 응답을 하지 않는다. AI timeout은 15초, 최초 호출 실패 후 최대 1회 재시도하고 fallback으로 전환한다.

<a id="s3"></a>
## 3. API 및 AI 계약

모든 API의 기준 경로는 `/api/v1`이다. 서버는 인증·동의·소유권·상태를 매 요청 검증한다. 요청 JSON은 Zod로 검증하고 응답은 명시한 구조만 반환한다. 사진 요청은 multipart/form-data다. 타 사용자 리소스는 `404` 또는 일관된 권한 오류로 숨긴다.

### 3.1 API 요청·응답 계약

| Method/path | 요청(JSON 핵심) | 정상 응답(JSON 핵심) | 권한/오류 |
|---|---|---|---|
| `GET /api/v1/me` | 없음 | `{user:{id,role}}` | 인증, `401` |
| `POST /api/v1/consents` | `{consent_type,granted,document_version}` | `{consent:{id,active,created_at}}` | 본인, type allowlist, `400/401` |
| `POST /api/v1/sessions` | `{photo_source,sample_id?}` | `{session_id,status:"created"}` | 활성 저장·AI 동의, sample allowlist, `400/403` |
| `POST /api/v1/sessions/{id}/photo` | multipart `file` | `{session_id,status:"created",photo_attached:true}` | owner, created, 동의, file 검사, `400/403/413/415` |
| `POST /api/v1/sessions/{id}/start` | `{idempotency_key}` | `{session_id,status:"in_progress",first_question:string}` | owner, 사진 연결, 동의, `403/409/5xx` |
| `POST /api/v1/sessions/{id}/turns` | `{answer,turn_number:1|2|3,idempotency_key}` | `{saved_turn,next_question:string|null,status}` | owner, in_progress, 기대 turn, `400/403/409/429/5xx` |
| `POST /api/v1/sessions/{id}/next-question` | `{turn_number:2|3,idempotency_key}` | `{question,status:"in_progress"}` | 해당 답변 저장, assistant 질문 미생성, `403/409/5xx` |
| `POST /api/v1/sessions/{id}/complete` | `{idempotency_key}` | `{summary:{recall_keywords,activity_summary,health_mention_note,summary_source},status:"completed",completed_at}` | 답변 3개, awaiting_summary, `403/409/5xx` |
| `PATCH /api/v1/sessions/{id}/checkin` | `{medication_status,condition_status,condition_note?}` | `{checkin:{medication_status,condition_status,condition_note,updated_at}}` | owner, enum/길이, 사용자 입력, `400/403` |
| `GET /api/v1/sessions?cursor=&limit=` | 없음 | `{items:[...],next_cursor:string|null}` | 본인, limit 1..50, `400/401` |
| `GET /api/v1/sessions/{id}` | 없음 | `{session,messages,summary,checkin}` | 본인 또는 P2 요약 projection, `403/404` |
| `DELETE /api/v1/sessions/{id}` | `{idempotency_key}` | `{request_id,status:"pending"}` | 본인, `403/404/409` |
| `GET /api/v1/operations/{id}` | 없음 | `{operation_id,status,result?}` | 요청자 소유 operation, `401/404` |
| P2 caregiver endpoints | 초대/승인 요청은 §1.3·§4.3 기준 | `{items:[summary projection],next_cursor}` 등 | 연결+동의 모두 확인, `401/403/404/410/429` |

모든 JSON 객체는 알 수 없는 필드를 거부한다. 문자열 길이, enum, content type 및 body size 제한은 §10.4 기준이다. 오류 응답은 `{error:{code,message,retryable,request_id}}`이며 내부 경로나 비밀값은 포함하지 않는다. 상태 코드는 `400` 입력 오류, `401` 미인증, `403` 권한/동의 거부, `404` 비공개/미존재, `409` 상태·멱등 충돌, `413` 크기 초과, `415` 미지원 형식, `429` 제한 초과, `5xx` 일시 장애다.

### 3.2 AI 공급자 요청 및 응답

AI에는 실명·연락처·계정 자격 증명·보호자 정보·타 사용자 기록을 보내지 않는다. 이미지 요청은 Gemini provider adapter에서 공급자 SDK의 `contents[].parts[]` 구조로 만든다. 아래는 wire 요청의 핵심 형태이며, `data`는 승인된 이미지 바이너리의 Base64, `mime_type`은 검사된 MIME 값이다. 파일 URL이나 Storage 경로를 보내지 않는다. 모델명은 `AI_MODEL` 설정으로 고정하고 배포 시 지원 모델·요금·보관 정책을 확인한다.

**첫 질문 Gemini 요청 예시**
```json
{
  "contents": [{
    "role": "user",
    "parts": [
      {"text": "보이는 내용만 참고해 열린 질문 하나를 작성한다. 인물·관계·날짜·장소를 추측하지 않는다. JSON {question:string}만 반환한다."},
      {"inline_data": {"mime_type": "image/jpeg", "data": "<base64-image-bytes>"}}
    ]
  },
  "generationConfig": {"responseMimeType": "application/json"}
}
```
**정규화된 첫 질문 출력:** `{"question":"이 사진을 보시니 어떤 기억이 떠오르시나요?"}`

**후속 질문 입력/출력**
```json
{"turn_number":2,"current_answer":"가족과 바닷가에 갔어요.","recent_context":[{"role":"assistant","content":"이 사진을 보시니 어떤 기억이 떠오르시나요?"},{"role":"user","content":"가족과 바닷가에 갔어요."}]}
{"question":"그날 기억나는 장면이나 느낌이 있으신가요?"}
```
후속 호출은 현재 답변과 최근 최대 4개 메시지(메시지당 1,000자 이하)만 포함한다. turn은 2~3이며 세 번째 답변 후에는 호출하지 않는다.

**요약 입력/출력**
```json
{"messages":[{"turn_number":1,"content":"가족과 바닷가에 갔어요."},{"turn_number":2,"content":"파도 소리가 기억나요."},{"turn_number":3,"content":"즐거웠어요."}]}
{"recall_keywords":["가족","바닷가"],"activity_summary":"사용자는 가족과 바닷가에 갔던 기억과 파도 소리에 대한 느낌을 이야기했습니다.","health_mention_note":null}
```
`question`: 1~240자. `recall_keywords`: 0~5개, 항목당 1~40자. `activity_summary`: 1~600자. `health_mention_note`: null 또는 실제 발화의 중립 요약 1~240자. 공백·누락·초과 길이·진단/위험/관계 단정은 거부하고 재시도 1회 후 fallback한다. 체크인 데이터는 AI가 만들거나 덮어쓰지 않는다. Fallback 건강 메모는 항상 null이다.

<a id="s4"></a>
## 4. 데이터 모델과 권한

### 4.1 핵심 스키마

| 테이블 | 핵심 필드·제약 |
|---|---|
| `profiles` | `id UUID PK/FK auth.users`, `role TEXT CHECK senior/caregiver`, `created_at`; role은 사용자 수정 불가 |
| `consent_records` | `id UUID PK`, `user_id UUID`, `consent_type enum`, `granted BOOLEAN`, `document_version`, `created_at`; append-only |
| `sessions` | `id UUID PK`, `user_id UUID FK`, `photo_source enum`, `photo_path NULL`, `started_at`, `completed_at NULL`, `status CHECK created/in_progress/awaiting_summary/completed/failed` |
| `messages` | `session_id FK`, `turn_number 1..3`, `role assistant/user`, `content`, `created_at`; `(session_id,turn_number,role) UNIQUE` |
| `checkins` | `session_id UUID PK/FK`, medication `taken/not_taken/not_recorded`, condition `good/okay/unwell/not_recorded`, `condition_note NULL, <=500 chars`; 직접 입력 |
| `summaries` | `session_id UUID UNIQUE FK`, participation 0..3, keywords, activity summary, health note NULL, source `ai/fallback` |
| `idempotency_keys` | `user_id`, `route`, `key_hash`, `request_hash`, `state`, `response_json`, `created_at`, `expires_at`; `(user_id,route,key_hash) UNIQUE` |
| `caregiver_links` (P2) | `id UUID PK`, `senior_user_id UUID FK`, `caregiver_user_id UUID FK NULL`, `invite_code_hash TEXT UNIQUE NULL`, `invite_expires_at TIMESTAMPTZ NULL`, `status CHECK pending/active/revoked/expired`, `approved_at/revoked_at/created_at TIMESTAMPTZ`; 코드 원문 미저장 |
| `deletion_requests` | `id UUID PK`, session/resource 식별자, `status pending/retry/complete/failed`, `attempts`, `next_attempt_at`, `last_error_code`, timestamps; URL/본문 미저장 |

`sessions.status`의 허용값은 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`다. 동의 최신 이벤트는 `(created_at DESC,id DESC)`로 판정하며 최신 `granted=true`만 활성이다. 세션 인덱스는 `(user_id,started_at DESC)`, 메시지는 `(session_id,turn_number,created_at)`, caregiver는 `(caregiver_user_id,status)`, 삭제 큐는 `(status,next_attempt_at)`로 둔다. 세션 삭제 시 메시지·요약·체크인은 cascade한다. `deletion_requests.session_id`는 이력 보존을 위해 FK를 두지 않는다.

### 4.2 caregiver 링크 제약 (P2)

한 caregiver와 senior 쌍에는 동시에 하나의 pending/active 링크만 허용한다. 초대 코드는 CSPRNG 생성 원문을 반환 직후 폐기하고 DB에는 keyed hash만 보관한다. `invite_expires_at`은 15분 이내, 1회 사용이다. `caregiver_user_id`는 수락 시 인증된 caregiver UUID로 설정한다. 승인 시 `approved_at`을 기록하고 활성 공유 동의를 재확인한다. 철회는 `status='revoked'`, `revoked_at` 기록과 함께 즉시 projection 조회를 차단한다. 본문·사진 접근 grant는 만들지 않는다.

### 4.3 동의·소유권 판정

현재 동의는 `(user_id,consent_type)`별 최신 append-only 이벤트로 판정한다. 동의 조회/변경은 서버에서 `auth.uid()`를 사용하며 클라이언트 제공 사용자 ID·시각을 신뢰하지 않는다. 세션 `user_id`는 생성 시 `auth.uid()`로 설정되고 변경할 수 없다. child table은 상위 session 소유권을 검사한다. role은 가입 trigger에서 기본 `senior`; 일반 사용자는 `profiles` DML 권한이 없다.

### 4.4 RLS와 쓰기 경계

RLS는 모든 사용자 테이블에 활성화한다. 일반 사용자에게 허용하는 직접 테이블 권한은 본인 행 SELECT뿐이다. 세션·메시지·체크인·요약·동의·멱등성 키의 INSERT/UPDATE/DELETE는 revoke하고 §10.3의 제한된 RPC만 수행한다. RPC는 `auth.uid()`로 사용자 신원을 결정하고 입력 user_id를 받지 않으며 상태·동의·소유권·turn을 transaction 내부에서 재검증한다.

`SECURITY DEFINER` RPC는 고정 `search_path`, 명시적 권한 검사, 최소 `EXECUTE` grant, 동적 SQL 금지를 요구한다. `profiles.role` 변경 RPC는 일반 사용자에게 제공하지 않는다. P2 caregiver 조회는 별도 projection RPC에서 활성 링크·활성 공유 동의·caregiver ID를 재검사한다. Storage는 private, object key는 `{auth.uid()}/{session_id}/{random_uuid}` prefix이며 사용자는 본인 prefix만 업로드·조회·삭제한다.

<a id="s5"></a>
## 5. 저장소 구성

```text
app/(auth)/login/page.tsx
app/(senior)/page.tsx, photo/page.tsx, session/[id]/page.tsx
app/(senior)/session/[id]/checkin/page.tsx, summary/[id]/page.tsx
app/(senior)/settings/records/page.tsx
app/(caregiver)/summaries/page.tsx       # P2
app/api/v1/.../route.ts
lib/{auth,consent,permissions,conversation,storage,validation,summaries,prompts}.ts
lib/ai/{base,provider,fallback}.ts
supabase/migrations/, tests/{unit,integration,e2e}/
public/sample-photos/  # 허가된 예시만; .env.example; README.md
```

모듈 책임: `conversation.ts` 상태·turn·멱등성, `ai/*` provider/timeout/retry/schema/fallback, `storage.ts` signature/decode/size/private upload-delete, `permissions.ts` 소유권·동의 검증. UI에서 AI를 직접 호출하지 않는다.

`.env.example`에는 변수 이름만 둔다: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AI_PROVIDER`, `AI_MODEL`, `GEMINI_API_KEY`, `MAX_IMAGE_SIZE_MB=5`, `DATA_RETENTION_DAYS=90`. `SUPABASE_SERVICE_ROLE_KEY`는 일반 앱 요청에 설정하지 않는다. 비밀값에 `NEXT_PUBLIC_` 접두사를 쓰거나 Git에 커밋하지 않는다.

<a id="s6"></a>
## 6. 구현 단계

1. **P0:** 접근성 홈·인증·동의, 사진 등록·검증, 3턴 저장, AI 스키마/fallback, 체크인, 요약 재조회.
2. **P1:** 소유자 RLS, 동의 철회, 삭제·부분 실패 재시도, 90일 보관 작업, 오류·네트워크 테스트.
3. **P2:** 인증 초대, 어르신 승인, 공유 동의, 요약 projection, 즉시 철회 및 권한 E2E.

<a id="s7"></a>
## 7. 테스트 및 PRD 완료 기준

| 검증 항목 | 테스트 | 합격 기준 |
|---|---|---|
| 상태 전이 | 각 전이, 미등록 사진, 미동의, turn skip/duplicate, 4번째 답변, complete 재요청 | 허용 전이만 성공, 위반은 거부/`409`, 중복 row 없음 |
| 통합 대화 순서 | start → turn 1 → next question → turn 2 → next question → turn 3 → complete | API 응답 상태/DB 상태 순서가 §2.3과 일치 |
| 동의 유효성 | grant→revoke→regrant, 동시 이벤트 | 최신 이벤트만 반영, 철회 후 쓰기·AI 차단 |
| JWT 권한 | 사용자 A/B의 SELECT·RPC | 본인만 읽기, 타인 접근·role 변경·직접 DML 거부 |
| 사진 경계 | 정상/위장/손상/과대/SVG, attach 실패 | 유효 파일만 연결, 실패 정리 큐 등록, attach 전 AI 미호출 |
| 멱등성 | 동일/다른 hash 및 동시 요청 | 기존 응답 재사용, hash 충돌 `409`, 중복 저장 없음 |
| AI 안전 | 누락/오류/과대/진단 단정/timeout | 위험 출력 미노출, 1회 재시도 뒤 fallback 완주 |
| 삭제·보관 | Storage 실패 재시도, 만료/미만료, worker 경계 | 완료 전 성공 금지, 만료만 enqueue, 일반 JWT 큐 접근 거부 |
| 사용성 | 익명 ID 6명 이상 | 5/6 이상 성공, 3분·4.0/5 목표 실측 보고 |

단위 테스트는 상태 전이·동의·멱등성·schema·fallback, 통합 테스트는 실제 JWT RLS·RPC·Storage·삭제, E2E는 위 통합 대화 순서와 핵심 사용자 여정을 검증한다. 미실행 목표는 “미검증”으로 표시하고 사진·대화 전문은 로그/artifact에 남기지 않는다.

<a id="s8"></a>
## 8. 개인정보·AI 안전 체크리스트

- [ ] 목적·전송 데이터·보관/삭제를 쉬운 말로 안내하고 미동의 시 차단
- [ ] AI 제공자 데이터 정책·배포 한도 확인, 불명확하면 민감 데이터 전송 금지
- [ ] 가상 사용자·허가 이미지 사용
- [ ] 비단정 prompt·안전 출력 테스트, 진단/위험/치료 권고 차단
- [ ] 전문기관 고정 안내, 의료·응급 판정 금지
- [ ] 동의 철회·삭제 UI와 재시도 결과 확인
- [ ] 실제 JWT로 RLS/RPC positive·negative tests
- [ ] role 변경과 일반 직접 쓰기 차단 검증
- [ ] 서버 환경변수에만 키 보관, PII·사진·토큰 로그 금지
- [ ] private Storage와 업로드 signature/크기 검사 확인

<a id="s9"></a>
## 9. 리스크 및 완료 판단

| 리스크 | 대응 |
|---|---|
| 무료 플랜 정책·한도 | 배포 전 공식 문서 확인, 시연 데이터 제한, 대체 구성 준비 |
| Preview/운영 데이터 혼용 | 환경별 DB·키·redirect 분리, Preview에 운영 데이터 금지 |
| AI 부정확·유도 | 최소 문맥, schema·안전 검증, fallback |
| 권한 우회 | role 불변, 민감 쓰기 RPC only, 실제 JWT negative test |
| Storage/DB 부분 삭제 | deletion queue, 재시도·상태 추적, 성공 허위 표시 금지 |
| 일정 초과 | P0 우선, P2 후속 |

완료는 동의 후 사진 선택, 질문·답변 3턴, 직접 체크인, 요약 저장·재조회를 수행하고 AI 장애에도 fallback으로 핵심 흐름이 끝날 때 판단한다. PRD 수치는 실제 테스트로 판정한다. TRD만으로 코드·CI·배포·테스트 성공을 주장하지 않는다.

---

<a id="s10"></a>
# 10. 실행 기준: migration, 보관, 제한, CI

## 10.1 세션 생성·사진 등록·대화 완료 시퀀스

**정상 P0 순서:**

```text
동의 grant
  → POST /sessions                 [created, DB commit]
  → upload photo                   [Storage object, DB 미변경]
  → POST /sessions/{id}/photo      [attach_photo RPC, created 유지]
  → POST /sessions/{id}/start     [첫 질문 저장, in_progress commit]
  → POST /turns turn=1             [답변 commit]
  → AI 호출/검증 → POST /next-question [assistant 질문 저장]
  → POST /turns turn=2             [답변 commit]
  → AI 호출/검증 → POST /next-question [assistant 질문 저장]
  → POST /turns turn=3             [답변 commit, awaiting_summary]
  → POST /complete                 [AI 요약 또는 fallback, summary+completed atomically]
  → PATCH /checkin                 [직접 입력 저장]
  → GET /sessions/{id}             [DB 재조회]
```

`/turns`는 사용자 답변 commit까지만 보장하고, 비동기 AI 질문 생성 성공을 답변 저장 성공의 조건으로 삼지 않는다. `/next-question` 실패 시 세션은 `in_progress`를 유지하고 동일 작업을 재시도한다. turn 3은 `next_question:null`을 반환하고 상태를 `awaiting_summary`로 바꾼다. `/complete`는 `awaiting_summary`에서만 수행한다. AI 호출은 transaction 밖이며 summary insert와 completed 상태/시각은 transaction 한 번으로 commit한다. summary 저장 실패 시 `awaiting_summary`에 남아 `/complete` 재시도가 가능하다. 체크인은 대화 완료와 별도 저장이며 저장 전 성공 요약을 표시하지 않는다.

## 10.2 RPC 계약 및 멱등성

민감 mutation은 직접 table DML이 아니라 RPC로만 수행한다.

- `record_consent(type,granted,version)`: `auth.uid()`, type/version 검사, append-only event.
- `start_session(photo_source,sample_id)`: 최신 동의 확인, allowlist 확인, `created` 행 생성.
- `attach_photo(session_id,object_key)`: owner·상태·동의·key prefix 검증 후 photo path 연결.
- `start_conversation(session_id,key)`: photo attached 및 동의 재검증, 첫 질문 저장과 `in_progress` 전이.
- `save_answer(session_id,turn,answer,key)`: row lock, 기대 turn·길이·동의 검증, user message insert; turn 3이면 `awaiting_summary` 전이.
- `save_assistant_question(session_id,turn,question,job_id)`: owner·상태·기대 turn 재검증, assistant 메시지 중복 방지.
- `complete_session(session_id,summary,key)`: 답변 3개·`awaiting_summary` 확인, summary 1개 및 completed timestamp를 원자적으로 기록.
- `save_checkin(...)`: owner·enum·길이 검사 후 직접 입력 저장.
- `request_session_deletion(session_id,key)`: 소유권 확인 후 큐 등록. 일반 사용자는 큐를 읽거나 쓰지 않는다.

각 RPC는 `SECURITY DEFINER` 사용 시 고정 `search_path`(예: `pg_catalog, public`), 명시적 `auth.uid()` 검사, 최소 `EXECUTE` grant, 동적 SQL 금지를 요구한다. 함수 소유자는 필요한 최소 권한만 가진다. 직접 DML 권한은 없으며 RPC 내부는 상태·동의·소유권을 재검증한다. 함수별 integration test에서 A/B JWT를 사용한다.

## 10.3 PostgreSQL 핵심 schema/RLS 기준 SQL

아래 SQL은 신규 테스트 DB의 기준이다. 기존 DB에 무검토 적용하지 말고 순차 migration으로 조정한다. RPC 함수 본문은 위 계약으로 별도 migration에 구현하고 `test:db`에서 실제 실행한다.

```sql
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'senior' check (role in ('senior','caregiver')),
  created_at timestamptz not null default now()
);
-- 가입 trigger는 role='senior'로만 생성한다. 사용자 profile DML은 grant하지 않는다.
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('data_storage','ai_processing','caregiver_sharing')),
  granted boolean not null,
  document_version text not null,
  created_at timestamptz not null default now()
);
create index consent_latest_idx on public.consent_records(user_id,consent_type,created_at desc,id desc);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'created' check (status in ('created','in_progress','awaiting_summary','completed','failed')),
  photo_source text not null check (photo_source in ('sample','upload')),
  photo_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create index sessions_owner_started_idx on public.sessions(user_id,started_at desc);

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
  medication_status text not null check (medication_status in ('taken','not_taken','not_recorded')),
  condition_status text not null check (condition_status in ('good','okay','unwell','not_recorded')),
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
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  key_hash text not null,
  request_hash text not null,
  state text not null check (state in ('in_progress','completed')),
  response_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(user_id,route,key_hash)
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
create index deletion_due_idx on public.deletion_requests(status,next_attempt_at);

alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.checkins enable row level security;
alter table public.summaries enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.deletion_requests enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy consent_select_own on public.consent_records for select to authenticated using (user_id=(select auth.uid()));
create policy sessions_select_own on public.sessions for select to authenticated using (user_id=(select auth.uid()));
create policy messages_select_owner on public.messages for select to authenticated using
  (exists(select 1 from public.sessions s where s.id=messages.session_id and s.user_id=(select auth.uid())));
create policy checkins_select_owner on public.checkins for select to authenticated using
  (exists(select 1 from public.sessions s where s.id=checkins.session_id and s.user_id=(select auth.uid())));
create policy summaries_select_owner on public.summaries for select to authenticated using
  (exists(select 1 from public.sessions s where s.id=summaries.session_id and s.user_id=(select auth.uid())));

revoke all on public.profiles,public.consent_records,public.sessions,public.messages,
  public.checkins,public.summaries,public.idempotency_keys,public.deletion_requests
  from anon,authenticated;
grant select on public.profiles,public.consent_records,public.sessions,public.messages,
  public.checkins,public.summaries to authenticated;
-- idempotency/deletion 큐에는 일반 사용자의 어떤 table 권한도 부여하지 않는다.
```

정책은 직접 SELECT 권한과 RLS를 함께 적용한다. `profiles`에는 UPDATE 정책/grant/RPC가 없어 사용자가 role을 바꿀 수 없다. 모든 mutation은 검증된 RPC로만 한다. `deletion_requests`는 일반 사용자 policy/grant가 없다. 삭제 worker는 사용자 요청 API와 분리된 비공개 작업 주체다. Supabase `service_role` 사용 시 RLS 우회 고권한 키임을 전제로 worker secret에만 보관하고 큐 처리로 작업을 제한한다. 브라우저·일반 API에 전달하지 않는다. 가능하면 최소 권한 DB 역할/함수를 사용한다. `deletion_requests.session_id`는 세션 정리 뒤에도 삭제 이력을 보존하기 위해 FK를 두지 않는다. Storage RLS와 P2 caregiver 정책은 별도 migration 및 negative test 전에는 활성화하지 않는다.

### 10.4 보관 자동화 및 API 제한

완료 후 90일을 보관 기본값으로 제안한다. 정기 작업은 매일 03:00 UTC, 최대 100건 batch로 실행한다. 만료 건은 deletion request 생성 → Storage 객체 삭제 확인 → DB 행 삭제 순서다. 실패는 상태·시도 횟수·`next_attempt_at`·안전한 오류 코드만 보존하고 backoff 1분·5분·30분·최대 6시간을 적용한다. 재실행은 멱등이며 사진 URL·대화 본문은 로그에 남기지 않는다. 백업·AI 제공자 잔존 정책은 별도 고지·검증한다.

| 대상 | 초기 제한 | 초과 처리 |
|---|---:|---|
| JSON 본문 | 64 KiB | `413` |
| 답변/체크인 메모 | 4,000/500자 | `400` |
| 이미지 | 5 MiB JPEG/PNG/WebP | `413/415` |
| 목록 페이지 | 기본 20, 최대 50 | `400` |
| AI | timeout 15초, 동시 2개/사용자, 재시도 1회 | 이후 fallback |
| 인증 사용자 API | 60회/분/사용자 | `429`, `Retry-After` |
| 업로드 | 10회/시간/사용자 | `429` |
| AI 생성 | 20회/시간/사용자, turn당 최대 2회 | 제한 시 fallback 또는 `429` |
| P2 초대 | 5회/시간, 코드 15분·일회성 | `429` |

제한은 분산 배포에서 공유 저장소/플랫폼 기능으로 적용한다. 프로세스 메모리 카운터만 운영 제한 수단으로 사용하지 않는다. 실제 공급자 한도 검토 후 조정한다.

### 10.5 CI·테스트 및 제출 증거

`package.json`이 미확인 상태라는 전제에서 `lint`, `typecheck`, `test`, `test:db`를 구현 단계에서 필수 추가한다. CI는 `--if-present`를 쓰지 않으며 스크립트가 없으면 실패해야 한다. Migration 검증은 빈 DB에 전체 migration을 적용하고 실제 authenticated JWT A/B로 RLS/RPC 테스트를 수행한다. Preview E2E는 별도 테스트 DB·가상 데이터만 사용하며 secrets는 GitHub Actions secrets에만 둔다.

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
      - run: npm run test:db
      - run: npm run build
```

CI 검증표: A/B JWT 본인 SELECT만 허용 및 직접 DML 거부, role 변경 거부, grant→revoke 후 쓰기/AI 차단, 사진 attach 전 AI 미호출, 전체 상태·turn 전이, 멱등성 동일/상이 hash, Gemini JSON/안전 실패 fallback, Storage 및 DB 삭제 재시도, 일반 JWT deletion queue 거부·worker 허용, 만료/미만료 보관 대상을 자동 테스트한다. CI 보고에는 run URL, commit SHA, 통과/실패 건수, 환경만 남기며 사진·대화 전문·실사용자 식별정보는 artifact/log에 넣지 않는다.

### 10.6 구현·검증 판정

이 문서는 설계 기준이며 점수나 구현 완료를 보장하지 않는다. 실제 제출 증거로 migration 적용 결과, A/B RLS·RPC 테스트, role 변경 거부 테스트, deletion worker 권한 테스트, CI run URL 및 성공 SHA, Preview/Demo smoke test, 사용성 결과(가명 ID·집계 수치), 미검증 P1/P2 및 잔여 위험을 제시한다. 실행하지 않은 항목은 “미검증”으로 표시한다.
