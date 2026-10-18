import { Suspense } from "react";

import { MovieLibrary } from "../../components/MovieLibrary";



export default function MovieLibraryPage() {

  return (

    <Suspense

      fallback={

        <main style={{ padding: "4rem", textAlign: "center", color: "var(--muted)" }}>

          Loading…

        </main>

      }

    >

      <MovieLibrary />

    </Suspense>

  );

}


