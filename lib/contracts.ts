import { z } from "zod";

export const consentSchema = z
  .object({
    consent_type: z.enum(["data_storage", "ai_processing"]),
    granted: z.boolean(),
  })
  .strict();

export const sessionCreateSchema = z
  .object({
    photo_source: z.enum(["sample", "upload"]),
    sample_id: z.enum(["seaside", "garden", "table"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.photo_source === "sample" && !value.sample_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sample_id"],
        message: "샘플 그림을 선택해 주세요.",
      });
    }
    if (value.photo_source === "upload" && value.sample_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sample_id"],
        message: "업로드 사진에는 샘플 ID를 사용할 수 없습니다.",
      });
    }
  });

export const answerSchema = z
  .object({
    turn_number: z.number().int().min(1).max(3),
    answer: z.string().trim().min(1).max(4000),
  })
  .strict();

export const summarySchema = z
  .object({
    recall_keywords: z.array(z.string().trim().min(1).max(40)).max(5),
    activity_summary: z.string().trim().min(1).max(600),
    health_mention_note: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export const checkinSchema = z
  .object({
    medication_status: z.enum(["taken", "not_taken", "not_recorded"]),
    condition_status: z.enum(["good", "okay", "unwell", "not_recorded"]),
    condition_note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const unsafeSummaryPatterns = [
  /치매|알츠하이머|인지\s*저하|인지\s*장애/u,
  /위험도|위험군|응급\s*상태|진단|치료\s*필요/u,
  /아들|딸|남편|아내|부모님|가족|친구|배우자|손주|형제|자매/u,
];

export function isSafeSummary(summary: z.infer<typeof summarySchema>): boolean {
  return !unsafeSummaryPatterns.some((pattern) =>
    pattern.test(`${summary.activity_summary} ${summary.health_mention_note ?? ""}`),
  );
}

export function healthNoteIsGrounded(
  note: string | null,
  answers: string[],
): boolean {
  return note === null || answers.some((answer) => answer.includes(note));
}

export function summaryIsGrounded(
  summary: z.infer<typeof summarySchema>,
  answers: string[],
): boolean {
  const source = answers.join(" ").toLocaleLowerCase();
  const keywordsAreQuoted = summary.recall_keywords.every((keyword) =>
    source.includes(keyword.toLocaleLowerCase()),
  );
  const hasSourcePhrase = (source.match(/[가-힣A-Za-z0-9]{2,}/gu) ?? []).some((word) =>
    summary.activity_summary.toLocaleLowerCase().includes(word.toLocaleLowerCase()),
  );
  return keywordsAreQuoted && hasSourcePhrase;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[이메일]")
    .replace(/(?:\+?82[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/gu, "[전화번호]")
    .replace(/\b\d{8,}\b/gu, "[숫자]")
    .replace(/(?:제\s*이름은?|저는|내\s*이름은)\s*[가-힣]{2,4}/gu, "사용자")
    .replace(/[가-힣]{2,4}(?:\s*씨|\s*님)/gu, "[이름]")
    .replace(/(?:비밀번호|password)\s*[:=]?\s*\S+/giu, "[자격 증명]");
}

export function fallbackSummary(answers: string[]) {
  const keywords = [...new Set(
    answers.join(" ").match(/[가-힣A-Za-z0-9]{2,20}/gu) ?? [],
  )]
    .filter((word) => !["그리고", "그때", "저는", "제가", "정말", "너무"].includes(word))
    .slice(0, 5);
  return {
    recall_keywords: keywords,
    activity_summary: `회상 대화에서 사용자가 직접 들려주신 내용입니다: ${answers.join(" ")}`.slice(
      0,
      600,
    ),
    health_mention_note: null,
  };
}

export const QUESTIONS = [
  "이 사진을 보시니 어떤 기억이 떠오르시나요?",
  "그 기억에서 떠오르는 장면이나 느낌이 있으신가요?",
  "그 이야기에 대해 더 들려주시고 싶은 말씀이 있으신가요?",
] as const;
