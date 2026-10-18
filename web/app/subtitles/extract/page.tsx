import { Suspense } from "react";

import { SubtitleExtract } from "../../components/SubtitleExtract";



export default function SubtitleExtractPage() {

  return (

    <Suspense

      fallback={

        <main style={{ padding: "4rem", textAlign: "center", color: "var(--muted)" }}>

          Loading…

        </main>

      }

    >

      <SubtitleExtract />

    </Suspense>

  );

}


