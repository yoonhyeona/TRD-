import { NextResponse } from "next/server";

import { errorResponse, readJson, requireUser, validateRpc } from "@/lib/api";
import { checkinSchema } from "@/lib/contracts";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const input = checkinSchema.parse(await readJson(request));
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const { data, error } = await supabase.rpc("save_checkin", {
      p_session_id: id,
      p_medication_status: input.medication_status,
      p_condition_status: input.condition_status,
      p_condition_note: input.condition_note ?? null,
    });
    validateRpc(data, error);
    return NextResponse.json({ checkin: input });
  } catch (error) {
    return errorResponse(error);
  }
}
