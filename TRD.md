# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부
- **서비스명:** 정담이
- **문서 목적:** PRD의 사용자 요구사항을 구현 가능한 아키텍처, 데이터 모델, 화면·API 흐름, 보안 정책 및 단계별 구현 계획으로 구체화한다.
- **대상 범위:** 해커톤 MVP 웹 서비스와 시연
- **기술 제약:** 고정된 기술 스택 없음. 빠른 개발, 무료로 시작 가능한 배포·DB, 사진·대화의 안전한 처리 및 추후 확장성을 우선한다.
- **설계 원칙:** PRD 요구사항 추적, 고령층 접근성, 명시적 동의, 최소 데이터 수집, 사용자 설명을 우선하는 비진단적 AI 사용

> 본 서비스는 회상 활동과 일상 기록을 돕는 프로토타입이며 의료기기나 임상 진단 시스템이 아니다. AI 결과는 참고용으로만 제공하고 질환 진단, 인지 점수화, 위험도 판단 또는 치료 권고를 하지 않는다.

---

## 1. 시스템 아키텍처

### 1.1 기술 스택 결정

| 영역 | 권장 기술 | 선택 이유 및 적용 범위 |
|---|---|---|
| 웹 프론트엔드·서버 | **Next.js (App Router) + TypeScript** | 반응형 웹 화면과 서버 API를 한 프로젝트에서 구현한다. 사진 선택, 대화 상태, 보호자·어르신 화면을 빠르게 구성하고 타입으로 API 계약을 명확히 한다. |
| 웹 호스팅 | **Vercel Hobby** | GitHub 저장소 연동과 프리뷰 배포가 간편해 해커톤 MVP에 적합하다. 서버 기능은 요청량·실행 시간 등 무료 플랜 한도 안에서 사용한다. |
| 데이터베이스·인증·파일 저장 | **Supabase Free (PostgreSQL, Auth, private Storage)** | 관계형 세션·메시지 데이터, 사용자 인증, 사진 저장을 한 곳에서 제공한다. PostgreSQL RLS로 사용자별 권한을 DB에서 강제한다. |
| 생성형 AI | **Gemini API 등 팀이 선택한 멀티모달 모델 API** | 사진을 참고한 첫 질문, 답변을 반영한 후속 질문, 세션 요약에 사용한다. 호출은 서버에서만 수행하고 제공자 교체가 가능한 어댑터로 분리한다. |
| 입력·출력 검증 | **Zod** | 업로드 메타데이터와 AI JSON을 서버에서 스키마 검증한다. |
| 테스트 | **Vitest 또는 Jest + Playwright** | 도메인 로직·권한·AI 대체 흐름과 대표 사용자 시나리오를 검증한다. |

**무료 플랜 운영 원칙:** 위 서비스는 무료 플랜으로 시작할 수 있는 권장 구성이지 무제한·영구 무료를 보장하지 않는다. 배포 시 각 서비스의 제공 지역, 저장 용량, 요청량, 절전·비활성 정책, 서버 실행 제한을 확인한다. 한도 초과나 정책 변경을 고려해 대화·사진을 실제 사용자 데이터 대신 가상 데이터로 시연하고, DB 백업 및 데이터 내보내기 방안을 마련한다. AI API의 무료 제공량·보관·학습 정책은 별도로 확인하며 확인 전에는 민감한 실제 데이터를 전송하지 않는다.

### 1.2 시스템 구성

```text
[어르신 브라우저]                         [보호자 브라우저]
        │ HTTPS                                  │ HTTPS
        └───────────────────┬────────────────────┘
                            ▼
                  [Vercel / Next.js]
                  ├─ 반응형 화면·접근성 UI
                  ├─ Supabase Auth 세션 확인
                  ├─ 동의·권한·입력 검증
                  ├─ 회상 대화·기록 API (서버)
                  └─ AI Provider Adapter (서버 전용 비밀키)
                       │                 │
              사용자 JWT│                 │최소 입력·사진
                       ▼                 ▼
             [Supabase Auth]        [생성형 AI API]
                       │
                       ▼
              [Supabase PostgreSQL]
              프로필·동의·연결·세션·메시지·요약
                       │
                       ▼
              [Supabase private Storage]
              사용자별 비공개 사진 객체
```

브라우저는 데이터베이스 및 AI 공급자 비밀키에 직접 접근하지 않는다. 일반 사용자 요청은 Supabase 사용자 access token을 사용해 RLS 정책을 적용한다. 서버 라우트는 인증·동의·소유권을 확인한 뒤 필요한 작업만 수행한다. Supabase `service_role` 키는 사용자 요청 경로에 사용하지 않는다.

### 1.3 사용자 역할과 권한

- **어르신(`senior`):** 본인의 사진, 회상 세션, 대화, 요약, 복약·컨디션 입력을 생성·조회·삭제하고 보호자 공유를 승인·철회한다.
- **보호자(`caregiver`):** 어르신이 초대를 승인하고 공유 동의가 활성 상태인 동안 허용된 활동 요약을 읽기 전용으로 조회한다. 원본 사진·대화 전문은 조회할 수 없다.
- **운영자:** MVP에는 별도 운영자 대시보드나 임의 사용자 데이터 열람 기능을 두지 않는다. 개발·시연 데이터는 가상 데이터로 제한한다.

`role` 값이나 프론트엔드에서 버튼을 숨기는 것만으로 권한을 부여하지 않는다. 요청 사용자의 ID, 세션 소유자, 보호자 연결 상태 및 현재 동의를 서버와 RLS에서 함께 검증한다.

### 1.4 화면 구조와 PRD 기능 연결

| 화면 | 주요 기능 | 연결 데이터·처리 |
|---|---|---|
| 홈 | 큰 글씨·고대비의 새 활동 시작, 오늘 기록 및 지난 기록 진입 | 로그인 사용자 프로필, 최근 세션 |
| 로그인·동의 | 인증, 저장·AI 전송 목적과 범위 안내, 동의·철회 | Supabase Auth, `consent_records` |
| 사진 선택 | 허가된 예시 사진 선택 또는 사진 업로드 | 이미지 검증, 비공개 Storage, 세션 생성 |
| 회상 대화 | 사진과 질문 표시, 큰 답변 입력창, 현재 턴·진행 상태 표시 | `sessions`, `messages`, 질문 생성 API, 총 3개 답변 |
| 오늘 기록 | 복약 상태, 컨디션 및 선택 메모의 직접 입력 | 세션의 체크인 필드. 대화만으로 값을 추정하지 않음 |
| 활동 요약·기록 | 참여 일시·턴 수·키워드·AI 활동 요약·사용자가 직접 입력한 체크인 표시 | `summaries`, `sessions`; AI 작성 내용임을 표시 |
| 보호자 연결 | 초대 코드 생성·입력, 어르신 승인, 연결 해제·공유 동의 | `caregiver_links`, `consent_records` |
| 기록·개인정보 관리 | 세션 및 사진 삭제, 저장·AI·공유 동의 철회 | 삭제 API, Storage 객체 삭제, 동의 이력 |

접근성 기본값은 본문 18px 이상을 목표로 하고, 큰 버튼, 명확한 한 화면 한 가지 주요 행동, 충분한 색상 대비, 키보드 조작, 모바일 화면 대응을 적용한다. 색만으로 상태를 구분하지 않고 오류·저장 결과를 쉬운 문장으로 표시한다.

### 1.5 핵심 데이터 흐름

#### A. 로그인, 동의 및 보호자 연결

1. 사용자는 Supabase Auth로 로그인하고, 서버는 토큰의 사용자 ID를 확인한다.
2. 어르신은 사진·대화 저장과 AI API 전송 목적, 처리 범위, 보관 기간을 안내받는다. 해당 동의가 활성화되기 전에는 사진 업로드, AI 호출, 기록 저장을 시작하지 않는다. 동의 문서 버전과 시각을 기록한다.
3. 보호자 연결은 어르신이 생성한 충분히 무작위인 만료·일회성 코드로 시작한다. 코드 원문은 DB나 로그에 저장하지 않고 해시만 저장한다.
4. 보호자가 코드를 등록해도 연결은 대기 상태다. 어르신이 상대와 공유 범위를 확인하고 승인한 후에만 활성화한다.
5. 어르신은 공유 동의를 철회하거나 연결을 해제할 수 있다. 철회 요청 처리 즉시 보호자 조회를 차단한다. 보호자 공개 링크 방식은 제공하지 않는다.

#### B. 사진 기반 회상 활동

1. 어르신이 예시 사진을 선택하거나 업로드한다. 업로드는 JPEG·PNG·WebP만 허용하고 크기 제한(기본 최대 5MB)을 적용한다. 확장자뿐 아니라 실제 파일 형식과 이미지 디코딩 여부를 확인한다.
2. 업로드 시 안전한 UUID 객체명을 사용해 사용자별 경로의 private Storage에 저장한다. DB에는 사진 바이너리 대신 Storage 경로와 사진 출처(`sample`/`upload`)만 저장한다.
3. 저장·AI 전송 동의와 업로드 성공을 확인한 후 `sessions`를 생성한다. 업로드 또는 DB 저장 실패 시 성공으로 표시하지 않고 재시도하도록 안내한다.
4. 서버가 사진과 최소 프롬프트로 첫 질문을 요청한다. 사용자 ID, 실명, 주소, 연락처, 인증 토큰, 보호자 정보는 AI에 보내지 않는다.
5. 사용자의 답변을 저장한 뒤 해당 세션의 최소 문맥만 사용해 다음 질문을 요청한다. 총 사용자 답변 3개를 완료하면 세션을 완료 처리하고 요약을 생성한다.
6. 질문은 사용자의 기억을 존중하고 열린 형태로 작성한다. 사진 속 인물의 신원·관계, 날짜·장소·사건을 추측해 사실처럼 말하거나 답을 유도하지 않는다.
7. AI 요청 오류·타임아웃·출력 검증 실패 시 제한 시간 내 1회 재시도한다. 계속 실패하면 사진 유형별 사전 질문 및 로컬 기본 요약을 사용해 3턴 흐름을 지속한다.

#### C. 체크인, 요약 및 보호자 조회

1. 복약 여부·컨디션은 어르신이 직접 선택·입력한다. 대화 내용으로 복약 이행이나 건강 상태를 추론하지 않는다.
2. 요약 화면은 사용자 입력, 대화 참여 수, AI가 만든 회상 키워드·활동 요약을 시각적으로 구분한다. 요약에는 AI 생성 참고 내용임을 명시한다.
3. 건강 관련 메모는 사용자가 실제로 말한 내용을 짧게 정리하는 초안 또는 `null`이다. 질환명 추정, 인지 점수, 위험도, 치료법을 제공하지 않는다.
4. 보호자 요청은 활성 연결, 어르신의 현재 공유 동의, 요청자 ID, 요약 조회 범위를 모두 확인한다. 이 중 하나라도 충족하지 않으면 거부한다.
5. 필요 시 보건소·치매안심센터·의료기관 등 전문기관 상담을 권하는 고정 안내 문구를 제공한다. 긴급도 판단은 AI가 하지 않는다.

### 1.6 API 및 AI 계약

모든 사용자 데이터 변경은 인증된 서버 라우트 또는 사용자 JWT가 적용된 Supabase 요청을 통해 수행한다. 각 요청은 Zod로 입력을 검증한다. 최소 API 경로 예시는 다음과 같다.

| 메서드·경로 | 기능 | 주요 검증 |
|---|---|---|
| `POST /api/sessions` | 동의 확인 후 세션 생성 및 사진 등록 | 로그인, 활성 동의, 이미지 형식·크기 |
| `POST /api/sessions/:id/answers` | 답변 저장 및 다음 질문 요청 | 세션 소유권, 진행 상태, 답변 길이, 턴 제한 |
| `POST /api/sessions/:id/complete` | 완료 처리 및 요약 생성 | 답변 3개, 세션 소유권, 중복 완료 방지 |
| `PATCH /api/sessions/:id/check-in` | 복약·컨디션 직접 입력 저장 | 세션 소유권, 허용 값 |
| `POST /api/caregiver-invites` | 일회성 초대 발급·등록 | 로그인, 만료, 코드 해시, 호출 제한 |
| `POST /api/caregiver-links/:id/approve` | 어르신의 연결 승인 | 어르신 본인 확인, 공유 동의 |
| `DELETE /api/sessions/:id` | 세션과 연관 데이터·사진 삭제 | 세션 소유권, 명시적 삭제 확인 |

AI 입력은 호출 목적별로 최소화한다.

- **첫 질문:** 사진 1장, 사진 유형, 비단정 질문 지침, 고령층 친화적 말투 지침.
- **후속 질문:** 현재 사용자 답변과 해당 세션의 필요한 최소 문맥.
- **요약:** 해당 세션 대화만, 체크인 내용은 요약에 필요하고 동의된 경우에만 포함.
- **제외:** 계정 자격 증명·토큰, 실명·연락처·주소, 보호자 식별 정보, 타인의 기록.

AI 응답은 다음 구조를 기준으로 JSON 파싱과 서버 검증 후 사용한다.

```json
{
  "question": "그때 어떤 일이 있었는지 기억나시는 부분부터 들려주시겠어요?",
  "recall_keywords": ["가족", "여행"],
  "activity_summary": "사용자가 사진과 관련한 가족 여행의 기억을 이야기했습니다.",
  "health_mention_note": null
}
```

대화 생성에서는 `question`, 요약 생성에서는 `recall_keywords`, `activity_summary`, `health_mention_note`를 사용한다. 필수 필드 누락·잘못된 형식·금지된 진단 표현은 재시도 1회 후 fallback으로 처리한다. 모델이 생성한 결과를 사용자 진술의 객관적 사실처럼 표현하지 않는다.

### 1.7 장애·오류 처리

| 장애 상황 | 처리 방식 |
|---|---|
| AI 키 누락, API 오류·타임아웃 | 서버 로그에는 민감 데이터 없이 오류 유형만 기록하고 1회 재시도 후 고정 질문으로 전환 |
| JSON 파싱·안전 검증 실패 | 재시도 1회 후 사전 질문 또는 기본 요약 사용 |
| 사진 검증·Storage 업로드 실패 | 세션 시작을 확정하지 않고 수정·재시도 안내 |
| DB 저장 실패 | 저장 성공을 표시하지 않으며, 사용자가 재시도할 수 있도록 현재 화면 입력을 일시 보존 |
| 로그인 만료·권한 거부 | 데이터 반환 없이 재로그인 또는 연결 승인 안내 |
| 네트워크 오류·중복 요청 | 진행 단계 표시, 재시도 가능한 오류 안내, 완료·저장 API의 중복 처리를 방지 |
| 무료 플랜 한도 도달 | 서비스별 사용량을 확인하고 가상 데이터 시연 또는 로컬 개발 환경으로 전환 |

---

## 2. 데이터 저장 구조

### 2.1 저장·보관·삭제 원칙

- 관계형 데이터는 Supabase PostgreSQL, 사진은 비공개 Supabase Storage 버킷에 저장한다. 앱 서버 로컬 파일 시스템은 영구 저장소로 사용하지 않는다.
- 저장·AI 전송 동의 전에는 사진·대화 데이터를 처리하지 않는다. 공유는 별도 동의를 받아야 한다.
- 수집 필드는 기능에 필요한 최소 범위로 제한한다. 실명은 선택 사항이며, 데모에서는 가상 계정과 이용 허가된 사진만 사용한다.
- MVP 기본 보관 기간은 완료 세션 기준 **90일 제안값**이다. 실제 배포 전 개인정보 담당자 검토 후 확정하고, 만료 데이터의 정리 작업과 예외 처리 방법을 구현한다.
- 삭제 요청은 사용자의 확인 후 관련 메시지, 요약, 세션, Storage 사진을 삭제한다. Storage 삭제와 DB 삭제는 별도 작업이므로 실패 상태를 기록해 재시도할 수 있게 한다. 백업·외부 AI 제공자의 보관 조건은 별도 고지한다.
- 로그에 사진·서명 URL·대화 전문·초대 코드·인증 토큰·API 키를 남기지 않는다. 오류 로그는 요청 ID, 오류 유형, 시각 등 비식별 운영 정보로 제한한다.

### 2.2 논리 데이터 모델

```text
auth.users
  └── profiles (1:1)
       ├── consent_records (1:N)
       ├── sessions (1:N)
       │    ├── messages (1:N)
       │    └── summaries (1:1)
       └── caregiver_links (senior_user_id / caregiver_user_id)
```

### 2.3 테이블 설계

모든 테이블은 UUID 기본 키와 UTC `timestamptz` 시각을 사용한다. 외래 키, 체크 제약조건, 필요한 인덱스를 마이그레이션 SQL에 명시한다.

#### `profiles` — 사용자 프로필

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK, `auth.users.id` 참조 |
| `display_name` | TEXT nullable | 화면 표시용 이름. 실명 입력 불필요 |
| `role` | TEXT | `senior`, `caregiver` 중 하나. 화면 표시·업무 구분용이며 단독 권한 근거가 아님 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |

#### `consent_records` — 동의 이력

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `profiles.id` |
| `consent_type` | TEXT | `data_storage`, `ai_processing`, `caregiver_sharing` |
| `document_version` | TEXT | 동의 안내문 버전 |
| `granted_at` | TIMESTAMPTZ | 동의 시각 |
| `revoked_at` | TIMESTAMPTZ nullable | 철회 시각. 현재 동의는 `NULL` |

#### `caregiver_links` — 보호자 연결

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK |
| `senior_user_id` | UUID | FK → `profiles.id`, 기록 소유자 |
| `caregiver_user_id` | UUID nullable | FK → `profiles.id`, 승인 전에는 NULL 가능 |
| `invite_code_hash` | TEXT nullable | 평문 코드 금지, 해시만 저장 |
| `invite_expires_at` | TIMESTAMPTZ nullable | 초대 만료 시각 |
| `status` | TEXT | `pending`, `active`, `revoked`, `expired` |
| `approved_at` | TIMESTAMPTZ nullable | 어르신 승인 시각 |
| `revoked_at` | TIMESTAMPTZ nullable | 연결 해제 시각 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |

활성 연결은 어르신·보호자 조합이 유일하도록 제약을 둔다. 초대 코드는 만료·일회성으로 소모하고, 추측·대입 방지를 위해 발급·검증에 호출 제한을 적용한다.

#### `sessions` — 회상 활동 및 체크인

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `profiles.id`, 소유자 |
| `started_at` | TIMESTAMPTZ | 시작 시각 |
| `completed_at` | TIMESTAMPTZ nullable | 완료 시각 |
| `status` | TEXT | `in_progress`, `completed`, `failed` |
| `photo_path` | TEXT nullable | private Storage 경로만 저장 |
| `photo_source` | TEXT | `sample`, `upload` |
| `medication_status` | TEXT nullable | `taken`, `not_taken`, `not_recorded` |
| `condition_status` | TEXT nullable | `good`, `okay`, `unwell`, `not_recorded` |
| `condition_note` | TEXT nullable | 어르신이 직접 입력한 선택 메모 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |

#### `messages` — 대화 기록

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK |
| `session_id` | UUID | FK → `sessions.id` |
| `turn_number` | SMALLINT | 1~3 범위 제약 |
| `role` | TEXT | `assistant`, `user` |
| `content` | TEXT | 질문 또는 답변. 길이 제한 적용 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |

#### `summaries` — 활동 요약

| 컬럼 | 타입 | 제약·설명 |
|---|---|---|
| `id` | UUID | PK |
| `session_id` | UUID | UNIQUE, FK → `sessions.id` |
| `participation_count` | SMALLINT | 사용자 답변 수, 0~3 범위 |
| `recall_keywords` | TEXT[] | 대화에서 추출한 회상 키워드 |
| `activity_summary` | TEXT | AI가 작성한 참고용 활동 요약 |
| `health_mention_note` | TEXT nullable | 실제 언급의 비진단적 메모 초안 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |

### 2.4 인덱스·무결성·삭제 규칙

- `sessions(user_id, started_at DESC)` 인덱스로 본인 기록을 날짜순 조회한다.
- `messages(session_id, turn_number, created_at)` 인덱스로 대화 순서를 조회한다.
- `summaries(session_id)`는 UNIQUE로 세션당 요약 하나를 보장한다.
- 세션 삭제 시 `messages`, `summaries`는 FK `ON DELETE CASCADE`로 함께 삭제한다. Storage 객체는 DB cascade로 삭제되지 않으므로 삭제 서비스가 객체를 지우고 DB 삭제를 수행한다.
- Storage 삭제 성공 여부와 DB 삭제 결과가 달라지는 부분 실패를 고려한다. 삭제 작업을 재시도할 수 있도록 최소한의 비식별 처리 상태를 기록하고 사용자에게 처리 결과를 알린다.
- 계정 삭제 시 연결 관계, 동의 이력 및 사용자 데이터의 삭제·비식별화 정책을 적용한다.

### 2.5 RLS·Storage 접근 정책

- `profiles`, `consent_records`, `caregiver_links`, `sessions`, `messages`, `summaries`에 RLS를 활성화하고 기본 정책은 거부로 둔다.
- 사용자는 본인 프로필과 본인 세션만 접근할 수 있다. `messages`·`summaries`는 부모 세션의 `user_id = auth.uid()`인 경우에만 소유자가 접근한다.
- 보호자에게 허용하는 데이터는 활동 요약에 한정한다. 조회 시 활성 `caregiver_links`, 어르신의 활성 `caregiver_sharing` 동의, 요청자의 `caregiver_user_id` 일치를 서버와 DB 정책에서 확인한다. 연결 해제·동의 철회 즉시 조회를 거부한다.
- 초대 코드의 검증·승인·철회는 서버에서 호출자와 대상 관계를 검증한다. 클라이언트가 임의로 연결 상태를 `active`로 바꾸지 못하게 한다.
- Storage 버킷은 private으로 두고 `user_id/uuid` 형식의 객체 경로를 사용한다. 본인 객체에만 접근을 허용하며 보호자에게 원본 사진을 공유하지 않는다. 미리보기가 필요하면 소유권 확인 후 짧은 만료의 서명 URL을 발급한다.
- Supabase `service_role` 키는 브라우저 번들·일반 사용자 요청에 포함하지 않는다. 인증 사용자 요청에는 사용자 JWT를 사용해 RLS를 유지한다.

---

## 3. 파일 구조 및 구현 계획

### 3.1 권장 저장소 파일 구조

```text
TRD-/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (senior)/page.tsx                    # 홈
│   ├── (senior)/photo/page.tsx              # 예시 선택·업로드
│   ├── (senior)/sessions/[id]/page.tsx      # 회상 대화
│   ├── (senior)/sessions/[id]/summary/page.tsx
│   ├── (senior)/check-in/page.tsx           # 복약·컨디션 기록
│   ├── (senior)/caregiver/page.tsx          # 연결·승인·철회
│   ├── (senior)/privacy/page.tsx            # 동의·삭제
│   ├── (caregiver)/summaries/page.tsx       # 허용된 요약 읽기 전용
│   ├── api/sessions/route.ts
│   ├── api/sessions/[id]/answers/route.ts
│   ├── api/sessions/[id]/complete/route.ts
│   ├── api/sessions/[id]/check-in/route.ts
│   ├── api/caregiver-invites/route.ts
│   └── api/sessions/[id]/route.ts            # 삭제
├── components/
│   ├── AccessibleButton.tsx
│   ├── ConsentNotice.tsx
│   ├── PhotoPicker.tsx
│   ├── ConversationPanel.tsx
│   └── SummaryCard.tsx
├── lib/
│   ├── config.ts
│   ├── supabase/client.ts                    # 브라우저용 Auth 클라이언트
│   ├── supabase/server.ts                    # 서버용 사용자 세션 클라이언트
│   ├── auth.ts
│   ├── consent.ts
│   ├── permissions.ts
│   ├── storage.ts                            # 검증·업로드·삭제·서명 URL
│   ├── validation.ts                         # Zod 입력 스키마
│   ├── conversation.ts                        # 3턴 상태 전이
│   ├── summaries.ts                           # 출력 검증·저장
│   └── ai/
│       ├── provider.ts                        # Provider 인터페이스
│       ├── gemini.ts                          # 공급자 구현
│       ├── prompts.ts                         # 안전 프롬프트
│       └── fallback.ts                        # 고정 질문·기본 요약
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 002_rls_storage_policies.sql
│   └── seed.sql                               # 가상 사용자·데모 데이터만
├── public/
│   └── sample-photos/                         # 사용 허가된 예시 이미지만
├── tests/
│   ├── unit/conversation.test.ts
│   ├── unit/ai-output.test.ts
│   ├── unit/fallback.test.ts
│   ├── integration/permissions.test.ts
│   ├── integration/deletion.test.ts
│   └── e2e/senior-flow.spec.ts
├── .env.example                               # 변수명만, 실제 비밀값 금지
├── .gitignore
├── package.json
├── next.config.ts
├── README.md
├── PRD.md
└── TRD.md
```

### 3.2 구현 계약

- **페이지 컴포넌트:** 화면 렌더링과 사용자 입력을 담당한다. 권한 판단의 유일한 위치로 사용하지 않는다.
- **API 라우트:** 인증 토큰, 동의, 리소스 소유권을 검증하고 입력 스키마를 확인한 후 도메인 함수를 호출한다. 응답에는 필요한 필드만 포함한다.
- **`conversation.ts`:** 세션 시작, 답변 저장, 3턴 제한, 완료 상태 전이, 요약 요청을 관리한다. 마지막 턴 중복 제출을 서버에서도 방지한다.
- **`ai/provider.ts`:** `generateQuestion(photo, context)`와 `summarizeSession(messages, checkIn)` 계약을 정의해 모델 교체와 테스트 대체를 가능하게 한다.
- **`ai/gemini.ts`:** 서버에서만 AI API를 호출하고 타임아웃, 제한 재시도, JSON 파싱을 담당한다. 사용자 ID와 불필요한 개인정보는 전송하지 않는다.
- **`ai/fallback.ts`:** 사진 유형별 사전 질문과 AI 요약 실패 시의 중립적 기본 요약을 제공한다. 인물·장소·사건을 추정하지 않는다.
- **`storage.ts`:** 허용 MIME·실제 파일 형식·크기 검증, 안전한 객체명 생성, private 업로드·삭제를 담당한다.
- **`permissions.ts`:** 본인 소유권, 보호자 연결 활성 여부, 현재 공유 동의를 공통 검증한다. UI 조건만으로 권한을 구현하지 않는다.
- **`summaries.ts`:** AI 구조화 결과의 필드·길이·금지 표현을 검증한다. 검증 실패 시 fallback 결과를 사용한다.

### 3.3 환경 변수 및 배포 설정

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
AI_PROVIDER=gemini
GEMINI_API_KEY=
MAX_IMAGE_SIZE_MB=5
DATA_RETENTION_DAYS=90
```

`NEXT_PUBLIC_` 접두사는 브라우저 공개가 허용된 값에만 사용한다. API 비밀키는 서버 환경변수로만 관리하고 `.env.local`은 Git에 커밋하지 않는다. `.env.example`에는 변수명과 형식 예시만 둔다. Vercel 배포 환경과 로컬 개발 환경의 키를 분리하고, 로그나 오류 메시지에 비밀값이 노출되지 않도록 한다.

### 3.4 단계별 구현 계획

**1단계 — 핵심 회상 활동 MVP**
1. Next.js 프로젝트, Vercel 배포, Supabase 프로젝트 및 마이그레이션 구성
2. 로그인·동의 안내, 큰 글씨·고대비 홈, 허가된 예시 사진 선택 화면 구현
3. 세션 생성, AI 첫 질문, 사용자 답변 3턴 진행 및 매 턴 저장 구현
4. AI JSON 검증, 타임아웃·재시도·고정 질문 fallback 구현
5. 요약 생성·저장·재조회와 오류·저장 상태 안내 구현

**2단계 — PRD 기록·개인정보 기능**
1. 이미지 검증과 private Storage 업로드·삭제 구현
2. 복약·컨디션·선택 메모 입력 및 본인 기록 화면 구현
3. 동의 철회, 보관 기간, 세션 전체 삭제 및 삭제 결과 처리 구현
4. AI 요약을 참고용으로 표시하고 진단·위험 판단 금지 규칙과 테스트 보강

**3단계 — 보호자 공유와 배포 검증**
1. 보호자 인증, 일회성 초대, 어르신 승인·철회 흐름 구현
2. 연결 및 공유 동의가 모두 활성일 때 요약만 읽기 전용 제공
3. RLS·Storage 정책과 보호자 접근 거부 시나리오를 검증
4. 모바일·키보드 접근성, AI 실패, DB·Storage 오류 시나리오로 시연 리허설

### 3.5 테스트 및 완료 기준

| 요구·목표 | 검증 방법 | 완료 기준 |
|---|---|---|
| 사진 선택부터 3턴 대화·요약 확인 | 대표 시나리오 E2E 테스트 | 전체 흐름이 오류 없이 완료되고 세션·메시지·요약이 저장됨 |
| 턴 수와 중복 제출 방지 | 도메인·API 테스트 | 사용자 답변 최대 3개, 완료 세션의 추가 답변 거부 |
| AI 장애 대응 | 공급자 오류·타임아웃·잘못된 JSON 모킹 | 1회 재시도 후 fallback으로 진행 및 저장 가능 |
| 사용자 데이터 격리 | 다른 사용자 ID로 DB·Storage 접근 테스트 | 소유자가 아닌 요청은 거부됨 |
| 보호자 공유 | 미승인·철회·동의 철회 상태 테스트 | 활성 연결과 동의가 모두 있을 때 요약만 조회 가능 |
| 삭제·동의 철회 | DB 및 Storage 연계 테스트 | 철회 후 공유 차단, 삭제 후 관련 기록과 사진 삭제 확인 |
| 접근성·사용성 | 고령층 대상 사용성 테스트 | PRD의 참가자·성공률·시간·만족도 목표를 측정하고 결과 보고 |
| 비진단적 AI 출력 | 구조화 출력·금지 표현 테스트 | 진단·인지 점수·위험도·치료 권고를 노출하지 않음 |

PRD에 수치 목표가 정의되어 있다면 해당 수치(예: 참가자 6명 이상, 6명 중 5명 이상 대표 시나리오 성공, 완주 3분 이내, 만족도 평균 4.0점 이상, 보호자 요약 확인 1분 이내)를 그대로 테스트 보고서의 합격 기준으로 사용한다. 수치가 PRD에 명시되지 않은 경우 팀이 임의로 확정하지 말고 테스트 전에 합의한다. 테스트 보고서는 무작위 테스트 ID와 성공 여부·시간·설문 점수만 기록하고 실제 사진·대화 전문은 포함하지 않는다.

### 3.6 MVP 범위

**포함:** 로그인 및 동의, 예시 사진 선택, 동의 기반 사진 업로드, 사진 기반 질문, 답변 기반 3턴 회상 대화, 활동 기록 저장, 회상 키워드·요약, 복약·컨디션 직접 입력, 본인 기록 조회·삭제, 보호자 승인 기반 요약 공유, AI 장애 fallback, 고령층 친화적 UI.

**제외:** 실시간 음성 STT/TTS, 병원·공공기관 전산 연동, 인지기능 점수·치매 판정, 임상적 효과 주장, 보호자의 원본 사진·대화 전문 열람, 공개 공유 링크, 기관별 복잡한 관리자 기능.

---

## PRD 요구사항 추적표

| PRD 요구사항 | 구현 위치·설계 대응 |
|---|---|
| 추억 사진 등록 또는 예시 사진 선택 | 사진 선택 화면, `storage.ts`, private Storage, `sessions.photo_path` |
| 사진 참고 회상 질문 | `ai/provider.ts`, 서버 AI 라우트, 사진별 fallback |
| 답변에 맞춘 후속 질문·3턴 대화 | `conversation.ts`, `messages`, 턴 제한 API·테스트 |
| 사진 속 인물·상황을 단정하지 않음 | `ai/prompts.ts`, 출력 검증, 비단정 질문 테스트 |
| 대화 참여·키워드·날짜 기록 | `sessions`, `messages`, `summaries` |
| 보호자 활동 기록 확인 | 승인·활성 연결 및 동의 검증, 요약 읽기 전용 화면·RLS |
| 복약·컨디션 체크 | 세션 체크인 필드 및 직접 입력 화면 |
| 건강 언급 메모와 전문기관 안내 | `summaries.health_mention_note`, 고정 안내, 비진단 검증 |
| 동의 기반 사진·대화 저장·삭제 | `consent_records`, 삭제 API, Storage·DB 연계 삭제 |
| AI API 장애 대체 | 서버 재시도 1회, `ai/fallback.ts`, 장애 테스트 |
| 고령층 친화 UI | 큰 글씨·고대비·간결한 흐름·접근성 테스트 |

## 주요 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 무료 플랜 한도·정책 변경 | 배포 전 한도 재확인, 사용량 모니터링, 가상 데모 데이터 및 로컬 개발 fallback |
| 사진·건강 대화 노출 | 명시적 동의, 최소 수집, private Storage, RLS, 짧은 서명 URL, 삭제 기능 |
| AI의 부정확·유도 질문 | 비단정 프롬프트, 구조화 결과 검증, 고정 질문 fallback, 안전성 테스트 |
| 잘못된 보호자 권한 부여 | 어르신 명시 승인·철회, 요약만 공유, 서버 검증과 RLS 테스트 |
| 외부 AI 데이터 처리 조건 불명확 | 제공자 약관·보관·학습 설정 확인 전 실제 민감 정보 전송 금지 |
| Storage와 DB 삭제 부분 실패 | 삭제 상태 추적, 안전한 재시도, 사용자에게 결과 표시 |

**완료 판단:** 어르신이 동의 후 사진을 선택·업로드하고 회상 대화 3턴을 완료하며, 활동 요약과 직접 입력한 복약·컨디션을 확인할 수 있어야 한다. 기록은 사용자 권한에 맞게 저장·조회·삭제되어야 하며, 승인된 보호자는 유효한 공유 동의가 유지되는 동안 요약만 조회할 수 있어야 한다. AI·Storage·DB 장애 시에도 오류를 숨기지 않고 안전한 대체 흐름을 제공해야 한다.
