import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

import { ApiError, errorResponse, requireActiveConsents, requireUser, validateRpc } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;

async function sanitizeUpload(file: File): Promise<Buffer> {
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "사진은 5MB 이하만 올릴 수 있습니다.");
  const raw = Buffer.from(await file.arrayBuffer());
  try {
    const image = sharp(raw, { limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
      throw new ApiError(415, "JPG, PNG, WEBP 사진만 사용할 수 있습니다.");
    }
    const format = metadata.format;
    const expectedMime =
      format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : "image/webp";
    const extension = file.name.split(".").pop()?.toLowerCase();
    const expectedExtensions = format === "jpeg" ? ["jpg", "jpeg"] : [format];
    if (file.type !== expectedMime || !extension || !expectedExtensions.includes(extension)) {
      throw new ApiError(415, "파일 확장자와 실제 사진 형식이 일치하지 않습니다.");
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new ApiError(400, "사진 크기가 올바르지 않습니다.");
    }
    const clean = await image.rotate().jpeg({ quality: 88 }).toBuffer();
    if (clean.byteLength > MAX_IMAGE_BYTES) {
      throw new ApiError(413, "정리된 사진 파일이 5MB를 초과합니다.");
    }
    return clean;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "사진 파일을 읽을 수 없습니다. 다른 사진을 선택해 주세요.");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let uploadedPath: string | undefined;
  let sessionId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createSupabaseServer>> | undefined;
  let validCreatedSession = false;
  try {
    ({ id: sessionId } = await context.params);
    supabase = await createSupabaseServer();
    const user = await requireUser(supabase);
    await requireActiveConsents(supabase);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES + 64 * 1024) {
      throw new ApiError(413, "요청 크기가 너무 큽니다.");
    }
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("status,photo_path")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) throw new ApiError(404, "기록을 찾을 수 없습니다.");
    if (session.photo_path) {
      return NextResponse.json({ session_id: sessionId, photo_attached: true });
    }
    if (session.status !== "created") throw new ApiError(409, "현재 상태에서는 사진을 연결할 수 없습니다.");
    validCreatedSession = true;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "사진 파일이 필요합니다.");
    const clean = await sanitizeUpload(file);
    const path = `${user.id}/${sessionId}/${randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from("photos").upload(path, clean, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    uploadedPath = path;
    const { data, error } = await supabase.rpc("attach_photo", {
      p_session_id: sessionId,
      p_photo_path: path,
    });
    validateRpc(data, error);
    return NextResponse.json({ session_id: sessionId, photo_attached: true });
  } catch (error) {
    let cleanupFailed = false;
    if (supabase && uploadedPath) {
      const { error: cleanupError } = await supabase.storage.from("photos").remove([uploadedPath]);
      if (cleanupError) {
        cleanupFailed = true;
        console.error("Photo object cleanup failed");
      }
    }
    if (supabase && sessionId && validCreatedSession) {
      const { error: stateError } = await supabase.rpc("fail_session", { p_session_id: sessionId });
      if (stateError) console.error("Failed to mark incomplete photo session");
    }
    if (cleanupFailed) {
      return NextResponse.json(
        { error: { code: "photo_cleanup_failed", message: "사진 업로드가 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.", retryable: true } },
        { status: 500 },
      );
    }
    return errorResponse(error);
  }
}
