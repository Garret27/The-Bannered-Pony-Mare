import { Suspense } from "react";

import { SubtitlesHub } from "../components/SubtitlesHub";



export default function SubtitlesPage() {

  return (

    <Suspense

      fallback={

        <main style={{ padding: "4rem", textAlign: "center", color: "var(--muted)" }}>

          Loading…

        </main>

      }

    >

      <SubtitlesHub />

    </Suspense>

  );

}


