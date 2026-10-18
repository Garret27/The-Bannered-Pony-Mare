import { NextResponse } from "next/server";

import {

  isMoviesLibraryConfigured,

  searchMovies,

} from "@/lib/movies-library";



export const runtime = "nodejs";



export async function GET(request: Request) {

  if (!isMoviesLibraryConfigured()) {

    return NextResponse.json(

      {

        error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured",

        movies: [],

        total: 0,

      },

      { status: 503 },

    );

  }



  try {

    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q") ?? undefined;

    const page = parseInt(searchParams.get("page") ?? "1", 10);

    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    const sortParam = searchParams.get("sort");

    const sort = sortParam === "size" ? "size" : "title";

    const orderParam = searchParams.get("order");

    const order = orderParam === "asc" ? "asc" : "desc";

    const minSizeBytes = parseInt(

      searchParams.get("minSizeBytes") ?? "0",

      10,

    );

    const rootKey = searchParams.get("rootKey") ?? undefined;

    const extension = searchParams.get("extension") ?? undefined;
    const forceRefresh = searchParams.get("refresh") === "true";
    const liveSizes = searchParams.get("liveSizes") === "true";

    const result = await searchMovies({
      query: q,
      page,
      limit,
      sort,
      order,
      minSizeBytes: Number.isFinite(minSizeBytes) ? minSizeBytes : 0,
      rootKey,
      extension,
      forceRefresh,
      liveSizes,
    });



    return NextResponse.json(result);

  } catch (error) {

    console.error("Failed to search movie library:", error);

    return NextResponse.json(

      { error: "Failed to scan movie library" },

      { status: 500 },

    );

  }

}

