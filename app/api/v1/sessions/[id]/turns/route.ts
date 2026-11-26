import { NextResponse } from "next/server";

import { ApiError, errorResponse, readJson, requireActiveConsents, requireUser, validateRpc } from "@/lib/api";
import { nextQuestion } from "@/lib/ai";
import { answerSchema } from "@/lib/contracts";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const input = answerSchema.parse(await readJson(request));
    const supabase = await createSupabaseServer();
    await requireUser(supabase);
    const { data: existingMessages, error: existingError } = await supabase
      .from("messages")
      .select("turn_number,role,content,created_at")
      .eq("session_id", id)
      .order("turn_number")
      .order("created_at");
    if (existingError) throw existingError;
    const existingAnswer = existingMessages.find(
      (message) => message.turn_number === input.turn_number && message.role === "user",
    );
    if (existingAnswer && existingAnswer.content !== input.answer.trim()) {
      throw new ApiError(409, "이미 다른 답변이 저장된 순서입니다.");
    }
    if (!existingAnswer) {
      const { data: status, error: saveError } = await supabase.rpc("save_answer", {
        p_session_id: id,
        p_turn_number: input.turn_number,
        p_answer: input.answer,
      });
      validateRpc(status, saveError);
    }
    if (input.turn_number === 3) {
      return NextResponse.json({ status: "awaiting_summary", next_question: null });
    }
    await requireActiveConsents(supabase);
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("turn_number,role,content,created_at")
      .eq("session_id", id)
      .order("turn_number")
      .order("created_at");
    if (messagesError) throw messagesError;
    const existingQuestion = messages.find(
      (message) => message.turn_number === input.turn_number + 1 && message.role === "assistant",
    );
    if (existingQuestion) {
      return NextResponse.json({ status: "in_progress", next_question: existingQuestion.content });
    }
    const question = await nextQuestion(input.turn_number + 1, input.answer, messages);
    const { error } = await supabase.rpc("save_assistant_question", {
      p_session_id: id,
      p_turn_number: input.turn_number + 1,
      p_question: question,
    });
    if (error) {
      const { data: saved } = await supabase
        .from("messages")
        .select("content")
        .eq("session_id", id)
        .eq("turn_number", input.turn_number + 1)
        .eq("role", "assistant")
        .maybeSingle();
      if (!saved) throw error;
      return NextResponse.json({ status: "in_progress", next_question: saved.content });
    }
    return NextResponse.json({ status: "in_progress", next_question: question });
  } catch (error) {
    return errorResponse(error);
  }
}
