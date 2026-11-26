# 정담이 기술 설계서 (TRD)

- **팀명:** 기억배달부
- **서비스명:** 정담이
- **기반 문서:** `PRD.md` (정담이 해커톤 팀 아이디어 PRD)
- **문서 목적:** PRD의 사용자 흐름·요구사항을 구현 가능한 아키텍처, API, 데이터 모델, 보안 정책, 테스트 기준으로 구체화한다.
- **대상 범위:** 해커톤 웹 프로토타입 및 시연
- **설계 원칙:** 핵심 사용자 가치 우선, 빠른 프리뷰 배포, 최소 데이터 수집, 명시적 동의, 서버 측 권한 검증, 비진단적 AI 사용

> 본 문서는 프로토타입 기술 설계이며 의료기기·임상 진단 시스템 설계가 아니다. AI 결과는 인지활동과 일상 건강 변화에 관한 참고용 요약으로만 표시한다. 질환·인지기능·긴급도를 판정하지 않는다.

## 목차

- [0. PRD와의 정합성 및 구현 우선순위](#0-prd와의-정합성-및-구현-우선순위)
- [1. 시스템 아키텍처](#1-시스템-아키텍처)
- [2. 데이터 흐름과 기능 계약](#2-데이터-흐름과-기능-계약)
- [3. API 명세](#3-api-명세)
- [4. 데이터 저장 구조](#4-데이터-저장-구조)
- [5. 저장소 구성 및 구현 계약](#5-저장소-구성-및-구현-계약)
- [6. 단계별 구현 및 범위 관리](#6-단계별-구현-및-범위-관리)
- [7. 테스트 계획 및 PRD 완료 기준](#7-테스트-계획-및-prd-완료-기준)
- [8. 개인정보·AI 안전 및 배포 체크리스트](#8-개인정보ai-안전-및-배포-체크리스트)
- [9. 주요 리스크 및 완료 판단](#9-주요-리스크-및-완료-판단)
- [10. 구현 상세 부록](#10-구현-상세-부록)

## 0. PRD와의 정합성 및 구현 우선순위

### 0.1 기술 스택 변경과 기능 범위

PRD의 Python·Streamlit·로컬 SQLite는 짧은 기간에 단일 환경에서 안정적으로 시연하기 위한 선택이다. 본 TRD는 브라우저 기반 시연의 빠른 프리뷰 배포, 인증 사용자 간 데이터 분리, 사진의 비공개 저장 및 관계형 기록 관리를 우선해 **Next.js + Vercel + Supabase(PostgreSQL/Auth/Storage)** 구조를 선택한다. 이는 구현 기술의 변경이며 PRD의 제품 범위나 완료 기준을 바꾸는 것이 아니다. Next.js의 화면·서버 API, Supabase의 관계형 DB·RLS·비공개 Storage를 조합해 회상 세션/메시지/요약의 관계 관리, 사진 보호, 보호자 요약 분리를 구현한다. Vercel Hobby 및 Supabase Free는 시작 후보일 뿐 무료 이용 가능성·한도·지역·상업적 이용 조건은 배포 시점의 공식 정책을 확인한다.

**PRD의 개발 순서와 핵심 완료 기준은 그대로 유지한다.** 1차 핵심 시연에서 예시 또는 업로드 사진 선택 → 사진을 참고한 질문과 사용자 답변 3턴 → 회상 키워드·요약·복약/컨디션 입력 저장 → 활동 요약 재확인을 완성한다. AI 장애 시에도 fallback 질문으로 이 흐름을 끝까지 수행한다. 보호자 공유와 세밀한 다중 사용자 권한 기능은 핵심 시연 안정화 후 단계적으로 추가한다.

PRD의 정량 기준은 이 문서 §7의 검증 기준으로 직접 추적한다: 사용성 테스트 6명 이상, 6명 중 5명 이상 대표 시나리오 성공, 3턴 완주, 완료 기록 100% 저장, 1회 3분 이내, 만족도 평균 4.0/5 이상, 보호자 기록 확인 평균 1분 이내. 비단정 질문, 전문기관 고정 안내, 동의 전 처리 금지 및 사용자 삭제 요청은 기능 요구사항이자 테스트 항목이다. 목표 달성 여부는 실제 테스트 결과로 보고하며 설계서만으로 달성을 보장하지 않는다.

### 0.2 MVP 우선순위

| 우선순위 | 범위 | 완료 판단 |
|---|---|---|
| P0 — 1차 시연 필수 | 예시 사진 선택, 사진 업로드, 동의 확인, 3턴 대화, AI 및 fallback, 키워드/요약 생성, 복약·컨디션 입력, DB 저장 및 다시 조회 | 어르신 대표 흐름을 새로고침 후에도 재확인할 수 있고 AI 실패에도 세션 완료 가능 |
| P1 — 안전·운영 필수 | 인증, 본인 데이터 격리, 사진 비공개 저장, 삭제, 입력/출력 검증, 오류·재시도 안내 | 비인가 접근 차단, 동의 철회/삭제 결과 확인, 안전 테스트 통과 |
| P2 — 단계적 확장 | 보호자 초대·어르신 승인·공유 동의·요약 전용 조회·철회, 고도화된 RLS 및 E2E | 관계와 동의가 모두 활성일 때만 요약을 열람하고 철회 즉시 차단 |

P0 시연 전에 P2를 완성해야 한다고 전제하지 않는다. 다만 공개 배포 또는 실제 사용자 데이터 처리 전에는 P1의 인증·권한·동의·삭제 안전장치를 생략하지 않는다. 기능 축소가 필요하면 보호자 공유를 먼저 제외하고 핵심 흐름과 데이터 보호를 유지한다.

---

## 1. 시스템 아키텍처

### 1.1 기술 스택

| 영역 | 선택 | 적용 이유 및 범위 |
|---|---|---|
| 웹 UI·서버 API | Next.js (App Router) + TypeScript | 화면과 서버 측 API를 한 저장소에서 구현하고, 브라우저에 비밀키를 노출하지 않는다. |
| 배포·프리뷰 | Vercel Hobby 후보 | Git 연동 및 PR 프리뷰 배포로 팀 검토·시연 반복을 단순화한다. 플랜 한도/자격·이용 조건을 배포 전 공식 문서에서 확인한다. |
| DB·인증·사진 | Supabase PostgreSQL, Auth, private Storage | 세션-메시지-요약 관계, 사용자 인증, RLS 기반 데이터 분리, 비공개 사진 보관을 한 서비스로 제공한다. |
| AI | Gemini API 등 팀이 선택한 멀티모달 생성형 AI | 사진 기반 첫 질문, 답변 기반 후속 질문, 세션 요약에 사용한다. 서버 API에서만 호출하고 개인정보를 최소화한다. |
| 검증·테스트 | Zod, Vitest/Jest, Playwright(단계 적용) | API 입력/AI JSON 스키마 검증, 핵심 규칙 단위 테스트, 대표 브라우저 흐름 검증에 사용한다. |

**무료 플랜 전제:** 무료 플랜은 프로토타입 시작을 위한 후보이며 가용성, 지역, 사용량, 저장 한도, 앱 절전, 프리뷰 제한 및 약관은 바뀔 수 있다. 예산·운영 수준에 필요한 조건을 배포 직전에 확인하고, 한도를 넘으면 공개 서비스로 간주하지 말고 시연 데이터를 정리하거나 유료/대체 구성을 검토한다.

공식 안내: [Vercel 요금](https://vercel.com/pricing), [Supabase 요금](https://supabase.com/pricing), [Next.js 문서](https://nextjs.org/docs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

### 1.2 시스템 구성

```text
[어르신 브라우저]                         [보호자 브라우저 — P2]
        │ HTTPS                                  │ HTTPS
        └──────────────────┬─────────────────────┘
                           ▼
                  [Vercel / Next.js]
          ├─ 어르신·보호자 화면 및 서버 API
          ├─ 인증 세션 확인, 동의·입력 검증
          ├─ 3턴 상태 전이와 저장 결과 처리
          └─ 서버 전용 Supabase/AI 어댑터
               │                 │                 │
               ▼                 ▼                 ▼
       [Supabase Auth] [PostgreSQL + RLS] [AI API]
                               │              질문/후속/요약
                               ▼
                     [Supabase private Storage]
                           사진 객체
```

브라우저는 Supabase 사용자 세션으로 인증하며, 사용자 데이터 요청은 해당 사용자의 JWT/RLS 정책 아래 처리한다. AI 키와 Supabase `service_role` 키는 서버 환경변수에만 둔다. 사용자 요청 경로에서 `service_role`로 RLS를 우회하지 않는다. 필요한 관리자 작업은 사용자 API와 분리된 제한된 환경에서만 수행한다.

### 1.3 역할과 접근 범위

- **어르신(senior):** 본인의 동의, 사진, 세션, 메시지, 요약, 복약·컨디션 기록을 생성·조회·삭제한다.
- **보호자(caregiver, P2):** 어르신의 초대·승인, 활성 연결, 현재 공유 동의가 모두 유효한 경우에 한해 허용된 요약만 읽는다. 원본 사진·대화는 열람하지 않는다.
- **담당자(staff):** MVP에서 기관별 다중 사용자 관리 기능을 구현하지 않는다.

`role` 값이나 화면 숨김만으로 권한을 부여하지 않는다. 보호자 접근은 활성 `caregiver_links`와 유효한 공유 동의를 매 요청 서버/RLS에서 확인한다. P2가 아직 구현되지 않은 배포에서는 보호자 화면·경로를 노출하지 않는다.

### 1.4 화면 전환 및 사용자 흐름

```text
어르신: 홈 → 동의 안내/확인 → 사진 선택(예시 또는 업로드)
      → 회상 대화(질문/답변 1~3턴) → 오늘 기록(복약/컨디션)
      → 활동 요약(저장 결과 확인) → 홈/기록 목록

보호자(P2): 로그인 → 연결 상태 확인/초대 코드 입력
           → 어르신 승인 및 공유 동의 확인 → 요약 목록 → 요약 읽기
           → 연결 해제(어르신) 시 즉시 접근 차단
```

해커톤 시연에서는 로그인 시간을 줄이기 위해 사전 준비한 데모 계정 또는 참여자별 체험 계정을 사용할 수 있다. 데모 계정도 일반 흐름과 동일하게 인증, 동의 확인, 세션 소유권 및 권한 검증을 거치며 인증·동의를 우회하는 데모 모드는 제공하지 않는다. 시연 데이터는 가상 사용자와 사용 허가된 예시 사진으로 제한하고, 계정 간 데이터가 분리되도록 한다. 공용 계정을 여러 참가자가 동시에 사용해야 하는 경우에는 개인 기록을 입력하지 않고 시연용 가상 데이터만 사용한다.

| 화면 | 주요 동작 | 성공/예외 처리 |
|---|---|---|
| 홈·로그인 | 로그인, 새 회상 시작, 기록 목록 | 인증 실패 시 오류를 알리고 민감 데이터는 표시하지 않음 |
| 동의·사진 선택 | 목적/보관/AI 전송 안내, 동의 기록, 예시 또는 업로드 사진 선택 | 동의 전에는 업로드·AI 호출·세션 생성 금지. 업로드 실패 시 재선택 가능 |
| 회상 대화 | 현재 질문, 큰 답변 입력, 턴 표시, 전송 | 답변 저장 확인 후 다음 질문. AI 실패는 fallback으로 전환하고 오류 표식을 내부 상태에 기록 |
| 오늘 기록 | 복약 상태·컨디션 및 선택 메모 입력 | 사용자 직접 입력만 저장; 저장 실패 시 성공 처리하지 않고 입력을 유지해 재시도 |
| 활동 요약 | 날짜, 턴 수, 키워드, 요약, 직접 입력한 체크 내용, 비진단 안내 | DB에서 다시 읽어 보여주고 AI 생성 문구임을 표시 |
| 기록·동의 관리 | 공유/AI/저장 동의 철회, 기록 삭제 | 확인 단계 및 처리 결과를 표시. 일부 삭제 실패 시 재시도 가능한 상태로 안내 |
| 보호자(P2) | 초대, 승인, 요약 목록, 연결 해제 | 연결 또는 공유 동의가 없거나 철회된 요청은 서버에서 거부 |

---

## 2. 데이터 흐름과 기능 계약

### 2.1 동의·인증·보호자 연결

1. Supabase Auth에서 사용자를 인증하고 모든 데이터에 인증 사용자 UUID를 연결한다.
2. 어르신에게 저장 및 AI 전송 목적, 전달 데이터, 보관/삭제 방법을 쉬운 문장으로 안내한다. 저장·AI 처리 동의가 없으면 사진 업로드, 세션 생성, AI 요청을 허용하지 않는다. 동의 문서 버전과 시각을 기록한다.
3. 보호자 연결(P2)은 어르신이 발급한 만료·일회성 무작위 코드, 보호자의 인증된 입력, 어르신의 최종 승인 순서로 처리한다. 코드 원문은 DB·로그에 저장하지 않고 해시만 저장한다.
4. 어르신은 공유 동의 또는 연결을 언제든 철회한다. 이후 모든 보호자 요청은 즉시 거부하고 종료 시각을 기록한다. 공개 링크 공유는 제공하지 않는다.

### 2.2 사진 기반 3턴 대화

1. 사용자가 예시 사진을 선택하거나 업로드한다. 업로드는 JPEG/PNG/WebP 허용, 실제 파일 시그니처·크기·MIME 확인, 최대 크기 설정(기본 5 MB), UUID 객체명, 비공개 버킷을 사용한다. SVG 및 실행 가능 형식은 거부한다.
2. 서버는 동의와 사용자 소유권을 확인한 후 `sessions`를 생성하고 Storage 경로를 저장한다. 업로드되지 않은 세션은 진행 가능한 상태로 표시하지 않는다.
3. 첫 질문은 사진 1장과 최소 안전 프롬프트로 생성한다. 사용자 식별 정보, 로그인 정보, 보호자 정보는 AI에 보내지 않는다.
4. 각 답변은 서버가 세션 소유권, 세션 상태, turn 범위, 입력 길이를 검증한 다음 저장한다. 답변 저장 성공 후에만 후속 질문을 생성·저장한다. 요청 중복은 idempotency key 또는 turn 상태 확인으로 중복 저장을 방지한다.
5. 세 번째 답변 저장 후 키워드·활동 요약·건강 언급 메모 초안을 만든다. AI 호출 실패 시 로컬 기본 요약을 저장하고 `summary_source=fallback`으로 구분한다.
6. 질문은 사용자의 설명을 우선하고 “혹시”, “기억나시는 부분이 있다면”처럼 비단정적으로 작성한다. 사진 속 인물의 신원·관계, 날짜·장소·사건을 사실처럼 추측하지 않는다.
7. AI 타임아웃/오류/스키마 위반은 짧은 제한 시간으로 한 번 재시도하고 fallback으로 전환한다. 사용자에게 재시도 중임을 알리며 fallback도 실패하면 질문 템플릿으로 계속 진행한다.

### 2.3 복약·컨디션 및 요약

- 복약·컨디션은 어르신이 직접 선택·입력한다. 대화만으로 복약 여부를 추론하거나 자동 기록하지 않는다.
- 기록 화면과 요약 화면에서 사용자 입력값과 AI 요약을 시각적으로 구분한다.
- `health_mention_note`는 대화에 실제로 나온 불편 표현의 짧은 참고용 정리 또는 `null`이다. 진단명, 치매 가능성, 점수·위험도, 치료법을 포함하지 않는다.
- 전문 상담이 필요한 경우 AI 판단이 아닌 고정 안내 문구로 보건소·치매안심센터·의료기관 등 전문기관 상담을 안내한다. 응급도 분류는 제공하지 않는다.
- 보호자(P2)에는 연결·동의가 유효한 동안 요약·직접 입력 체크 항목만 읽기 전용으로 제공한다. 사진과 원본 메시지는 제외한다.

### 2.4 AI 입출력 계약

서버는 요청에 필요한 최소한의 데이터만 전송한다. 첫 질문은 이미지 1장·사진 유형·안전 지침, 후속 질문은 현재 답변과 최근 최소 문맥, 요약은 해당 세션의 메시지 및 필요한 경우 사용자 직접 체크값만 사용한다. 실명, 전화번호, 주소, 계정 자격 증명, 보호자 연락처, 타 사용자 기록은 보내지 않는다.

AI 응답은 Zod 등으로 JSON 스키마를 검증한 뒤 사용한다. 대화 호출은 `question`만 필수이며, 요약 호출은 `recall_keywords`, `activity_summary`, `health_mention_note` 필드를 검증한다. 필드 누락·형식 오류·안전 위반은 한 번 재시도한 뒤 안전한 기본 질문/요약으로 대체한다. 모든 AI 문구에는 생성형 AI 참고용임을 표시한다.

```json
{
  "question": "그때 어떤 일이 있었는지 기억나시는 부분부터 들려주시겠어요?",
  "recall_keywords": ["가족", "여행"],
  "activity_summary": "사용자가 사진과 관련한 가족 여행의 기억을 이야기했습니다.",
  "health_mention_note": null
}
```

### 2.5 실패·재시도 정책

| 상황 | 서버 동작 | 사용자에게 보이는 처리 |
|---|---|---|
| AI 타임아웃/API 키 오류 | 1회 제한 재시도 후 고정 질문 또는 기본 요약 | “기본 질문으로 계속 진행합니다.” 안내, 답변·저장은 계속 가능 |
| AI JSON/안전 검증 실패 | 스키마 검증, 재시도 1회 후 fallback | 부적절한 출력은 표시하지 않음 |
| 사진 업로드 실패 | 세션 완료 금지, Storage 오류 기록(본문·사진 URL 로그 금지) | 사진 재선택/재시도 안내 |
| 메시지/체크인 저장 실패 | 완료 상태·성공 표시 금지, 요청 중복 방지 키 사용 | 입력을 임시 유지하고 재시도 버튼 제공 |
| 요약 저장 실패 | 세션 완료로 확정하지 않음. 요약 생성 재시도 가능 상태 유지 | 기록이 아직 저장되지 않았음을 명시 |
| 로그인 만료/권한 없음 | 요청 거부, 데이터 반환 금지 | 재로그인 또는 연결 승인 안내 |
| 네트워크 오류 | 현재 단계 유지, 중복 제출 방지 | 같은 작업을 안전하게 재시도하도록 안내 |
| 부분 삭제 실패 | 삭제 요청 상태와 남은 객체 식별자를 서버에 기록하고 재시도 | 삭제 완료라고 표시하지 않고 처리 중/실패를 명시 |

---

## 3. API 명세

모든 애플리케이션 API의 기준 경로는 `/api/v1`이다. 아래 표에는 실제 경로를 모두 이 접두사와 함께 표기한다. JSON 요청/응답을 사용하며 사진 업로드는 multipart/form-data 또는 서버 발급의 제한된 업로드 절차 중 구현 난이도에 맞춰 선택한다. API는 인증 사용자 세션을 검증하고 입력 스키마·소유권·동의·상태 전이를 확인한다. 타 사용자 리소스는 존재 여부가 드러나지 않도록 404 또는 일관된 권한 오류로 응답한다. AI·Storage 비밀값은 브라우저 응답에 포함하지 않는다.

| Method / path | 목적·요청 핵심 필드 | 인가·검증 조건 | 성공 응답 / 주요 오류 |
|---|---|---|---|
| `GET /api/v1/me` | 현재 사용자·역할 조회 | 유효한 로그인 세션 | `{user}` / `401` |
| `POST /api/v1/consents` | `{consent_type, granted, document_version}` 동의/철회 기록 | 본인만; 허용된 consent type, 현재 상태와 순서 검증 | `{consent}` / `400`, `401` |
| `POST /api/v1/sessions` | `{photo_source, sample_id?}` 세션 시작 | 본인 인증; 저장·AI 동의 활성; 예시 ID 허용 목록 검증 | `{session_id,status}` / `400`, `401`, `403` |
| `POST /api/v1/sessions/{id}/photo` | 업로드 사진 등록 | 세션 소유자; 이미지 디코드·MIME·크기 검사; 동의 확인 | `{photo_attached:true}` / `400`, `403`, `413`, `415`, `5xx` |
| `POST /api/v1/sessions/{id}/turns` | `{answer, turn_number, idempotency_key}` 답변 제출 및 다음 질문 요청 | 세션 소유자·`in_progress`; turn은 1~3, 답변 길이 제한, 중복 키·동의 검증 | `{saved_turn,next_question,status}` / `400`, `403`, `409`, `5xx` |
| `POST /api/v1/sessions/{id}/complete` | 완료된 대화 요약 생성/저장 | 세션 소유자; 답변 3개 확인; 요약 중복 생성 방지 | `{summary,status}` / `403`, `409`, `5xx` |
| `PATCH /api/v1/sessions/{id}/checkin` | `{medication_status,condition_status,condition_note?}` 저장 | 세션 소유자; enum 및 길이 검증; 직접 입력만 반영 | `{checkin}` / `400`, `403`, `409`, `5xx` |
| `GET /api/v1/sessions` | 본인 세션 목록 조회 | 본인 인증; 페이지 크기 제한 | `{items,next_cursor}` / `401` |
| `GET /api/v1/sessions/{id}` | 세션·메시지·요약 조회 | 본인 또는 P2 공유 권한; 세션 소유권·공유 동의 검증 | `{session,messages,summary}` / `403` 또는 `404` |
| `DELETE /api/v1/sessions/{id}` | 세션·메시지·요약·사진 삭제 요청 | 본인 재확인; 소유권 확인; Storage/DB 부분 실패 추적 | `{deletion_status,request_id}` / `403`, `404`, `5xx` |
| `POST /api/v1/caregiver/invitations` (P2) | 초대 코드 발급 | 어르신 본인; 활성 공유 동의 확인; 만료·호출 제한 | `{invitation,expires_at}` / `403`, `429` |
| `POST /api/v1/caregiver/accept` (P2) | `{code}` 초대 수락 요청 | 보호자 인증; 해시 일치·미만료·미사용 확인. 수락만으로 활성화하지 않음 | `{link_status:"pending_senior_approval"}` / `400`, `404`, `410` |
| `POST /api/v1/caregiver/links/{id}/approve` (P2) | 어르신 최종 승인 | 해당 어르신 계정만; 공유 동의 활성 | `{status:"active"}` / `403`, `409` |
| `DELETE /api/v1/caregiver/links/{id}` (P2) | 연결 철회 | 어르신 본인; 이후 조회 즉시 차단 | `{status:"revoked"}` / `403`, `404` |
| `GET /api/v1/caregiver/summaries` (P2) | 공유 허용 요약 목록 | caregiver 본인 + active link + 공유 동의 활성; 요약 전용 projection | `{items,next_cursor}` / `403`, `401` |

응답 상태의 의미: `400` 입력 오류, `401` 미인증, `403` 동의/권한 거부, `404` 미존재 또는 타 사용자 리소스, `409` 잘못된 상태 전이·중복 요청, `413` 파일 크기 초과, `415` 지원하지 않는 형식, `429` 요청 제한, `5xx` 일시적 서버/외부 서비스 오류. 클라이언트는 `5xx`에서 재시도 가능 여부를 표시하되 저장되지 않은 데이터를 성공으로 간주하지 않는다.

**서버 처리 계약:** API route는 UI 상태를 신뢰하지 않고 사용자 세션과 DB 소유권을 다시 확인한다. 요청 본문 크기·문자 수·페이지 크기·AI 호출 시간에 제한을 둔다. 오류 응답과 로그에는 사진, 대화 전문, 토큰, 초대 코드, API 키를 포함하지 않는다. AI 호출은 서버에서만 수행하며 timeout, 제한된 재시도, fallback을 공통 어댑터로 처리한다.

---

## 4. 데이터 저장 구조

### 4.1 원칙·보관·삭제

- 사진 바이너리는 DB가 아닌 비공개 Supabase Storage에 둔다. DB에는 객체 경로만 저장한다.
- 최소 데이터만 저장한다. 시연은 가상 사용자 또는 명시적으로 사용 허가를 받은 사진·데이터만 사용한다.
- 동의 전 업로드·AI 호출·저장을 금지한다. 문서 버전, 동의 시각, 철회 시각을 기록한다.
- 기본 보관 기간은 세션 완료 후 90일로 제안한다. 운영 전 개인정보 담당자 검토 후 확정하고 만료 데이터는 삭제 작업으로 처리한다.
- 삭제는 확인 후 Storage 사진과 DB의 메시지·요약·세션을 함께 처리한다. 삭제 상태가 완결되기 전 성공으로 표시하지 않는다. 백업·제공자 보관 정책도 사전 고지한다.
- AI 제공자 데이터 보관·학습 설정을 배포 전에 확인한다. 확인할 수 없으면 실제 민감 데이터를 전송하지 않는다.
- 앱 로그에 대화 전문, 사진 URL, 토큰, 초대 코드, API 키를 남기지 않는다.

### 4.2 논리 모델

```text
auth.users 1:1 profiles
profiles 1:N consent_records
profiles 1:N sessions 1:N messages
sessions 1:1 summaries
profiles senior_user_id / caregiver_user_id → caregiver_links (P2)
```

### 4.3 테이블 정의

| 테이블 | 주요 컬럼 및 제약 |
|---|---|
| `profiles` | `id UUID PK/FK auth.users`, `display_name TEXT NULL`, `role TEXT CHECK senior/caregiver`, `created_at TIMESTAMPTZ` |
| `consent_records` | `id UUID PK`, `user_id UUID FK`, `consent_type TEXT CHECK data_storage/ai_processing/caregiver_sharing`, `document_version TEXT`, `granted_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ NULL`; 철회 이력은 새 행 또는 명확한 이력 정책으로 보존 |
| `caregiver_links` (P2) | `id UUID PK`, `senior_user_id UUID FK`, `caregiver_user_id UUID FK NULL`, `invite_code_hash TEXT NULL`, `invite_expires_at TIMESTAMPTZ NULL`, `status CHECK pending/active/revoked/expired`, `approved_at`, `revoked_at`, `created_at`; 코드 원문 저장 금지 |
| `sessions` | `id UUID PK`, `user_id UUID FK`, `started_at`, `completed_at NULL`, `status CHECK in_progress/completed/failed`, `photo_path TEXT NULL`, `photo_source CHECK sample/upload`, `medication_status CHECK taken/not_taken/not_recorded NULL`, `condition_status CHECK good/okay/unwell/not_recorded NULL`, `condition_note TEXT NULL`, `created_at`; 3답변 및 요약 저장 이후 완료 전이 |
| `messages` | `id UUID PK`, `session_id UUID FK ON DELETE CASCADE`, `turn_number SMALLINT CHECK 1..3`, `role CHECK assistant/user`, `content TEXT`, `created_at`; 동일 turn/role 중복 방지 제약 적용 |
| `summaries` | `id UUID PK`, `session_id UUID UNIQUE FK ON DELETE CASCADE`, `participation_count SMALLINT CHECK 0..3`, `recall_keywords TEXT[]`, `activity_summary TEXT`, `health_mention_note TEXT NULL`, `summary_source CHECK ai/fallback`, `created_at` |

### 4.4 인덱스·삭제 및 접근 제어

- 인덱스: `sessions(user_id, started_at DESC)`, `messages(session_id, turn_number, created_at)`, `caregiver_links(caregiver_user_id,status)`.
- 메시지·요약은 세션 삭제 시 cascade한다. Storage 객체는 FK cascade로 삭제되지 않으므로 삭제 서비스가 객체 삭제와 DB 트랜잭션/재시도 상태를 별도 관리한다.
- 모든 사용자 데이터 테이블에 RLS를 활성화한다. 사용자 세션은 본인 행만 생성·조회·수정·삭제한다. 자식 테이블은 부모 `sessions.user_id = auth.uid()`를 검증한다.
- 보호자(P2) SELECT 정책은 활성 링크, 활성 `caregiver_sharing` 동의, caregiver ID 일치를 모두 요구한다. 보호자에게 쓰기 권한을 주지 않고 사진·메시지 원문 접근을 금지한다.
- Storage 버킷은 private. 객체 경로는 사용자 UUID/무작위 파일 UUID로 만들고 소유자 정책을 적용한다. 필요 시 짧은 만료의 서명 URL을 서버 권한 확인 뒤 발급한다.
- RLS 정책은 실제 사용자 JWT로 테스트한다. `service_role`은 브라우저·일반 요청 경로에 사용하지 않는다.

---

## 5. 저장소 구성 및 구현 계약

### 5.1 권장 디렉터리

```text
TRD-/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (senior)/page.tsx
│   ├── (senior)/photo/page.tsx
│   ├── (senior)/session/[id]/page.tsx
│   ├── (senior)/session/[id]/checkin/page.tsx
│   ├── (senior)/summary/[id]/page.tsx
│   ├── (senior)/settings/records/page.tsx
│   ├── (caregiver)/summaries/page.tsx       # P2
│   └── api/v1/.../route.ts
├── components/                             # 접근성 UI 구성요소
├── lib/
│   ├── supabase/server.ts, browser.ts
│   ├── auth.ts, consent.ts, permissions.ts
│   ├── conversation.ts, storage.ts, validation.ts
│   ├── summaries.ts, prompts.ts
│   └── ai/base.ts, ai/provider.ts, ai/fallback.ts
├── supabase/migrations/
├── tests/unit/ tests/integration/ tests/e2e/
├── public/sample-photos/                    # 사용 허가된 예시 사진만
├── .env.example
├── package.json
├── README.md
├── PRD.md
└── TRD.md
```

### 5.2 모듈 책임

- `conversation.ts`: 세션 상태 전이, 3턴 제한, 중복 요청 방지, 답변 저장 후 다음 질문 생성 순서를 관리한다.
- `ai/base.ts` 및 provider: AI 공급자 인터페이스, timeout, 재시도, JSON 파싱을 제공한다. UI에서 직접 AI API를 호출하지 않는다.
- `ai/fallback.ts`: 비단정 사전 질문과 개인정보를 재전송하지 않는 기본 요약을 제공한다.
- `storage.ts`: 파일 디코드·MIME·크기 검증, UUID 객체명, 비공개 업로드·삭제를 담당한다.
- `permissions.ts`: 세션 소유권, 동의 상태, 보호자 관계를 서버 측에서 검증한다.
- `summaries.ts`: 출력 스키마와 비진단 규칙을 검증하고 fallback 요약을 생성한다.

### 5.3 환경 변수

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # 일반 앱 요청에서는 사용 금지; 설정하지 않는 것을 기본으로 함
AI_PROVIDER=gemini
GEMINI_API_KEY=
MAX_IMAGE_SIZE_MB=5
DATA_RETENTION_DAYS=90
```

`.env.example`에는 실제 자격 증명을 넣지 않는다. 로컬은 `.env.local`, 배포는 Vercel 환경변수에 주입한다. Supabase anon key는 공개 클라이언트 설정에서 쓸 수 있지만 RLS 없이는 안전하지 않다. AI 키와 service role 키는 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 키·토큰·사진·대화 데이터를 Git에 커밋하지 않는다.

---

## 6. 단계별 구현 및 범위 관리

### 1단계 — 핵심 회상 시연 (P0)
1. 큰 글씨·고대비 홈, 로그인(사전 준비한 데모 계정 또는 참여자별 체험 계정 사용 가능), 동의 안내 및 예시 사진 선택.
2. 세션 생성, 사진 선택/업로드, 파일 검증 및 비공개 Storage.
3. 첫 질문과 답변 3턴 대화, 상태 표시 및 메시지 저장.
4. AI JSON 검증, timeout/retry 및 fallback 질문 연결.
5. 회상 키워드·활동 요약, 복약·컨디션 직접 입력 저장.
6. 요약을 DB에서 재조회하고 완료 세션·메시지·요약 저장률을 검증.

데모 계정에서도 인증·동의·권한 확인은 일반 사용자와 동일하게 적용한다. 시연을 위해 검증을 우회하거나 실제 민감 데이터를 공용 계정에 저장하지 않는다.

### 2단계 — 안전·정합성 강화 (P1)
1. 본인 데이터 RLS, 동의 철회 및 세션 전체 삭제·부분 실패 재시도.
2. 비진단 건강 메모·전문기관 고정 안내, 데이터 보관 정책.
3. 인증 만료·저장 실패·네트워크 오류 테스트와 사용성 리허설.

### 3단계 — 보호자 공유 (P2)
1. 인증된 초대 코드 발급·입력·어르신 최종 승인.
2. 활성 연결과 공유 동의가 유지되는 경우에만 요약 조회.
3. 연결 해제 즉시 차단, 역할별 RLS와 E2E 권한 테스트.

음성 STT/TTS, 기관 시스템 연동, 인지기능 점수·치매 판정, 임상적 효과 주장, 보호자의 원본 대화·사진 열람은 MVP에서 제외한다.

---

## 7. 테스트 계획 및 PRD 완료 기준

### 7.1 PRD 추적표

| PRD 요구/목표 | 구현 위치 | 측정 및 완료 기준 |
|---|---|---|
| 예시 또는 사용자 사진 등록 | 사진 선택 화면, 세션 API, private Storage | 예시/업로드 각각 정상 세션 연결; 잘못된 파일 거부 |
| 사진을 참고한 질문·답변 기반 후속 질문 | AI 어댑터, `conversation.ts` | 질문 3개 및 사용자 답변 3개 순서 검증; AI 실패 시 fallback으로 완주 |
| 사진 속 인물·상황 비단정 | 프롬프트·출력 검증 | 이름/관계/장소를 단정하는 테스트 출력은 표시하지 않음 |
| 키워드·활동 요약·날짜·참여 기록 | `summaries`, `sessions`, `messages` | 완료 세션 요약을 새 조회에서 재확인 |
| 복약·컨디션 직접 기록 | check-in API 및 요약 화면 | 대화에서 값을 추론하지 않으며 사용자가 선택한 값만 저장 |
| 건강 언급 메모·전문기관 안내 | summary validator/UI 고정 문구 | 진단·위험도·치료 권고 금지; 안내 문구 노출 테스트 |
| 동의 후 저장/AI 처리, 삭제 | consent API, deletion flow | 동의 전 처리 차단; 삭제 완료 전 성공 미표시; 삭제 후 접근 거부 |
| 사용성 테스트 참가자 6명 이상 | 익명 테스트 기록 | 서로 다른 무작위 테스트 ID 6개 이상 완료 |
| 대표 시나리오 성공 | 사진→3턴→체크인→요약 재확인 체크리스트 | 6명 중 5명 이상 전체 성공 |
| 3턴 완주·완료 기록 저장률 | 세션/메시지/요약 DB 대조 | 답변 3개 완료; 완료 세션의 메시지·요약 저장률 100% |
| 1회 완주 시간 | 시작부터 요약 확인까지 시간 기록 | 참가자별 측정, PRD 목표 3분 이내 여부 보고 |
| 사용 만족도 | 동일한 3개 문항, 5점 척도 | 평균 4.0/5 이상 여부 보고 |
| 보호자 기록 확인 시간 (P2) | 보호자 시나리오 타이머 | 평균 1분 이내 여부 보고. P2 구현 전에는 미측정/미달성으로 명시 |

테스트 결과에는 무작위 ID, 단계별 성공 여부, 시간, 설문 점수만 남긴다. 사진이나 대화 전문을 결과 보고서에 넣지 않는다. 목표 수치 미달은 숨기지 않고 원인·개선안을 함께 기록한다.

### 7.2 테스트 계층

- **단위:** 3턴 전이, 중복 답변 방지, 동의 확인, 이미지 형식/크기, JSON 스키마, 안전 출력, fallback.
- **통합:** 실제 테스트 프로젝트의 RLS로 본인/타인/보호자 데이터 접근, 저장·삭제·Storage 정합성, AI 실패 대체를 확인한다.
- **E2E (단계 적용):** P0 어르신 대표 흐름 우선. P2 보호자 승인·조회·철회는 P2에서 추가한다.
- **수용:** PRD 정량 기준과 §7.1 체크리스트를 사용성 테스트 참가자 결과로 확인한다.

---

## 8. 개인정보·AI 안전 및 배포 체크리스트

- [ ] 목적·전송 데이터·보관/삭제 방법을 쉬운 문장으로 안내하고, 동의 거부 시 진행을 차단한다.
- [ ] AI 제공자의 데이터 처리·보관·학습 조건과 배포 플랜의 현재 한도를 확인한다.
- [ ] 시연에는 가상 사용자와 사용 허가된 이미지 사용.
- [ ] AI가 인물·관계·장소·기억을 단정하거나 유도하지 않도록 프롬프트 및 테스트 적용.
- [ ] 건강 메모에서 진단명·치매 가능성·위험도·치료 권고를 차단하고 고정 전문기관 안내 제공.
- [ ] 동의 철회·기록 삭제 UI 및 결과 확인, 실패 시 재시도 상태 제공.
- [ ] RLS를 실제 사용자 JWT로 검증하고 보호자 연결·동의 철회를 서버에서 확인.
- [ ] API 키를 서버 환경변수에만 보관, 비밀값·대화·사진 로그 금지.
- [ ] 사진 파일 크기·실제 형식·확장자를 검증하고 Storage를 비공개로 설정.
- [ ] 의료·응급 판단은 하지 않으며 필요한 경우 보호자 또는 전문기관에 직접 문의하도록 안내.

---

## 9. 주요 리스크 및 완료 판단

| 리스크 | 대응 |
|---|---|
| 무료 플랜 정책·한도 변경 | 배포 직전 공식 한도 확인, 시연 데이터 제한, 한도 초과 시 공개 사용 중단 및 대체 계획 |
| 프리뷰/서버리스에서 로컬 상태 소실 | 영구 데이터는 Supabase에 저장, 서버 메모리·임시 파일을 영속 저장소로 사용하지 않음 |
| AI 부정확·유도 질문 | 비단정 프롬프트, 구조화 출력 검증, 고정 fallback, 안전 테스트 |
| 민감 사진·건강 대화 노출 | 동의·최소 수집·private Storage·RLS·삭제·가상 시연 데이터 |
| 권한 오류 | API 및 DB 양쪽 소유권 검사, 실제 JWT의 negative access 테스트 |
| 일정 내 과도한 범위 | P0 흐름을 먼저 완성하고 보호자 기능·고도화 E2E는 후속 단계로 분리 |
| 저장/삭제 부분 실패 | 성공을 허위 표시하지 않고 재시도 가능한 상태 및 결과 제공 |

**최종 완료 판단:** 1차 시연은 동의 후 예시/업로드 사진을 선택하고, 질문·답변 3턴을 마친 뒤 복약·컨디션을 직접 기록하며, 키워드·요약·기록을 저장 후 다시 확인할 수 있어야 한다. AI 장애 시 fallback으로 핵심 흐름이 지속되어야 한다. PRD의 수치 목표는 테스트 결과로 각각 판정한다. 보호자 요약은 P2에서 어르신 승인과 공유 동의를 구현·검증한 이후에만 제공한다.

---

# 10. 구현 상세 부록

> 이 부록은 본 TRD의 구현 가능성을 높이기 위한 설계 기준이다. 아래 SQL·설정·테스트는 구현 시 기준으로 사용할 **제안 사양**이며, 실제 저장소에 코드·마이그레이션·CI가 추가되고 실행되기 전까지 구현 또는 테스트 완료를 의미하지 않는다. 외부 AI·배포 서비스의 요금과 한도는 도입 시점의 공식 문서로 다시 확인한다.

## 10.1 환경별 배포 구성 및 실행 순서

### 환경 구분

| 환경 | 용도 | 데이터·비밀값 원칙 | 배포/검증 기준 |
|---|---|---|---|
| 로컬 | 개발 및 단위 테스트 | 로컬 `.env.local`; 가상 계정·샘플 이미지; 개발 Supabase 프로젝트 | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` 통과 |
| Preview | PR별 검토 | 별도 테스트 Supabase 프로젝트와 테스트 전용 AI 키 사용. 운영 DB·운영 사용자 데이터에 연결 금지 | 환경변수는 Preview scope로 분리하고 로그인·동의·3턴·저장 재조회 E2E 실행 |
| Demo/Production | 승인된 시연 또는 운영 | 별도 Supabase 프로젝트, 제한된 계정, 허가된 샘플만 사용. 비밀값은 배포 플랫폼의 환경변수에 저장 | 배포 전 RLS·삭제·동의 철회·AI fallback 확인. 배포 후 smoke test 및 로그 점검 |

환경별로 Supabase URL/anon key, 서버 전용 AI key, 허용된 origin, 저장소 버킷 및 데이터베이스를 분리한다. Preview 배포가 실제 사용자 데이터를 읽거나 쓰지 않도록 환경변수와 OAuth redirect URL을 확인한다. `service_role` 키는 일반 앱 요청에 설정하지 않는 것을 기본으로 하며, 꼭 필요한 별도 관리 작업에서만 제한된 실행 주체가 사용한다.

### 로컬 → Preview → 시연 배포 체크리스트

1. Node.js LTS와 패키지 매니저 버전을 저장소에서 고정하고 lockfile을 커밋한다.
2. `.env.example`을 복사해 로컬 환경값을 설정한다. 비밀값이 버전 관리 대상에 포함되지 않는지 확인한다.
3. 개발 Supabase 프로젝트에 마이그레이션을 적용하고 RLS를 활성화한다. 테스트 사용자 A/B로 소유자 접근 허용 및 교차 접근 거부를 검증한다.
4. 로컬에서 lint, typecheck, unit/integration test, production build를 실행한다.
5. PR Preview는 테스트 DB와 테스트 AI 공급자 설정만 사용한다. E2E smoke flow를 통과한 뒤 검토한다.
6. 시연 배포 전에는 가상 사용자·허가된 이미지, 동의 문구/문서 버전, AI 제공자 데이터 정책, 보관·삭제 동작을 점검한다.
7. 데모 계정은 개인별로 분리한다. 불가피하게 공용 계정을 쓰면 개인 식별·민감 정보는 입력하지 않고 초기화 가능한 가상 데이터만 사용한다.
8. 시연 후 계정·세션·사진 정리 결과를 확인하고 임시 자격 증명을 회전 또는 폐기한다.

### 공급자 대체안

- **Vercel 사용 불가:** 같은 Next.js 앱을 Node.js를 지원하는 다른 호스팅에 배포할 수 있다. 필수 조건은 HTTPS, 서버 런타임 환경변수, Next.js App Router/API Route 지원, 빌드·실행 로그 확인, Preview/Production 비밀값 분리다. 서버리스 로컬 파일시스템을 영속 저장소로 사용하지 않는다.
- **Supabase 사용 불가:** 프로토타입의 기본 대체안은 PostgreSQL + 인증 제공자 + 비공개 오브젝트 스토리지의 조합이다. 대체 시 DB 접근 계층, 사용자 JWT 검증, 행 단위 소유권 정책, 비공개 객체 권한, 삭제 재시도 및 통합 테스트를 재구현하기 전에는 민감 데이터 시연을 중단한다. SQLite 파일을 공개 배포의 동시 사용자 데이터 저장소로 대체하지 않는다.
- **AI 공급자 사용 불가:** provider adapter를 통해 고정된 비단정 질문 템플릿과 로컬 요약으로 진행한다. AI 기능을 비활성화해도 3턴 저장과 요약 재조회가 작동해야 한다.

## 10.2 세션 상태 전이와 트랜잭션 경계

### 상태 전이표

| 현재 상태 | 입력/조건 | 다음 상태 | 허용 동작 / 거부 조건 |
|---|---|---|---|
| `created` | 사진이 등록되고 저장·AI 동의가 유효 | `in_progress` | 첫 assistant 질문을 한 번만 저장한다. 사진 미등록·동의 철회 시 시작 거부 |
| `in_progress` | 예상 turn의 사용자 답변이 유효하게 저장 | `in_progress` | turn 1~2는 답변 저장 후 다음 질문 저장. 중복 idempotency key는 이전 응답 재사용 |
| `in_progress` | 세 번째 사용자 답변 저장 | `awaiting_summary` | 새 질문은 만들지 않는다. 요약 작업은 멱등하게 시작 가능 |
| `awaiting_summary` | 스키마 검증된 AI 요약 또는 fallback 요약 저장 | `completed` | summary 1개와 완료 시각을 원자적 완료 절차로 확정 |
| 진행 상태 | 복구 불가능한 오류·사용자 취소 | `failed` 또는 삭제 처리 | 오류를 기록하되 민감 본문·이미지 URL을 로그에 남기지 않는다. 재시도 가능한 오류는 진행 상태 유지 |
| `completed` | 추가 turn/요약 생성 요청 | 변경 없음 | `409` 반환. 완료 데이터는 수정 API 계약에서 별도 허용하지 않는 한 불변 |

DB `sessions.status`에는 `created`, `in_progress`, `awaiting_summary`, `completed`, `failed`를 사용하도록 제안한다. 기존 제약을 확장하는 migration, 앱 코드, API, 테스트를 함께 갱신한다. 전이는 서버 측 함수/트랜잭션으로 검증하며 브라우저가 전달한 상태값은 신뢰하지 않는다.

### 원자성 및 재시도

- 사용자 답변 저장은 `(session_id, turn_number, role='user')`의 유일 제약과 세션 행 잠금 또는 조건부 갱신으로 한 번만 반영한다.
- idempotency 레코드는 사용자 ID, 세션 ID, key, 요청 해시, 응답 결과를 저장한다. 동일 key·동일 본문 재요청에는 저장된 결과를 반환하고, 동일 key·다른 본문은 `409`로 거절한다. key 원문은 무작위 값이어야 하며 보존 기간을 둔다.
- 외부 AI 요청을 DB 트랜잭션 안에서 기다리지 않는다. 답변 저장 후 작업 상태를 기록하고 AI 호출·응답 검증을 수행한 다음 결과를 조건부 저장한다. AI 실패는 fallback으로 완료한다.
- 답변·요약·세션 완료 상태는 각각 중복 요청에 안전해야 한다. 세션 완료는 3개의 user 답변과 유효한 summary가 모두 존재할 때만 허용한다.
- 사진 삭제와 DB 삭제는 분산 트랜잭션이 아니므로 `deletion_requests` 상태를 둔다. 객체 삭제 성공을 확인한 뒤 DB 행 삭제를 진행하고, 실패 시 요청 ID와 재시도 횟수만 남겨 재처리한다. 로그에는 객체 URL이나 콘텐츠를 남기지 않는다.

## 10.3 AI 요청·응답 스키마

모든 길이 제한은 Unicode 코드 포인트 기준으로 애플리케이션에서도 검사한다. 실제 공급자 응답은 신뢰하지 않고 서버에서 JSON parse, JSON Schema/Zod 검증, 안전 규칙 검증을 수행한다.

### 첫 질문 요청 및 응답

```json
{
  "photo_type": "sample",
  "instruction": "사진에 보이는 내용만 참고해 열린 질문 하나를 작성한다. 인물의 신원·관계, 날짜, 장소, 사건을 추측하지 않는다."
}
```

이미지 바이너리는 승인된 서버 SDK 경로로만 전달한다. Storage 경로, 공개 URL, 계정 정보는 모델 입력에 넣지 않는다.

```json
{"question":"이 사진을 보시니 어떤 기억이 떠오르시나요?"}
```

`question`은 필수 문자열 1~240자이며 공백만인 값은 거부한다. 알 수 없는 필드는 제거하거나 응답을 거부한다. 진단·위험도·인물 관계를 단정하는 문구, 개인정보 요청, 유도성 질문은 표시하지 않고 한 번 재시도 후 고정 질문으로 대체한다.

### 후속 질문 요청 및 응답

```json
{
  "turn_number": 2,
  "current_answer": "그때 가족과 함께 바닷가에 갔어요.",
  "recent_context": [
    {"role":"assistant","content":"이 사진을 보시니 어떤 기억이 떠오르시나요?"},
    {"role":"user","content":"가족과 바닷가에 갔어요."}
  ]
}
```

```json
{"question":"그날 기억나는 장면이나 느낌이 있으신가요?"}
```

현재 답변과 최대 최근 4개 메시지만 전송하며 메시지당 최대 1,000자다. `turn_number`는 정수 2~3이고, 세 번째 답변 뒤에는 후속 질문을 요청하지 않는다. 질문은 첫 질문과 동일한 길이·안전 규칙을 적용한다.

### 요약 요청 및 응답

```json
{
  "messages": [
    {"turn_number":1,"content":"가족과 바닷가에 갔어요."},
    {"turn_number":2,"content":"파도 소리가 기억나요."},
    {"turn_number":3,"content":"즐거웠어요."}
  ]
}
```

```json
{
  "recall_keywords":["가족","바닷가"],
  "activity_summary":"사용자는 가족과 바닷가에 갔던 기억과 파도 소리에 대한 느낌을 이야기했습니다.",
  "health_mention_note":null
}
```

`recall_keywords`는 0~5개 문자열 배열, 각 1~40자; `activity_summary`는 필수 1~600자; `health_mention_note`는 null 또는 실제 발화의 중립적 요약 1~240자다. 진단명, 인지 점수, 질환 가능성, 위험 등급, 치료·복약 권고를 포함하면 거부한다. 사용자 체크인 값은 AI가 추론·덮어쓰지 않으며 별도 사용자 입력 데이터로 유지한다. fallback은 중립적인 참여 요약을 만들고 추론된 건강 메모는 항상 `null`이다.

## 10.4 핵심 PostgreSQL migration 및 RLS 기준안

> 아래 SQL은 새 테스트 프로젝트에 적용할 기준안이다. 기존 DB에 바로 적용하지 말고 스키마와 비교해 순차 migration으로 조정한다. 실제 적용 뒤 테스트 DB에서 migration을 실행하고 권한 테스트를 통과시켜야 완료로 본다.

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
  using (exists (select 1 from public.sessions s where s.id = messages.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = messages.session_id and s.user_id = (select auth.uid())));
create policy checkins_owner_all on public.checkins
  for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = checkins.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = checkins.session_id and s.user_id = (select auth.uid())));
create policy summaries_owner_all on public.summaries
  for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = summaries.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s where s.id = summaries.session_id and s.user_id = (select auth.uid())));

grant select, update on public.profiles to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.messages, public.checkins, public.summaries to authenticated;
```

이 정책은 P0 소유자 격리 기준안이다. 동의 여부와 상태 전이도 반드시 서버에서 확인한다. 직접 테이블 쓰기를 제한하려면 관련 테이블의 쓰기 권한을 철회하고 검증된 서버 함수/API만 사용한다. P2 보호자 조회 정책은 링크·공유 동의·projection 설계를 별도 migration 및 테스트로 추가하기 전에는 활성화하지 않는다. Storage 버킷은 private로 생성하고 `{auth.uid()}/{random_uuid}` 경로 제한 정책을 별도 적용·검증한다.

## 10.5 보관기간, 삭제 작업 및 요청 제한

### 보관기간 자동화

- `DATA_RETENTION_DAYS` 기본값은 90일이며 실제 운영 전 승인된 정책값으로 확정한다. 완료일 기준 만료 대상을 정기 작업에서 찾는다.
- 매일 03:00 UTC 실행을 제안한다. 만료 세션을 batch 최대 100건으로 조회하고 삭제 요청을 생성한 뒤 Storage 객체 삭제 → DB 행 삭제 순서로 처리한다.
- 실패 항목은 `deletion_requests`에 상태 `pending/retry/complete/failed`, 시도 횟수, `next_attempt_at`, 안전한 오류 코드만 보존한다. 지수 backoff(1분, 5분, 30분, 이후 최대 6시간)를 적용하고 작업 재실행은 멱등해야 한다.
- 모니터링에는 작업 성공률·대상 수·실패 수·오래된 pending 수만 기록한다. 사진 경로·메시지 내용은 로그에 기록하지 않는다. 사용자 요청 삭제는 보관 만료 작업과 별도 우선순위로 처리한다.
- 백업 및 AI 제공자의 잔존 정책은 앱 DB 삭제와 별개로 고지·검증한다. 제공자 삭제를 보장할 수 없으면 민감정보 전송을 중단한다.

### 초기 API 제한값

아래는 해커톤 초기 안전 기본값이며 실제 배포 한도·공급자 제한에 맞춰 조정하고 환경 변수/서버 설정으로 관리한다.

| 대상 | 초기 제한값 | 초과 처리 |
|---|---:|---|
| JSON 요청 본문 | 최대 64 KiB | `413` |
| 답변 본문 | 최대 4,000자 | `400` |
| 조건 메모 | 최대 500자 | `400` |
| 사진 업로드 | 최대 5 MiB, JPEG/PNG/WebP만 | `413` 또는 `415` |
| 목록 페이지 | 기본 20, 최대 50개 | 초과 시 `400` |
| AI 호출 | timeout 15초, 동시 2개/사용자 | timeout 후 1회 재시도, 이후 fallback |
| 로그인 사용자 API | 사용자별 60회/분 | `429`, `Retry-After` 포함 |
| 사진 업로드 | 사용자별 10회/시간 | `429` |
| AI 생성 호출 | 세션별 turn당 최대 2회, 사용자별 20회/시간 | 제한 시 fallback 또는 `429` |
| 초대 코드 발급(P2) | 사용자별 5회/시간, 코드 만료 15분·일회성 | `429` |

rate limit은 서버에서 사용자 ID와 작업 종류를 기준으로 적용한다. 다중 인스턴스에서 일관되도록 공유 저장소/플랫폼 제한 기능을 사용하고 프로세스 메모리 카운터만 운영 제한 수단으로 사용하지 않는다.

## 10.6 CI 및 검증 증거 기준

### PR 필수 검사

CI는 lockfile 기반 설치 후 lint, typecheck, unit tests, migration 검증, production build를 실행한다. 테스트 DB 비밀값은 GitHub Actions secrets에만 둔다. Preview E2E는 별도 테스트 프로젝트와 가상 데이터로 실행하며 실패 시 배포를 승인하지 않는다.

```yaml
# .github/workflows/ci.yml 제안 템플릿: 실제 package.json 스크립트에 맞춰 적용
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

위 workflow는 제안 템플릿이며 실제 저장소의 스크립트 및 Node LTS 버전에 맞춰야 한다. 초기 이후 lint/typecheck/test 스크립트는 필수로 만들어 누락이 CI 성공으로 처리되지 않게 한다. Migration CI에서는 빈 테스트 DB에 전체 migration을 적용하고 RLS 테스트는 실제 authenticated JWT로 실행한다.

### 최소 자동 테스트 매트릭스

| 테스트 | 준비 | 기대 결과 |
|---|---|---|
| 소유권 RLS | 사용자 A/B JWT와 A 소유 세션 | A 조회 허용, B 조회 결과 없음/권한 오류, B update/delete 거부 |
| 동의 가드 | 저장 또는 AI 동의 없음/철회 | 세션 생성·사진 업로드·AI 호출 거부, 데이터 미생성 |
| 전이·턴 제한 | 정상 순서, turn 건너뜀, 4번째 답변, completed 재요청 | 정상만 허용, 나머지 `409`, 중복 row 없음 |
| 멱등성 | 동일 key·동일 본문, 동일 key·다른 본문 재전송 | 최초 결과 재응답, 다른 본문은 `409` |
| AI 스키마·안전 | 잘못된 JSON, 누락 필드, 길이 초과, 진단/관계 단정, timeout | 위험 출력 미노출, 1회 재시도 후 fallback, 핵심 흐름 완주 |
| 이미지 검증 | 허용 이미지, MIME 위장, 손상·과대 파일, SVG | 유효 파일만 수용, 나머지 `400/413/415` |
| 요약/완료 원자성 | 요약 저장 실패, 중복 complete | 완료 상태 허위 설정 없음, 재시도 가능 |
| 삭제 재처리 | Storage 실패 후 재시도, 이미 삭제된 객체 재요청 | 완료 전 성공 미표시, 반복 실행 시 최종 상태 수렴 |
| 보관 작업 | 만료/미만료 세션과 삭제 실패 객체 | 만료 대상만 enqueue, 실패 상태 추적, 개인정보 로그 없음 |

테스트 결과는 CI run URL, commit SHA, 통과/실패 건수와 테스트 환경만 기록한다. 대화 전문·사진·실사용자 식별정보를 artifact나 로그에 저장하지 않는다. 수용 테스트는 자동 테스트와 별도로 참가자 수, 성공률, 완주 시간, 만족도 실측치를 보고하며 미실행 목표는 “미검증”으로 표시한다.

## 10.7 완료·미완료 판정

TRD에 상세 설계를 추가하는 것만으로 점수 또는 실제 구현 완료를 보장하지 않는다. 평가에서 지적된 구현·배포·테스트 증거를 보완하려면 실제 코드 변경과 함께 아래 자료를 저장소/제출 자료에 포함해야 한다.

- migration 파일 및 테스트 DB 적용 결과
- RLS positive/negative access 자동 테스트 결과
- 실행된 CI workflow URL과 성공 commit SHA
- Preview/Demo 환경의 배포 URL 및 smoke test 결과(비밀값 제외)
- 6명 이상 사용성 테스트 결과(가명 ID와 집계 수치만)
- 테스트되지 않은 P1/P2 기능 및 남은 위험 목록

설계서의 수치·SQL·테스트 예시는 구현 전에 검증해야 할 기준이다. 실행하지 않은 항목을 완료로 표시하지 않는다.
