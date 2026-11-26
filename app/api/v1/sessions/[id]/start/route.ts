import { NextResponse } from "next/server";

import { ApiError, errorResponse, requireActiveConsents, requireUser, validateRpc } from "@/lib/api";
import { firstQuestion } from "@/lib/ai";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    await requireActiveConsents(supabase);
    const { data: session, error: readError } = await supabase
      .from("sessions")
      .select("status,photo_path,messages(turn_number,role,content)")
      .eq("id", id)
      .single();
    if (readError || !session) throw new ApiError(404, "사진이 연결된 기록을 찾을 수 없습니다.");
    if (session.status === "in_progress") {
      const first = session.messages.find(
        (message: { turn_number: number; role: string }) =>
          message.turn_number === 1 && message.role === "assistant",
      );
      if (first) return NextResponse.json({ status: "in_progress", first_question: first.content });
    }
    if (session.status !== "created") throw new ApiError(409, "현재 상태에서는 대화를 시작할 수 없습니다.");
    if (!session.photo_path) throw new ApiError(404, "사진이 연결된 기록을 찾을 수 없습니다.");
    const { data: photo, error: photoError } = await supabase.storage
      .from("photos")
      .download(session.photo_path);
    if (photoError || !photo) throw new Error("사진을 읽지 못했습니다.");
    const mimeType = photo.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      throw new Error("Stored photo has an unsupported content type");
    }
    const question = await firstQuestion(Buffer.from(await photo.arrayBuffer()), mimeType);
    const { data, error } = await supabase.rpc("start_conversation", {
      p_session_id: id,
      p_question: question,
    });
    validateRpc(data, error);
    return NextResponse.json({ status: "in_progress", first_question: question });
  } catch (error) {
    return errorResponse(error);
  }
}
