# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부
- **서비스명:** 정담이
- **문서 목적:** 제품 요구사항을 구현 가능한 아키텍처, 데이터 모델, 화면·API 계약, 보안 정책 및 구현 계획으로 구체화한다.
- **대상 범위:** 해커톤 MVP 웹 서비스와 시연
- **기술 제약:** 고정된 스택 없음. 빠른 개발, 무료로 시작 가능한 호스팅·DB, 민감한 사진·대화의 안전한 처리 우선
- **설계 원칙:** 요구사항 추적, 고령층 접근성, 명시적 동의, 최소 데이터 수집, 사용자 설명을 우선하는 비진단적 AI

> 본 서비스는 회상 활동과 일상 기록을 돕는 프로토타입이며 의료기기나 임상 진단 시스템이 아니다. AI는 질환 진단, 인지 점수화, 위험도 판단 또는 치료 권고를 제공하지 않는다.

## 1. 시스템 아키텍처

### 1.1 권장 기술 스택

| 영역 | 권장 기술 | 선택 이유 |
|---|---|---|
| 웹 프론트엔드·서버 | Next.js App Router + TypeScript | 화면과 서버 API를 한 프로젝트에서 빠르게 구현하고 API 타입을 명확히 한다. |
| 웹 호스팅 | Vercel Hobby | GitHub 연동과 프리뷰 배포가 간편해 해커톤 MVP에 적합하다. 무료 한도·실행 제한은 배포 시 확인한다. |
| DB·인증·파일 | Supabase Free (PostgreSQL, Auth, private Storage) | 관계형 데이터, 인증, 사진 저장을 한 곳에서 제공하고 PostgreSQL RLS로 권한을 강제한다. |
| 생성형 AI | 팀이 선택한 멀티모달 모델 API (예: Gemini) | 사진 기반 질문·후속 질문·요약을 생성한다. 공급자 호출은 서버에서만 수행한다. |
| 검증·테스트 | Zod, Vitest/Jest, Playwright | API 입력·AI 출력 스키마 검증, 도메인·화면 흐름 검증에 사용한다. |

무료 플랜은 시작 비용을 낮추기 위한 선택이며 무제한·영구 무료를 보장하지 않는다. 배포 전에 지역·용량·요청량·절전 정책과 AI 제공자의 무료 제공량·데이터 처리 조건을 확인한다. 확인되지 않은 경우 실제 민감 데이터를 전송하지 않고 가상 계정·허가된 예시 사진으로 시연한다.

### 1.2 구성 및 데이터 경계

```text
[어르신 브라우저]                         [보호자 브라우저]
        └────────────────── HTTPS ────────────────┘
                            ▼
                  [Vercel / Next.js]
                  ├─ 접근성 화면·Supabase Auth 세션
                  ├─ 인증·동의·권한·입력 검증
                  ├─ 회상/기록 API 라우트
                  └─ 서버 전용 AI Provider Adapter
                       │                 │
              사용자 JWT│                 │최소 입력·사진
                       ▼                 ▼
              [Supabase Auth]        [생성형 AI API]
                       │
                       ▼
              [Supabase PostgreSQL]
              프로필·동의·보호자 연결·세션·메시지·요약
                       │
                       ▼
              [Supabase private Storage: 사진]
```

브라우저는 AI 비밀키를 받지 않으며 사진·대화는 서버에서 검증한다. 사용자 데이터 요청은 인증 사용자의 Supabase JWT로 RLS를 적용한다. `service_role` 키는 브라우저 및 일반 사용자 요청 경로에서 사용하지 않는다. 앱 서버 로컬 파일 시스템은 영구 저장소로 사용하지 않는다.

### 1.3 역할 및 화면 구조

- **어르신(`senior`):** 본인의 활동·사진·대화·요약·체크인을 관리하고 보호자 연결 및 공유를 승인·철회한다.
- **보호자(`caregiver`):** 연결이 승인되고 공유 동의가 유효한 동안 활동 요약만 읽는다. 원본 사진·대화 전문은 열람할 수 없다.
- **운영자:** MVP에 사용자 기록을 임의 열람하는 운영자 기능을 두지 않는다.

| 화면 | 기능 | 주요 데이터/API 연결 |
|---|---|---|
| 로그인·동의 | 로그인, 저장·AI·공유 동의 확인 및 철회 | Supabase Auth, 동의 조회·등록·철회 API |
| 홈·지난 기록 | 새 활동 시작, 본인 세션 목록 진입 | 세션 목록 API |
| 사진 선택 | 허가된 예시 선택 또는 사진 업로드 | 세션 생성 API, private Storage |
| 회상 대화 | 사진·질문 표시, 답변 입력, 진행 회차 표시 | 세션 상세, 답변 제출 API |
| 오늘 기록 | 복약·컨디션·선택 메모 직접 입력 | 체크인 저장 API |
| 활동 요약 | 참여 일시·턴 수·키워드·AI 요약·체크인 확인 | 세션 상세·요약 조회 API |
| 보호자 연결 | 초대 생성·코드 등록·승인·해제, 공유 동의 | 초대/연결 조회·등록·승인·해제 API, 동의 API |
| 기록·개인정보 | 세션·사진 삭제, 동의 이력 확인·철회 | 세션 삭제 API, 동의 API |
| 보호자 요약 | 연결된 어르신의 허용된 요약만 조회 | 보호자 요약 목록·상세 API |

고령층 UI는 본문 18px 이상을 목표로 큰 버튼, 고대비, 모바일 대응, 키보드 조작, 한 화면 한 가지 주요 행동을 적용한다. 색만으로 상태를 표현하지 않는다.

### 1.4 핵심 흐름

1. 인증 후 사진·대화 저장 및 AI 전송 동의를 확인한다. 필수 동의가 없으면 업로드·AI 호출·저장을 시작하지 않는다.
2. 어르신은 예시 사진 또는 검증된 업로드 사진으로 세션을 시작한다. 업로드는 JPEG/PNG/WebP, 기본 최대 5MB를 허용하며 확장자 외 실제 파일 형식도 확인한다. UUID 객체명을 사용하고 DB에는 Storage 경로만 저장한다.
3. 서버는 사진과 최소 프롬프트로 첫 질문을 요청한다. 사용자 ID, 실명, 주소, 연락처, 인증 토큰, 보호자 정보는 AI에 보내지 않는다.
4. 대화는 3개의 사용자 답변 회차로 진행한다. 각 답변을 저장한 뒤 다음 질문을 만든다. 세 번째 답변 뒤 세션을 완료하고 요약을 저장한다.
5. 질문은 열린 형태로 작성하며 사진 속 인물·관계·날짜·장소·사건을 추측하지 않는다. AI 실패·잘못된 JSON은 1회 재시도 후 고정 질문과 기본 요약으로 대체한다.
6. 복약·컨디션은 어르신이 직접 입력한다. 대화에서 값을 추론하지 않는다. 요약은 AI 생성 참고 내용임을 표시하며 진단·위험도 평가를 하지 않는다.
7. 보호자 접근은 활성 연결, 어르신의 현재 공유 동의, 요청자 식별 및 요약 전용 범위를 모두 확인한다. 연결 해제나 동의 철회 즉시 조회를 차단한다.

### 1.5 완결 API 목록 및 화면 매핑

아래 목록은 MVP에서 실제 구현할 애플리케이션 API의 기준이다. 모든 경로는 `/api`로 시작한다. `{id}`는 UUID이며, 세션 리소스는 기본적으로 소유자만 접근할 수 있다. 인증·인가 실패는 데이터를 반환하지 않고 적절한 401/403/404를 반환한다. Supabase Auth의 로그인·로그아웃은 Supabase Auth SDK가 담당하며 별도 앱 API로 중복 구현하지 않는다. AI 공급자 호출은 서버 내부 계약이고 공개 API가 아니다.

| 화면·기능 | 메서드·경로 | 동작·응답 범위 | 필수 검증/인가 |
|---|---|---|---|
| 동의 화면/개인정보 설정: 현재 동의 및 이력 확인 | `GET /api/consents` | 로그인 사용자의 동의 상태·문서 버전·시각 반환 | 본인 동의만 반환 |
| 동의 화면: 동의 등록 | `POST /api/consents` | 동의 유형과 문서 버전 기록 (`data_storage`, `ai_processing`, `caregiver_sharing`) | 인증, 허용된 유형·버전, 중복 요청 안전 처리 |
| 개인정보 설정: 동의 철회 | `DELETE /api/consents/{type}` | 해당 유형 철회 기록; 공유 철회는 보호자 조회를 즉시 차단 | 본인만 가능; 저장/AI 동의 철회 시 진행 중 작업 정책 적용 |
| 홈/지난 기록: 세션 목록 | `GET /api/sessions?cursor=&limit=` | 본인 세션의 날짜·상태·참여 수 요약 목록 반환 | 본인 소유, 페이지 크기 제한 |
| 사진 선택: 세션 시작 | `POST /api/sessions` | multipart 사진(또는 `sample_photo_id`) 검증·저장, 세션 생성, 첫 질문 반환 | 로그인, 저장·AI 동의, 이미지 검증, 사용 허가된 예시만 허용 |
| 대화/요약: 세션 상세 | `GET /api/sessions/{id}` | 세션 상태, 대화 메시지, 체크인 등 본인 기록 반환 | 세션 소유자만; 보호자에게는 이 경로로 전문 노출 금지 |
| 대화: 답변 제출 및 다음 질문 생성 | `POST /api/sessions/{id}/answers` | 답변 저장, 회차가 1·2면 다음 질문 반환, 3이면 완료 안내 | 소유권, `in_progress`, 회차·답변 길이, 중복 제출 방지 |
| 대화: 완료 및 요약 생성/재시도 | `POST /api/sessions/{id}/complete` | 완료 조건을 확인해 완료 처리·요약 생성; 반복 호출은 동일 결과 반환 | 소유권, 답변 3개, 멱등 처리 |
| 오늘 기록: 체크인 저장 | `PATCH /api/sessions/{id}/check-in` | 복약·컨디션·선택 메모 저장 | 소유권, 허용 enum·메모 길이 |
| 활동 요약: 요약 단독 조회 | `GET /api/sessions/{id}/summary` | 해당 세션의 요약과 참여 수 반환 | 본인 소유; 보호자 요약 조회는 별도 경로에서 제한 |
| 기록·개인정보: 세션 삭제 | `DELETE /api/sessions/{id}` | Storage 사진과 세션·메시지·요약 삭제 | 소유권, 명시적 확인; 부분 실패 재시도 가능 |
| 보호자 연결: 초대 코드 생성 | `POST /api/caregiver-invites` | 만료·일회성 코드 생성; 원문은 발급 응답에만 포함 | senior 본인, 호출 제한, 평문 저장·로그 금지 |
| 보호자 연결: 코드 등록 | `POST /api/caregiver-invites/redeem` | 보호자가 코드를 등록하고 승인 대기 연결 생성 | caregiver 인증, 코드 해시·만료·일회성 검증, 대입 방지 |
| 보호자 연결: 연결 목록 | `GET /api/caregiver-links` | 본인이 생성한/연결된 초대 및 관계 상태 반환 | 요청자에게 관련된 연결만 반환 |
| 보호자 연결: 어르신 승인 | `POST /api/caregiver-links/{id}/approve` | 대기 연결을 활성화 | 해당 어르신 본인, 활성 공유 동의, 대상·범위 확인 |
| 보호자 연결: 연결 해제 | `DELETE /api/caregiver-links/{id}` | 연결을 철회하고 보호자 조회를 즉시 차단 | 연결 당사자 중 허용된 주체; 상태 전이 검증 |
| 보호자 요약 화면: 목록 조회 | `GET /api/caregiver/summaries?cursor=&limit=` | 공유가 허용된 어르신의 요약 목록만 반환 | 활성 연결 + 활성 공유 동의 + caregiver 본인 |
| 보호자 요약 화면: 상세 조회 | `GET /api/caregiver/summaries/{sessionId}` | 세션별 허용 요약만 반환; 사진·대화 전문 제외 | 매 요청마다 연결·동의를 재확인 |

API 공통 규칙: 본문·쿼리 입력은 Zod로 검증하고, 예상 가능한 오류는 일관된 `{ "error": { "code", "message" } }` 형식으로 반환한다. 목록은 제한된 페이지네이션을 적용한다. 삭제와 완료 작업은 재시도 가능한 멱등성을 보장한다. 민감한 본문·사진 URL·초대 코드·토큰은 로그에 기록하지 않는다. DB 직접 접근을 쓰는 기능에도 동일한 화면/API 계약과 RLS를 적용한다.

### 1.6 AI 입출력 및 오류 계약

AI 입력은 호출 목적별로 최소화한다. 첫 질문은 사진 1장과 안전 지침, 후속 질문은 현재 답변과 해당 세션의 최소 문맥, 요약은 해당 세션 대화만 포함한다. 체크인은 필요하고 동의된 경우에만 포함한다. 구조화 출력은 질문 생성 시 `question`, 요약 시 `recall_keywords`, `activity_summary`, `health_mention_note`를 사용하고 서버에서 스키마·길이·금지 표현을 검증한다. 오류·타임아웃·파싱 실패는 1회 재시도 후 고정 질문 또는 중립적인 기본 요약으로 대체한다.

## 2. 데이터 저장 구조

### 2.1 모델 및 테이블

```text
auth.users 1:1 profiles
profiles 1:N consent_records
profiles 1:N sessions
sessions 1:N messages
sessions 1:1 summaries
profiles ↔ caregiver_links (senior_user_id / caregiver_user_id)
```

| 테이블 | 핵심 필드 |
|---|---|
| `profiles` | `id UUID PK/FK auth.users.id`, 선택 `display_name`, `role` (`senior`/`caregiver`), `created_at` |
| `consent_records` | `id`, `user_id`, `consent_type`, `document_version`, `granted_at`, nullable `revoked_at`; 이력 보존 |
| `caregiver_links` | `id`, `senior_user_id`, nullable `caregiver_user_id`, `invite_code_hash`, `invite_expires_at`, `status` (`pending`/`active`/`revoked`/`expired`), `approved_at`, `revoked_at`, `created_at` |
| `sessions` | `id`, `user_id`, `started_at`, `completed_at`, `status`, `photo_path`, `photo_source`, `medication_status`, `condition_status`, `condition_note`, `created_at` |
| `messages` | `id`, `session_id`, `turn_number`, `role` (`assistant`/`user`), `content`, `created_at` |
| `summaries` | `id`, unique `session_id`, `participation_count` (0~3), `recall_keywords`, `activity_summary`, nullable `health_mention_note`, `created_at` |

**turn_number 정의:** `turn_number`는 사용자 답변 회차 1~3을 뜻하며 같은 회차의 assistant 질문과 user 답변에 같은 번호를 부여한다(첫 질문과 첫 답변 모두 1, 마지막 질문과 답변 모두 3). 따라서 정상 완료 대화는 최대 6개 메시지이며 최초 세션 안내 메시지가 필요하면 회차가 아닌 별도 `message_type`으로 기록한다.

### 2.2 무결성·인덱스·보관·삭제

- `messages.turn_number`는 1~3, `role`은 `assistant`/`user`로 제한한다. 세션별 같은 회차·role의 중복 메시지를 막는 제약을 둔다. 대화 순서는 `(session_id, turn_number, role)` 및 생성 시각으로 결정한다.
- `sessions(user_id, started_at DESC)`, `messages(session_id, turn_number, created_at)` 인덱스를 둔다. `summaries.session_id`는 UNIQUE다.
- 세션 삭제 시 메시지와 요약은 cascade 삭제한다. Storage 객체는 별도 삭제 후 DB 삭제하며 실패는 추적·재시도한다.
- MVP 보관 기간은 완료 후 90일 제안값이며 실제 운영 전 개인정보 검토 후 확정한다. 로그에는 대화 전문·사진·서명 URL·토큰·API 키를 기록하지 않는다.

### 2.3 RLS 및 사진 권한

모든 사용자 데이터 테이블에 RLS를 켜고 기본 거부로 한다. 사용자는 본인 프로필·동의·세션만 접근한다. 메시지와 요약은 부모 세션 소유자를 확인한다. 보호자는 활성 연결과 현재 공유 동의가 모두 있을 때 별도 보호자 요약 경로로 요약만 읽는다. 승인·철회·초대 상태는 서버에서 검증하며 클라이언트가 임의 변경할 수 없다. 사진 버킷은 private이고 사용자 UUID/객체 UUID 경로를 사용한다. 보호자에게 원본 사진을 제공하지 않는다.

## 3. 파일 구조 및 구현 계획

### 3.1 파일 구조

```text
TRD-/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (senior)/page.tsx
│   ├── (senior)/photo/page.tsx
│   ├── (senior)/sessions/[id]/page.tsx
│   ├── (senior)/sessions/[id]/summary/page.tsx
│   ├── (senior)/check-in/page.tsx
│   ├── (senior)/caregiver/page.tsx
│   ├── (senior)/privacy/page.tsx
│   ├── (caregiver)/summaries/page.tsx
│   └── api/                                # 1.5의 모든 엔드포인트 구현
├── components/                             # 접근성 UI·사진·대화·요약
├── lib/
│   ├── supabase/{client,server}.ts
│   ├── auth.ts
│   ├── consent.ts
│   ├── permissions.ts
│   ├── storage.ts
│   ├── validation.ts
│   ├── conversation.ts                     # turn_number 및 3회 상태 전이
│   ├── summaries.ts
│   └── ai/{provider,prompts,fallback,gemini}.ts
├── supabase/{migrations,seed.sql}
├── public/sample-photos/                    # 사용 허가된 예시만
├── tests/{unit,integration,e2e}/
├── .env.example
├── package.json
├── next.config.ts
├── README.md
├── PRD.md                                   # 원문이 제공되면 추적표 대조
└── TRD.md
```

### 3.2 구현 순서 및 완료 기준

1. **기본 회상 흐름:** Next.js·Vercel·Supabase 구성, 인증·동의, 예시 사진, 세션·3회 대화·요약 저장 및 조회.
2. **기록·개인정보:** 검증된 사진 업로드, 체크인, 동의 철회, 세션·사진 삭제와 실패 재시도.
3. **보호자·안정화:** 일회성 초대, 승인·해제, 요약 전용 공유, RLS·접근성·오류 시나리오 테스트.

완료 기준은 사진 선택/업로드부터 질문·답변 3회, 저장된 요약과 체크인 확인까지 이어지고, 동의 없는 처리와 타 사용자 접근이 거부되며, 보호자에게 허용된 요약만 보이는 것이다. 테스트는 AI 타임아웃·잘못된 JSON, 중복 제출, DB/Storage 실패, 철회·삭제, RLS 격리를 포함한다. PRD에 명시된 사용성 수치 목표는 테스트에서 그대로 측정한다.

### 3.3 비밀정보

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`만 공개 가능 설정으로 사용한다. `GEMINI_API_KEY` 등 AI 비밀값은 서버 환경변수로만 관리한다. `.env.local`, 실제 키, 사진·대화 데이터는 Git에 커밋하지 않는다. Vercel 배포 비밀값과 로컬 비밀값을 분리한다.

## PRD 요구사항 추적표

저장소 루트에는 `PRD.md`가 없고 PRD 원본은 `기억배달부 (3).pdf`로 확인된다. 따라서 이 저장소에서 기능 ID/번호와 PDF의 원문 제목을 검증할 수 없어 ID를 임의로 만들지 않는다. 아래 항목명은 현재 TRD에 반영된 기능 표현이며, PDF에서 원문 제목을 확인한 뒤 해당 열을 토씨까지 대조·교체해야 한다. 이 표를 PDF 원문과 이미 일치한다고 간주하지 않는다.

| PRD 원문 요구사항 제목/ID | TRD 기능 항목(현재 대응) | 화면·API·데이터 대응 |
|---|---|---|
| PDF 원문 대조 필요 (현재 표현: 추억 사진 등록 또는 예시 사진 선택) | 사진 선택·등록 | 사진 화면, `POST /api/sessions`, Storage, `sessions.photo_path` |
| PDF 원문 대조 필요 (현재 표현: 사진 참고 회상 질문) | 첫 질문 생성 | 대화 화면, 세션 생성 API, AI provider/fallback |
| PDF 원문 대조 필요 (현재 표현: 답변에 맞춘 후속 질문·3턴 대화) | 답변 기반 3회 대화 | `POST /api/sessions/{id}/answers`, `messages.turn_number` |
| PDF 원문 대조 필요 (현재 표현: 사진 속 인물·상황을 단정하지 않음) | 비단정 질문 안전 규칙 | AI 프롬프트·출력 검증·fallback 테스트 |
| PDF 원문 대조 필요 (현재 표현: 대화 참여·키워드·날짜 기록) | 활동 기록·요약 | 세션 목록/상세/요약 GET, `sessions`, `messages`, `summaries` |
| PDF 원문 대조 필요 (현재 표현: 보호자 활동 기록 확인) | 승인 기반 요약 공유 | 보호자 초대·승인·연결·요약 API, `caregiver_links` |
| PDF 원문 대조 필요 (현재 표현: 복약·컨디션 체크) | 오늘 기록 | 체크인 API, `sessions` 체크인 컬럼 |
| PDF 원문 대조 필요 (현재 표현: 건강 언급 메모와 전문기관 안내) | 비진단적 건강 메모·안내 | 요약 조회, `health_mention_note`, 고정 안내 문구 |
| PDF 원문 대조 필요 (현재 표현: 동의 기반 사진·대화 저장·삭제) | 동의·철회·삭제 | 동의 GET/POST/DELETE, 세션 DELETE, `consent_records` |
| PDF 원문 대조 필요 (현재 표현: AI API 장애 대체) | 재시도·fallback | 서버 AI adapter, `ai/fallback.ts` |
| PDF 원문 대조 필요 (현재 표현: 고령층 친화 UI) | 접근성 화면 | 화면 컴포넌트, 키보드·대비·사용성 테스트 |

**PRD 대조 후 추적표 갱신 규칙:** PDF에서 요구사항 ID가 있으면 `PRD ID` 열에 원래 ID를 그대로 기입한다. ID가 없으면 표의 `PRD 원문 요구사항 제목`을 PDF의 제목/항목명과 토씨까지 일치시킨다. 의미만 비슷한 표현으로 바꾸거나 ID를 새로 만들어 원문처럼 표시하지 않는다.
