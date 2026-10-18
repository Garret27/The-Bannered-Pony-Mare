import fs from "fs/promises";

import { NextResponse } from "next/server";

import { isEvent, getSubtitlePath, getSubtitleFilename } from "@/lib/paths";



export const runtime = "nodejs";



type RouteContext = {

  params: Promise<{ event: string }>;

};



export async function GET(_request: Request, context: RouteContext) {

  const { event } = await context.params;



  if (!isEvent(event)) {

    return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  }



  try {

    const filePath = getSubtitlePath(event);

    const content = await fs.readFile(filePath, "utf-8");

    const filename = getSubtitleFilename(event);



    return new NextResponse(content, {

      headers: {

        "Content-Type": "text/plain; charset=utf-8",

        "Content-Disposition": `attachment; filename="${filename}"`,

      },

    });

  } catch (error) {

    const err = error as NodeJS.ErrnoException;

    if (err.code === "ENOENT") {

      return NextResponse.json(

        { error: "Subtitle file not found" },

        { status: 404 },

      );

    }

    console.error("Failed to download subtitle:", error);

    return NextResponse.json(

      { error: "Failed to download subtitle" },

      { status: 500 },

    );

  }

}


