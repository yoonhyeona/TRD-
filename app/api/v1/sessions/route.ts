import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { ApiError, errorResponse, readJson, requireUser, validateRpc } from "@/lib/api";
import { sessionCreateSchema } from "@/lib/contracts";
import { samplePng } from "@/lib/samples";
import { createSupabaseServer } from "@/lib/supabase/server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function GET() {
  try {
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const { data, error } = await supabase
      .from("sessions")
      .select("id,status,photo_source,started_at,completed_at,summaries(activity_summary,recall_keywords,summary_source)")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const items = (data ?? []).map((item) => ({
      ...item,
      summaries: Array.isArray(item.summaries)
        ? item.summaries
        : item.summaries
          ? [item.summaries]
          : [],
    }));
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = sessionCreateSchema.parse(await readJson(request));
    const supabase = await createSupabaseServer();
    const user = await requireUser(supabase);
    const sessionId = randomUUID();
    const { data, error } = await supabase.rpc("start_session", {
      p_session_id: sessionId,
      p_photo_source: input.photo_source,
      p_sample_id: input.sample_id ?? null,
    });
    validateRpc(data, error);

    if (input.photo_source === "sample" && input.sample_id) {
      let path: string | undefined;
      try {
        const image = await samplePng(input.sample_id);
        if (image.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "샘플 이미지가 너무 큽니다.");
        path = `${user.id}/${sessionId}/${randomUUID()}.png`;
        const uploaded = await supabase.storage.from("photos").upload(path, image, {
          contentType: "image/png",
          upsert: false,
        });
        if (uploaded.error) throw uploaded.error;
        const attached = await supabase.rpc("attach_photo", {
          p_session_id: sessionId,
          p_photo_path: path,
        });
        if (attached.error) throw attached.error;
      } catch (error) {
        if (path) {
          const { error: cleanupError } = await supabase.storage.from("photos").remove([path]);
          if (cleanupError) console.error("Sample photo cleanup failed");
        }
        const { error: stateError } = await supabase.rpc("fail_session", { p_session_id: sessionId });
        if (stateError) console.error("Failed to mark incomplete sample session");
        throw error;
      }
    }
    return NextResponse.json({ session_id: sessionId, status: "created" }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const supabase = await createSupabaseServer();
    const user = await requireUser(supabase);
    const { data: sessions, error } = await supabase
      .from("sessions")
      .select("photo_path")
      .eq("user_id", user.id);
    if (error) throw error;
    const paths = (sessions ?? [])
      .map((session) => session.photo_path)
      .filter((path): path is string => Boolean(path));
    for (let index = 0; index < paths.length; index += 100) {
      const { error: storageError } = await supabase.storage
        .from("photos")
        .remove(paths.slice(index, index + 100));
      if (storageError) throw storageError;
    }
    const { data, error: deleteError } = await supabase.rpc("delete_all_user_data");
    validateRpc(data, deleteError);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
