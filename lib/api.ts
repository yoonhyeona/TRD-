import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ZodError } from "zod";

export async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError(401, "인증이 필요합니다.");
  }
  return data.user;
}

export async function requireActiveConsents(supabase: SupabaseClient): Promise<void> {
  const consentTypes = ["data_storage", "ai_processing"] as const;
  const results = await Promise.all(
    consentTypes.map((consentType) =>
      supabase
        .from("consent_records")
        .select("granted")
        .eq("consent_type", consentType)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  const failed = results.find(({ error }) => error)?.error;
  if (failed) throw failed;
  if (results.some(({ data }) => !data?.granted)) {
    throw new ApiError(403, "사진 저장 및 AI 처리 동의가 모두 필요합니다.");
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid_input", message: "입력 내용이 올바르지 않습니다.", retryable: false } },
      { status: 400 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: "request_failed", message: error.message, retryable: false } },
      { status: error.status },
    );
  }
  console.error("API request failed", error instanceof Error ? error.name : "unknown");
  return NextResponse.json(
    { error: { code: "server_error", message: "요청을 처리하지 못했습니다.", retryable: true } },
    { status: 500 },
  );
}

export async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 64 * 1024) throw new ApiError(413, "요청 크기가 너무 큽니다.");
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
      throw new ApiError(413, "요청 크기가 너무 큽니다.");
    }
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

export function validateRpc<T>(data: T, error: { message: string } | null): T {
  if (error) {
    if (/consent/i.test(error.message)) throw new ApiError(403, "필요한 동의가 확인되지 않았습니다.");
    if (/owner|session|permission/i.test(error.message)) throw new ApiError(404, "기록을 찾을 수 없습니다.");
    if (/state|turn|duplicate/i.test(error.message)) throw new ApiError(409, "현재 상태에서는 처리할 수 없습니다.");
    throw new Error(error.message);
  }
  return data;
}
