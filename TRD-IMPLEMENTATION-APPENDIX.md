# 정담이 TRD 구현 상세 부록

> 이 부록은 `TRD.md`의 구현 가능성을 높이기 위한 설계 기준이다. 아래 SQL·설정·테스트는 구현 시 기준으로 사용할 **제안 사양**이며, 실제 저장소에 코드·마이그레이션·CI가 추가되고 실행되기 전까지 구현 또는 테스트 완료를 의미하지 않는다. 외부 AI·배포 서비스의 요금과 한도는 도입 시점의 공식 문서로 다시 확인한다.

## 1. 환경별 배포 구성 및 실행 순서

### 1.1 환경 구분

| 환경 | 용도 | 데이터·비밀값 원칙 | 배포/검증 기준 |
|---|---|---|---|
| 로컬 | 개발 및 단위 테스트 | 로컬 `.env.local`; 가상 계정·샘플 이미지; 개발 Supabase 프로젝트 | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` 통과 |
| Preview | PR별 검토 | 별도 테스트 Supabase 프로젝트와 테스트 전용 AI 키 사용. 운영 DB·운영 사용자 데이터에 연결 금지 | 환경변수는 Preview scope로 분리하고 로그인·동의·3턴·저장 재조회 E2E 실행 |
| Demo/Production | 승인된 시연 또는 운영 | 별도 Supabase 프로젝트, 제한된 계정, 허가된 샘플만 사용. 비밀값은 배포 플랫폼의 환경변수에 저장 | 배포 전 RLS·삭제·동의 철회·AI fallback 확인. 배포 후 smoke test 및 로그 점검 |

환경별로 Supabase URL/anon key, 서버 전용 AI key, 허용된 origin, 저장소 버킷 및 데이터베이스를 분리한다. Preview 배포가 실제 사용자 데이터를 읽거나 쓰지 않도록 환경변수와 OAuth redirect URL을 확인한다. `service_role` 키는 일반 앱 요청에 설정하지 않는 것을 기본으로 하며, 꼭 필요한 별도 관리 작업에서만 제한된 실행 주체가 사용한다.

### 1.2 로컬 → Preview → 시연 배포 체크리스트

1. Node.js LTS와 패키지 매니저 버전을 저장소에서 고정하고 lockfile을 커밋한다.
2. `.env.example`을 복사해 로컬 환경값을 설정한다. 비밀값이 버전 관리 대상에 포함되지 않는지 확인한다.
3. 개발 Supabase 프로젝트에 마이그레이션을 적용하고 RLS를 활성화한다. 테스트 사용자 A/B로 소유자 접근 허용 및 교차 접근 거부를 검증한다.
4. 로컬에서 lint, typecheck, unit/integration test, production build를 실행한다.
5. PR Preview는 테스트 DB와 테스트 AI 공급자 설정만 사용한다. E2E smoke flow를 통과한 뒤 검토한다.
6. 시연 배포 전에는 가상 사용자·허가된 이미지, 동의 문구/문서 버전, AI 제공자 데이터 정책, 보관·삭제 동작을 점검한다.
7. 데모 계정은 개인별로 분리한다. 불가피하게 공용 계정을 쓰면 개인 식별·민감 정보는 입력하지 않고 초기화 가능한 가상 데이터만 사용한다.
8. 시연 후 계정·세션·사진 정리 결과를 확인하고 임시 자격 증명을 회전 또는 폐기한다.

### 1.3 공급자 대체안

- **Vercel 사용 불가:** 같은 Next.js 앱을 Node.js를 지원하는 다른 호스팅에 배포할 수 있다. 필수 조건은 HTTPS, 서버 런타임 환경변수, Next.js App Router/API Route 지원, 빌드·실행 로그 확인, Preview/Production 비밀값 분리다. 서버리스 로컬 파일시스템을 영속 저장소로 사용하지 않는다.
- **Supabase 사용 불가:** 프로토타입의 기본 대체안은 PostgreSQL + 인증 제공자 + 비공개 오브젝트 스토리지의 조합이다. 대체 시 DB 접근 계층, 사용자 JWT 검증, 행 단위 소유권 정책, 비공개 객체 권한, 삭제 재시도 및 통합 테스트를 재구현하기 전에는 민감 데이터 시연을 중단한다. SQLite 파일을 공개 배포의 동시 사용자 데이터 저장소로 대체하지 않는다.
- **AI 공급자 사용 불가:** provider adapter를 통해 고정된 비단정 질문 템플릿과 로컬 요약으로 진행한다. AI 기능을 비활성화해도 3턴 저장과 요약 재조회가 작동해야 한다.

## 2. 세션 상태 전이와 트랜잭션 경계

### 2.1 상태 정의

| 현재 상태 | 입력/조건 | 다음 상태 | 허용 동작 / 거부 조건 |
|---|---|---|---|
| `created` | 사진이 등록되고 저장·AI 동의가 유효 | `in_progress` | 첫 assistant 질문을 한 번만 저장한다. 사진 미등록·동의 철회 시 시작 거부 |
| `in_progress` | 예상 turn의 사용자 답변이 유효하게 저장 | `in_progress` | turn 1~2는 답변 저장 후 다음 질문 저장. 중복 idempotency key는 이전 응답 재사용 |
| `in_progress` | 세 번째 사용자 답변 저장 | `awaiting_summary` | 새 질문은 만들지 않는다. 요약 작업은 멱등하게 시작 가능 |
| `awaiting_summary` | 스키마 검증된 AI 요약 또는 fallback 요약 저장 | `completed` | summary 1개와 완료 시각을 원자적 완료 절차로 확정 |
| 진행 상태 | 복구 불가능한 오류·사용자 취소 | `failed` 또는 삭제 처리 | 오류를 기록하되 민감 본문·이미지 URL을 로그에 남기지 않는다. 재시도 가능한 오류는 진행 상태 유지 |
| `completed` | 추가 turn/요약 생성 요청 | 변경 없음 | `409` 반환. 완료 데이터는 수정 API 계약에서 별도 허용하지 않는 한 불변 |

DB `sessions.status`에는 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`를 사용하도록 제안한다. 기존 `sessions` 제약에 `in_progress/completed/failed`만 정의되어 있다면 마이그레이션에서 상태를 확장하고 클라이언트·테스트·API 표기를 함께 변경한다. 전이는 서버 측 함수/트랜잭션으로 검증하며 브라우저가 전달한 상태값은 신뢰하지 않는다.

### 2.2 원자성 및 재시도

- 사용자 답변 저장은 `(session_id, turn_number, role='user')`의 유일 제약과 세션 행 잠금 또는 조건부 갱신으로 한 번만 반영한다.
- idempotency 레코드는 사용자 ID, 세션 ID, key, 요청 해시, 응답 결과를 저장한다. 동일 key·동일 본문 재요청에는 저장된 결과를 반환하고, 동일 key·다른 본문은 `409`로 거절한다. key 원문은 민감하지 않은 무작위 값이어야 하며 보존 기간을 둔다.
- 외부 AI 요청을 DB 트랜잭션 안에서 기다리지 않는다. 답변 저장 후 작업 상태를 기록하고 AI 호출·응답 검증을 수행한 다음 결과를 조건부 저장한다. AI 실패는 fallback으로 완료한다.
- 답변·요약·세션 완료 상태는 각각 중복 요청에 안전해야 한다. 세션 완료는 3개의 user 답변과 유효한 summary가 모두 존재할 때만 허용한다.
- 사진 삭제와 DB 삭제는 하나의 분산 트랜잭션이 아니므로 `deletion_requests` 상태를 둔다. 객체 삭제 성공을 확인한 뒤 DB 행 삭제를 진행하고, 실패 시 요청 ID와 재시도 횟수만 남겨 재처리한다. 로그에는 객체 URL이나 콘텐츠를 남기지 않는다.

## 3. AI 요청·응답 스키마

모든 길이 제한은 UTF-8 바이트가 아닌 Unicode 코드 포인트 기준으로 애플리케이션에서도 검사한다. 실제 공급자 응답은 신뢰하지 않고 서버에서 JSON parse, JSON Schema/Zod 검증, 안전 규칙 검증을 모두 수행한다. 아래 스키마는 외부 공급자에 보내는 최소 필드와 서버가 수용하는 응답 계약이다.

### 3.1 첫 질문 요청 및 응답

요청 입력은 서버 내부에서만 만들며 로그인 정보·실명·연락처는 포함하지 않는다.

```json
{
  "photo_type": "sample",
  "image_reference": "server-resolved-image",
  "instruction": "사진에 보이는 내용만 조심스럽게 참고해 열린 질문 하나를 작성한다. 인물의 신원·관계, 날짜, 장소, 사건을 추측하지 않는다."
}
```

`image_reference`는 계약 설명용 placeholder이며 실제 URL 또는 Storage 경로를 AI에 전달하지 않는다. 서버가 승인된 이미지 바이너리를 공급자 SDK에 전달한다.

```json
{
  "question": "이 사진을 보시니 어떤 기억이 떠오르시나요?"
}
```

수용 규칙: `question`은 필수 문자열, 1~240자, 공백만인 값 금지. 응답 객체에 모르는 필드가 있으면 제거하거나 거부한다. 진단·위험도·인물 관계를 단정하는 문구, 개인 식별정보 요청, 유도성 질문은 표시하지 않고 한 번 재시도 후 고정 질문으로 대체한다.

### 3.2 후속 질문 요청 및 응답

```json
{
  "turn_number": 2,
  "current_answer": "그때 가족과 함께 바닷가에 갔어요.",
  "recent_context": [
    {"role": "assistant", "content": "이 사진을 보시니 어떤 기억이 떠오르시나요?"},
    {"role": "user", "content": "가족과 바닷가에 갔어요."}
  ]
}
```

```json
{
  "question": "그날 기억나는 장면이나 느낌이 있으신가요?"
}
```

요청은 현재 답변과 최대 최근 4개 메시지만 포함하고, 각 메시지는 최대 1,000자다. `turn_number`는 정수 2~3이며 다음 질문이 필요 없는 세 번째 답변에는 후속 질문 요청을 하지 않는다. 질문 검증은 첫 질문과 같은 길이·안전 규칙을 적용한다.

### 3.3 요약 요청 및 응답

```json
{
  "messages": [
    {"turn_number": 1, "content": "가족과 바닷가에 갔어요."},
    {"turn_number": 2, "content": "파도 소리가 기억나요."},
    {"turn_number": 3, "content": "즐거웠어요."}
  ],
  "checkin": {
    "medication_status": "not_recorded",
    "condition_status": "okay",
    "condition_note": null
  }
}
```

사용자 체크인은 AI 요약에 넣지 않고 별도 사용자 입력 데이터로 유지하는 것을 기본으로 한다. 요약 요청에 꼭 포함해야 하는 구현에서는 해당 사실을 사용자 제공 정보로 명시하고 AI 추론을 금지한다.

```json
{
  "recall_keywords": ["가족", "바닷가"],
  "activity_summary": "사용자는 가족과 바닷가에 갔던 기억과 파도 소리에 대한 느낌을 이야기했습니다.",
  "health_mention_note": null
}
```

수용 규칙: `recall_keywords`는 0~5개 문자열 배열, 각 1~40자; `activity_summary`는 필수 1~600자; `health_mention_note`는 null 또는 실제 발화의 중립적 요약 1~240자. 진단명, 인지 점수, 질환 가능성, 위험 등급, 치료·복약 권고를 포함하면 거부한다. 사용자 체크인 값을 대화 내용에서 추론하거나 덮어쓰지 않는다. AI 실패/스키마 오류 후 fallback은 사용자 발화에서 키워드 최대 3개를 추출하거나 중립적인 참여 요약을 만들며, 추론된 건강 메모는 항상 `null`이다.

## 4. 핵심 PostgreSQL 마이그레이션·RLS 기준안

> 아래는 핵심 P0 테이블을 새 테스트 프로젝트에 적용하는 기준안이다. 기존 DB에 바로 적용하지 말고 현재 스키마와 비교해 순차 마이그레이션으로 조정한다. 실제 적용 뒤 `supabase db reset` 또는 테스트 프로젝트에서 migration을 실행하고 아래 권한 테스트를 통과시켜야 완료로 본다.

```sql
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'senior' check (role in ('senior','caregiver')),
  created_at timestamptz not null default now()
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('data_storage','ai_processing','caregiver_sharing')),
  document_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);
create index if not exists consent_records_user_type_time_idx
  on public.consent_records(user_id, consent_type, granted_at desc);

create table if not exists public.sessions (
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
create index if not exists sessions_user_started_idx
  on public.sessions(user_id, started_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  turn_number smallint not null check (turn_number between 1 and 3),
  role text not null check (role in ('assistant','user')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique(session_id, turn_number, role)
);
create index if not exists messages_session_turn_idx
  on public.messages(session_id, turn_number, created_at);

create table if not exists public.checkins (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  medication_status text not null default 'not_recorded'
    check (medication_status in ('taken','not_taken','not_recorded')),
  condition_status text not null default 'not_recorded'
    check (condition_status in ('good','okay','unwell','not_recorded')),
  condition_note text check (condition_note is null or char_length(condition_note) <= 500),
  updated_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  participation_count smallint not null check (participation_count between 0 and 3),
  recall_keywords text[] not null default '{}',
  activity_summary text not null check (char_length(activity_summary) between 1 and 600),
  health_mention_note text check (health_mention_note is null or char_length(health_mention_note) <= 240),
  summary_source text not null check (summary_source in ('ai','fallback')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.checkins enable row level security;
alter table public.summaries enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy consent_select_own on public.consent_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy consent_insert_own on public.consent_records
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy sessions_select_own on public.sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_insert_own on public.sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy sessions_update_own on public.sessions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy sessions_delete_own on public.sessions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy messages_owner_all on public.messages
  for all to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = messages.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                      where s.id = messages.session_id and s.user_id = (select auth.uid())));
create policy checkins_owner_all on public.checkins
  for all to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = checkins.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                      where s.id = checkins.session_id and s.user_id = (select auth.uid())));
create policy summaries_owner_all on public.summaries
  for all to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = summaries.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                      where s.id = summaries.session_id and s.user_id = (select auth.uid())));

grant select, update on public.profiles to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.messages, public.checkins, public.summaries to authenticated;
```

이 정책은 P0 소유자 격리 기준안이다. 동의 여부와 상태 전이도 반드시 서버에서 확인한다. 직접 테이블 쓰기를 제한하고 싶은 배포에서는 관련 테이블의 `insert/update/delete` 권한을 철회하고 검증된 서버 함수/API만 쓰도록 선택한다. P2 보호자 조회 정책은 링크·공유 동의·projection 설계를 별도 migration 및 테스트로 추가하기 전에는 활성화하지 않는다. Storage 버킷은 private로 생성하고, 업로드 경로를 `{auth.uid()}/{random_uuid}` 형태로 제한하는 Storage RLS 정책을 별도 적용·검증한다.

## 5. 보관기간, 삭제 작업 및 요청 제한

### 5.1 보관기간 자동화

- `DATA_RETENTION_DAYS` 기본값은 90일이며 실제 운영 전 승인된 정책값으로 확정한다. 완료일 기준 만료 대상을 정기 작업에서 찾는다.
- 매일 03:00 UTC 실행을 제안한다. 작업은 만료 세션을 작은 batch(예: 100건)로 조회하고 삭제 요청을 생성한 뒤 Storage 객체 삭제 → DB 행 삭제 순서로 처리한다.
- 실패한 항목은 `deletion_requests`에서 `pending/retry/complete/failed` 상태, 시도 횟수, `next_attempt_at`, 안전한 오류 코드만 보존한다. 지수 backoff(예: 1분, 5분, 30분, 이후 최대 6시간)를 적용하고 작업 재실행은 멱등해야 한다.
- 작업 성공률·대상 수·실패 수·오래된 pending 수만 모니터링한다. 사진 경로·메시지 내용은 로그에 기록하지 않는다. 사용자 요청 삭제는 보관 만료 작업과 별도 우선순위로 처리한다.
- 백업 및 AI 제공자의 잔존 정책은 앱 DB 삭제와 별개로 고지·검증한다. 제공자 삭제를 보장할 수 없으면 민감정보 전송을 중단한다.

### 5.2 기본 API 제한값

아래는 해커톤 초기 안전 기본값이며 실제 배포 한도·공급자 제한에 맞춰 조정하고 환경 변수/서버 설정으로 관리한다.

| 대상 | 초기 제한값 | 초과 처리 |
|---|---:|---|
| JSON 요청 본문 | 최대 64 KiB | `413` |
| 답변 본문 | 최대 4,000자 | `400` |
| 조건 메모 | 최대 500자 | `400` |
| 사진 업로드 | 최대 5 MiB, JPEG/PNG/WebP만 | `413` 또는 `415` |
| 목록 페이지 | 기본 20, 최대 50개 | 초과 시 `400` |
| AI 호출 | 공급자별 timeout 15초, 동시 2개/사용자 | timeout 후 1회만 재시도, 이후 fallback |
| 로그인 사용자 API | 사용자별 60회/분 | `429`, `Retry-After` 포함 |
| 사진 업로드 | 사용자별 10회/시간 | `429` |
| AI 생성 호출 | 세션별 turn당 2회(최초+재시도), 사용자별 20회/시간 | 제한 시 fallback 또는 `429` 정책 적용 |
| 초대 코드 발급 (P2) | 사용자별 5회/시간, 코드 만료 15분·일회성 | `429` |

rate limit은 서버에서 사용자 ID와 작업 종류를 기준으로 적용한다. 배포 인스턴스 여러 개에서 일관되도록 공유 저장소/플랫폼 제한 기능을 사용하고, 프로세스 메모리 카운터만 운영 제한 수단으로 사용하지 않는다. 응답 헤더와 사용자 메시지에 재시도 가능 시각을 제공하되 내부 키나 제한 데이터는 노출하지 않는다.

## 6. CI 및 검증 증거 기준

### 6.1 PR 필수 검사

CI는 lockfile 기반 설치 후 순서대로 lint, typecheck, unit tests, migration 검증, production build를 실행한다. 테스트 DB 비밀값은 GitHub Actions secrets에만 둔다. Preview E2E는 별도 테스트 프로젝트와 가상 데이터로 실행하며 실패 시 배포를 승인하지 않는다.

```yaml
# .github/workflows/ci.yml 예시 — 실제 저장소의 스크립트 이름에 맞춰 조정
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
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test -- --run
      - run: npm run build
```

예시 workflow는 제안 템플릿이며 `package.json` 스크립트와 Node LTS 버전에 맞춰 실제 저장소에 적용해야 한다. `--if-present`는 초기 편의용이므로 테스트 단계가 정착되면 필수 스크립트로 바꾸고 생략이 CI 성공으로 처리되지 않게 한다. Migration CI에서는 빈 테스트 DB에 전체 migration을 적용하고, RLS 테스트는 실제 authenticated JWT로 실행한다.

### 6.2 최소 자동 테스트 매트릭스

| 테스트 | 준비 | 기대 결과 |
|---|---|---|
| 소유권 RLS | 사용자 A/B의 JWT와 A 소유 세션 | A는 조회 가능, B는 조회 결과 없음/권한 오류, B의 update/delete 불가 |
| 동의 가드 | 저장 또는 AI 동의 없음/철회 상태 | 세션 생성·사진 업로드·AI 호출 모두 거부, 데이터 미생성 |
| 전이·턴 제한 | 정상 순서, turn 건너뜀, 4번째 답변, completed 세션 재요청 | 정상만 허용, 그 외 `409`, 중복 row 없음 |
| 멱등성 | 동일 key·동일 본문 재전송, 동일 key·다른 본문 재전송 | 첫 요청과 같은 결과 재응답, 다른 본문은 `409` |
| AI 스키마·안전 | 잘못된 JSON, 누락 필드, 과도한 길이, 진단/관계 단정 문구, timeout | 위험 출력 미노출, 한 번 재시도 후 fallback, 핵심 흐름 완주 |
| 이미지 검증 | 허용 이미지, MIME 위장, 손상 파일, 과대 파일, SVG | 유효 파일만 수용, 나머지는 적절한 `400/413/415` |
| 요약/완료 원자성 | 요약 저장 실패, 중복 complete | 완료 상태가 거짓으로 설정되지 않음, 재시도 가능 |
| 삭제 재처리 | Storage 실패 후 재시도, 이미 삭제된 객체 재요청 | 완료 전 성공 미표시, 반복 실행 시 최종 상태 수렴 |
| 보관 작업 | 만료/미만료 세션과 삭제 실패 객체 | 만료 대상만 enqueue, 실패 상태 추적, 개인정보 로그 없음 |

테스트 결과는 CI run URL, commit SHA, 통과/실패 건수와 테스트 환경만 기록한다. 대화 전문·사진·실사용자 식별정보를 artifact나 로그에 저장하지 않는다. 수용 테스트는 자동 테스트와 별도로 참가자 수, 성공률, 완주 시간, 만족도 실제 측정치를 보고하며 미실행 목표는 “미검증”으로 표시한다.

## 7. 완료·미완료 판정

TRD의 설계 상세를 추가하는 것만으로 100점 또는 실제 구현 완료를 보장할 수 없다. 평가에서 지적된 `source_sample` 및 실행 증거를 보완하려면 실제 코드 변경과 함께 아래 증거를 저장소/제출 자료에 포함해야 한다.

- migration 파일 및 테스트 DB 적용 결과
- RLS positive/negative access 자동 테스트 결과
- 실행된 CI workflow URL과 성공 commit SHA
- Preview/Demo 환경의 배포 URL 및 smoke test 결과(비밀값 제외)
- 6명 이상 사용성 테스트 결과(가명 ID, 수치만)
- 테스트되지 않은 P1/P2 기능 및 남은 위험 목록

설계서의 수치·SQL·테스트 예시는 구현 전에 검증해야 할 기준이다. 실행하지 않은 항목을 완료로 표시하지 않는다.
