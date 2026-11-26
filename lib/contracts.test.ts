import { describe, expect, it } from "vitest";

import {
  answerSchema,
  fallbackSummary,
  healthNoteIsGrounded,
  isSafeSummary,
  redactSensitiveText,
  sessionCreateSchema,
  summarySchema,
  summaryIsGrounded,
} from "@/lib/contracts";

describe("request contracts", () => {
  it("requires a server-approved sample identifier", () => {
    expect(sessionCreateSchema.safeParse({ photo_source: "sample" }).success).toBe(false);
    expect(
      sessionCreateSchema.safeParse({ photo_source: "sample", sample_id: "seaside" }).success,
    ).toBe(true);
    expect(
      sessionCreateSchema.safeParse({
        photo_source: "upload",
        sample_id: "seaside",
      }).success,
    ).toBe(false);
  });

  it("rejects skipped or out-of-range conversation turns and unknown fields", () => {
    expect(answerSchema.safeParse({ turn_number: 1, answer: "기억나요" }).success).toBe(true);
    expect(answerSchema.safeParse({ turn_number: 4, answer: "네 번째" }).success).toBe(false);
    expect(
      answerSchema.safeParse({ turn_number: 1, answer: "기억나요", user_id: "other" }).success,
    ).toBe(false);
  });
});

describe("non-diagnostic summary safety", () => {
  it("uses only a local fallback with no inferred health note", () => {
    const summary = fallbackSummary(["파도 소리가 기억나요.", "마음이 편했어요.", "즐거웠어요."]);
    expect(summary.activity_summary).toContain("사용자가 직접 들려주신 내용");
    expect(summary.health_mention_note).toBeNull();
  });

  it("rejects diagnostic claims and ungrounded health notes", () => {
    const unsafe = summarySchema.parse({
      recall_keywords: ["기억"],
      activity_summary: "치매 위험이 높아 보입니다.",
      health_mention_note: null,
    });
    expect(isSafeSummary(unsafe)).toBe(false);
    expect(healthNoteIsGrounded("몸이 아파요", ["오늘은 편안했어요."])).toBe(false);
    expect(healthNoteIsGrounded("몸이 아파요", ["몸이 아파요."])).toBe(true);
  });

  it("redacts common identifying details before AI requests", () => {
    const redacted = redactSensitiveText("제 이름은 홍길동이고 김영희 씨 연락처는 010-1234-5678, 메일은 hi@example.com");
    expect(redacted).not.toContain("홍길동");
    expect(redacted).not.toContain("김영희");
    expect(redacted).not.toContain("010-1234-5678");
    expect(redacted).not.toContain("hi@example.com");
  });

  it("falls back when AI summary keywords are not present in the user's answers", () => {
    const summary = summarySchema.parse({
      recall_keywords: ["가족"],
      activity_summary: "사용자는 가족과 즐거운 하루를 보냈습니다.",
      health_mention_note: null,
    });
    expect(summaryIsGrounded(summary, ["바닷가에서 파도 소리를 들었어요."])).toBe(false);
  });
});
