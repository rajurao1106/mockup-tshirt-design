"use client";

import dynamic from "next/dynamic";

// three.js + fabric.js need the browser, so render the editor on the client only.
const Mockwear = dynamic(() => import("@/components/Mockwear"), {
  ssr: false,
  loading: () => <div className="grid min-h-screen place-items-center text-sm text-[#6f7163]">Loading…</div>,
});

export default function Page() {
  return (
    <main>
      <Mockwear />
    </main>
  );
}