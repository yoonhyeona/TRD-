import { NextResponse } from "next/server";

import { ApiError, errorResponse, requireUser } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const [{ data, error }, { data: messages, error: messageError },
      { data: summaries, error: summaryError }, { data: checkins, error: checkinError }] = await Promise.all([
      supabase
      .from("sessions")
      .select("id,status,photo_source,sample_id,photo_path,started_at,completed_at")
      .eq("id", id)
      .maybeSingle(),
      supabase
        .from("messages")
        .select("turn_number,role,content,created_at")
        .eq("session_id", id)
        .order("turn_number")
        .order("created_at"),
      supabase
        .from("summaries")
        .select("recall_keywords,activity_summary,health_mention_note,summary_source")
        .eq("session_id", id),
      supabase
        .from("checkins")
        .select("medication_status,condition_status,condition_note,updated_at")
        .eq("session_id", id),
    ]);
    if (error || !data) throw new ApiError(404, "기록을 찾을 수 없습니다.");
    if (messageError) throw messageError;
    if (summaryError) throw summaryError;
    if (checkinError) throw checkinError;
    let photoUrl: string | null = null;
    if (data.photo_path) {
      const { data: signed, error: photoError } = await supabase.storage
        .from("photos")
        .createSignedUrl(data.photo_path, 300);
      if (photoError) throw photoError;
      photoUrl = signed.signedUrl;
    }
    return NextResponse.json({
      session: {
        id: data.id,
        status: data.status,
        photo_source: data.photo_source,
        sample_id: data.sample_id,
        started_at: data.started_at,
        completed_at: data.completed_at,
        messages: messages ?? [],
        summaries: summaries ?? [],
        checkins: checkins ?? [],
      },
      photo_url: photoUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
