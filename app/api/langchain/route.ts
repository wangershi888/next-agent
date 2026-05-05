import { NextResponse } from "next/server";
import { recommendMovies } from "@/frameworks/langchain/chain";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { mood } = (await req.json()) as { mood?: string };
    if (!mood || !mood.trim()) {
      return NextResponse.json(
        { error: "mood 不能为空" },
        { status: 400 },
      );
    }
    const result = await recommendMovies(mood.trim());
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
