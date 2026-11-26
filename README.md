# 정담이

사진을 보며 세 번의 회상 대화를 나누고, 활동 요약과 안부 기록을 저장해 다시 보는 Next.js 프로토타입입니다. TRD에 따라 Next.js App Router, TypeScript, Supabase Auth/PostgreSQL/private Storage, 서버 전용 Gemini adapter를 사용합니다.

## 로컬 실행

1. Node.js 20.9 이상을 설치하고 `npm install`을 실행합니다.
2. Supabase 프로젝트에 `supabase/migrations/202611270001_init.sql`을 적용합니다.
3. Supabase Auth에서 이메일 가입을 설정하고, 프로젝트의 `photos` private bucket/storage 정책이 migration에 반영되었는지 확인합니다.
4. `.env.example`을 `.env.local`로 복사해 Supabase URL/anon key를 입력합니다. Gemini를 사용하려면 `GEMINI_API_KEY`도 입력합니다. Gemini 키는 서버 환경변수로만 둡니다.
5. `npm run dev`로 실행합니다.

Gemini 키가 없거나 AI 요청·응답 검증에 실패하면 준비 질문과 로컬 대체 요약으로 3턴 흐름을 마칠 수 있습니다. 샘플 이미지는 실사진이 아닌 일러스트입니다. 업로드는 JPEG/PNG/WebP만 허용하며 크기와 실제 이미지 디코딩을 검사하고 메타데이터를 제거합니다.

## 검증

```powershell
npm run typecheck
npm test
npm run build
npm audit
```

## 범위와 배포 전 주의

이 저장소는 P0 회상 흐름을 구현하며 사용자 계정, 세션 사진 업로드, 사용자 데이터 삭제를 포함합니다. TRD의 P1 보관 만료 worker/삭제 큐 재시도, 운영 RLS 부정 테스트 및 P2 보호자 공유는 아직 제공하지 않습니다. 이 migration의 RPC/Storage 정책과 Supabase 설정은 배포 전에 실제 JWT A/B 통합 테스트로 검증해야 하며, 해당 검증 전에는 실제 사용자 데이터로 공개 배포하지 마세요. 사용성 목표 수치도 측정하지 않았습니다.

음성 기능, 공개 배포 자동화, 보호자 기능, 외부 시스템 연동은 포함하지 않습니다.
