import { NextResponse } from "next/server";

import { errorResponse, readJson, requireUser, validateRpc } from "@/lib/api";
import { consentSchema } from "@/lib/contracts";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const results = await Promise.all(
      (["data_storage", "ai_processing"] as const).map((consentType) =>
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
    if (results.some(({ error }) => error)) throw results.find(({ error }) => error)?.error;
    return NextResponse.json({
      data_storage: Boolean(results[0].data?.granted),
      ai_processing: Boolean(results[1].data?.granted),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = consentSchema.parse(await readJson(request));
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const { data, error } = await supabase.rpc("record_consent", {
      p_consent_type: body.consent_type,
      p_granted: body.granted,
      p_document_version: "2026-01",
    });
    validateRpc(data, error);
    return NextResponse.json({ consent_type: body.consent_type, active: body.granted });
  } catch (error) {
    return errorResponse(error);
  }
}
