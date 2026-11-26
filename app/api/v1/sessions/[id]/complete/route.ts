import { NextResponse } from "next/server";

import { ApiError, errorResponse, requireActiveConsents, requireUser, validateRpc } from "@/lib/api";
import { summarize } from "@/lib/ai";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("status,summaries(recall_keywords,activity_summary,health_mention_note,summary_source)")
      .eq("id", id)
      .single();
    if (sessionError || !session) throw new ApiError(404, "기록을 찾을 수 없습니다.");
    const savedSummary = Array.isArray(session.summaries)
      ? session.summaries[0]
      : session.summaries;
    if (session.status === "completed" && savedSummary) {
      return NextResponse.json({ summary: savedSummary, status: "completed" });
    }
    await requireActiveConsents(supabase);
    const { data: messages, error: messageError } = await supabase
      .from("messages")
      .select("turn_number,role,content")
      .eq("session_id", id)
      .eq("role", "user")
      .order("turn_number");
    if (messageError) throw messageError;
    if (!messages || messages.length !== 3) throw new ApiError(409, "세 번의 답변이 필요합니다.");
    const summary = await summarize(messages.map((message) => message.content));
    const { data, error } = await supabase.rpc("complete_session", {
      p_session_id: id,
      p_summary: summary,
    });
    validateRpc(data, error);
    return NextResponse.json({ summary, status: "completed" });
  } catch (error) {
    return errorResponse(error);
  }
}
