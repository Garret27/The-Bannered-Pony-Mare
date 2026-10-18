import { NextResponse } from "next/server";
import {
  readPhotoBuffer,
  VrchatPhotoNotFoundError,
} from "@/lib/vrchat-photos";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const { buffer, mime } = await readPhotoBuffer(id);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    if (error instanceof VrchatPhotoNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to read VRChat photo:", error);
    return NextResponse.json({ error: "Failed to load photo" }, { status: 500 });
  }
}
