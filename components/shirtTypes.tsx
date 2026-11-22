import { useId, type ReactNode } from "react";

export const SHIRT_TYPES = [
  { id: "crew-neck", label: "Crew Neck" },
  { id: "v-neck", label: "V-Neck" },
  { id: "polo", label: "Polo T-Shirt" },
  { id: "henley", label: "Henley T-Shirt" },
  { id: "round-neck", label: "Round Neck" },
  { id: "scoop-neck", label: "Scoop Neck" },
  { id: "collar", label: "Collar T-Shirt" },
  { id: "graphic", label: "Graphic T-Shirt" },
  { id: "plain", label: "Plain T-Shirt" },
  { id: "striped", label: "Striped T-Shirt" },
  { id: "oversized", label: "Oversized T-Shirt" },
  { id: "slim-fit", label: "Slim Fit T-Shirt" },
  { id: "long-sleeve", label: "Long Sleeve T-Shirt" },
  { id: "crop", label: "Crop T-Shirt" },
] as const;

export type ShirtTypeId = (typeof SHIRT_TYPES)[number]["id"];

/* ------------------------------------------------------------------
   Closed shirt silhouettes (48x48 viewBox, front view, centred on x=24).
   Every body is one closed path, so it can be filled and clipped.
------------------------------------------------------------------- */
const BODY = {
  regular:
    "M19 6.5 L14 8.5 L4.5 13.5 L8 21 L13 18.5 L13 41 Q13 42 14 42 L34 42 Q35 42 35 41 L35 18.5 L40 21 L43.5 13.5 L34 8.5 L29 6.5 Z",
  oversized:
    "M19 6.5 L11.5 8.3 L3.2 12.4 L6.4 25.2 L11 23.6 L10.2 41 Q10.2 42 11.2 42 L36.8 42 Q37.8 42 37.8 41 L37 23.6 L41.6 25.2 L44.8 12.4 L36.5 8.3 L29 6.5 Z",
  slim:
    "M19 6.5 L14.5 8.5 L6 13.5 L9 20.5 L13.5 18.5 Q13.6 30 15.2 41 Q15.3 42 16.3 42 L31.7 42 Q32.7 42 32.8 41 Q34.4 30 34.5 18.5 L39 20.5 L42 13.5 L33.5 8.5 L29 6.5 Z",
  long:
    "M19 6.5 L14 8.5 L6.8 11.8 L3.6 35.4 L9.3 36.6 L13 22 L13 41 Q13 42 14 42 L34 42 Q35 42 35 41 L35 22 L38.7 36.6 L44.4 35.4 L41.2 11.8 L34 8.5 L29 6.5 Z",
  crop:
    "M19 6.5 L14 8.5 L4.5 13.5 L8 21 L13 18.5 L13 29 Q13 30 14 30 L34 30 Q35 30 35 29 L35 18.5 L40 21 L43.5 13.5 L34 8.5 L29 6.5 Z",
} as const;

type BodyKey = keyof typeof BODY;

/** armhole seams that make the sleeves read as sleeves */
const SEAMS: Record<BodyKey, string> = {
  regular: "M14 8.5 Q12.3 13.5 13 18.5 M34 8.5 Q35.7 13.5 35 18.5",
  oversized: "M11.5 8.3 Q9.8 16 11 23.6 M36.5 8.3 Q38.2 16 37 23.6",
  slim: "M14.5 8.5 Q13 13.5 13.5 18.5 M33.5 8.5 Q35 13.5 34.5 18.5",
  long: "M14 8.5 Q12.4 15 13 22 M34 8.5 Q35.6 15 35 22",
  crop: "M14 8.5 Q12.3 13.5 13 18.5 M34 8.5 Q35.7 13.5 35 18.5",
};

function Shirt({
  body = "regular",
  children,
  shift = 0,
  clipStripes = false,
}: {
  body?: BodyKey;
  children?: ReactNode;
  shift?: number;
  clipStripes?: boolean;
}) {
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <g transform={shift ? `translate(0 ${shift})` : undefined}>
        <defs>
          <clipPath id={clipId}><path d={BODY[body]} /></clipPath>
        </defs>
        {/* soft fabric tint + outline */}
        <path d={BODY[body]} fill="currentColor" fillOpacity={0.12} />
        {clipStripes && (
          <g clipPath={`url(#${clipId})`} stroke="none" fill="currentColor" fillOpacity={0.32}>
            {[15.5, 21, 26.5, 32, 37.5].map((y) => (
              <rect key={y} x="0" y={y} width="48" height="2.6" />
            ))}
          </g>
        )}
        <path d={BODY[body]} />
        <path d={SEAMS[body]} strokeWidth={1} opacity={0.55} />
        {children}
      </g>
    </svg>
  );
}

const Detail = ({ d, w = 1.1, o = 0.85 }: { d: string; w?: number; o?: number }) => (
  <path d={d} strokeWidth={w} opacity={o} />
);
const Button = ({ cy }: { cy: number }) => (
  <g>
    <circle cx="24" cy={cy} r="1.15" fill="currentColor" fillOpacity={0.22} strokeWidth={0.9} />
    <circle cx="23.55" cy={cy - 0.35} r="0.22" fill="currentColor" stroke="none" />
    <circle cx="24.45" cy={cy - 0.35} r="0.22" fill="currentColor" stroke="none" />
    <circle cx="23.55" cy={cy + 0.45} r="0.22" fill="currentColor" stroke="none" />
    <circle cx="24.45" cy={cy + 0.45} r="0.22" fill="currentColor" stroke="none" />
  </g>
);

/* reusable pieces */
const RibCrew = () => (
  <>
    <path d="M19 6.5 Q24 11.8 29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
    <Detail d="M20.4 6.5 Q24 10 27.6 6.5" />
  </>
);
const Collar = ({ wide = false }: { wide?: boolean }) => (
  <>
    {/* stand behind the neck */}
    <path d="M19 6.5 Q24 3.2 29 6.5" fill="currentColor" fillOpacity={0.18} />
    {/* two collar points */}
    <path
      d={wide ? "M19 6.5 L15.8 11.9 L22.9 14.6 L22.9 7.7 Z" : "M19 6.5 L16.6 11.6 L22.8 14 L22.8 7.6 Z"}
      fill="currentColor" fillOpacity={0.2}
    />
    <path
      d={wide ? "M29 6.5 L32.2 11.9 L25.1 14.6 L25.1 7.7 Z" : "M29 6.5 L31.4 11.6 L25.2 14 L25.2 7.6 Z"}
      fill="currentColor" fillOpacity={0.2}
    />
  </>
);

export function ShirtTypeIcon({ id }: { id: ShirtTypeId }) {
  switch (id) {
    case "crew-neck":
      return <Shirt><RibCrew /></Shirt>;

    case "v-neck":
      return (
        <Shirt>
          <path d="M19 6.5 L24 15.4 L29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M20.7 6.5 L24 12.7 L27.3 6.5" />
        </Shirt>
      );

    case "polo":
      return (
        <Shirt>
          <Detail d="M22.8 14 V22 H25.2 V14" w={1} />
          <Collar />
          <Button cy={16.6} />
          <Button cy={19.8} />
          {/* ribbed sleeve cuffs */}
          <Detail d="M6.3 12.7 L9.8 20.1 M41.7 12.7 L38.2 20.1" w={1} o={0.7} />
        </Shirt>
      );

    case "henley":
      return (
        <Shirt>
          <path d="M19 6.5 Q24 10.9 29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M20.4 6.5 Q24 9.2 27.6 6.5" />
          <Detail d="M22.7 9.3 V23 H25.3 V9.3" w={1} />
          <Button cy={12.4} />
          <Button cy={16.4} />
          <Button cy={20.4} />
        </Shirt>
      );

    case "round-neck":
      return (
        <Shirt>
          <path d="M19 6.5 Q24 12.8 29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M20 6.5 Q24 11.3 28 6.5" w={0.9} o={0.7} />
        </Shirt>
      );

    case "scoop-neck":
      return (
        <Shirt>
          <path d="M17.2 7.3 L19 6.5 L29 6.5 L30.8 7.3 Q24 20.5 17.2 7.3 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M18.6 6.9 Q24 17.4 29.4 6.9" w={0.9} o={0.7} />
        </Shirt>
      );

    case "collar":
      return (
        <Shirt>
          <Collar wide />
          <Detail d="M24 14.2 V22.5" w={1} />
          <Detail d="M22.7 22.5 H25.3" w={1} />
        </Shirt>
      );

    case "graphic":
      return (
        <Shirt>
          <RibCrew />
          {/* print: sun over mountains */}
          <circle cx="28.4" cy="21.6" r="1.7" fill="currentColor" fillOpacity={0.35} strokeWidth={1} />
          <path
            d="M17.8 33 L22.6 25 L25.4 29.2 L27.4 26.6 L30.8 33 Z"
            fill="currentColor" fillOpacity={0.35} strokeWidth={1}
          />
        </Shirt>
      );

    case "plain":
      return (
        <Shirt>
          <path d="M19 6.5 Q24 10.8 29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M13.6 39 H34.4" w={0.9} o={0.45} />
        </Shirt>
      );

    case "striped":
      return (
        <Shirt clipStripes>
          <RibCrew />
        </Shirt>
      );

    case "oversized":
      return (
        <Shirt body="oversized">
          <RibCrew />
          <Detail d="M10.4 39 H37.6" w={0.9} o={0.45} />
        </Shirt>
      );

    case "slim-fit":
      return (
        <Shirt body="slim">
          <path d="M19 6.5 Q24 11.4 29 6.5 Z" fill="currentColor" fillOpacity={0.3} />
          <Detail d="M20.4 6.5 Q24 9.8 27.6 6.5" />
          {/* waist darts */}
          <Detail d="M16.2 28 Q17.4 31 16.8 34 M31.8 28 Q30.6 31 31.2 34" w={0.9} o={0.5} />
        </Shirt>
      );

    case "long-sleeve":
      return (
        <Shirt body="long">
          <RibCrew />
          {/* ribbed cuffs */}
          <Detail d="M3.95 32.4 L9.5 33.6 M44.05 32.4 L38.5 33.6" w={1} o={0.75} />
        </Shirt>
      );

    case "crop":
      return (
        <Shirt body="crop" shift={6}>
          <RibCrew />
          <Detail d="M13.6 27.4 H34.4" w={0.9} o={0.45} />
        </Shirt>
      );
  }
}