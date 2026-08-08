import { ImageResponse } from "next/og";
import { getResult } from "@/lib/data/results";
import { getVerdict, VERDICT_LABEL } from "@/lib/verdict";

export const alt = "PixelTruth AI-generation likelihood result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const VERDICT_COLOR: Record<ReturnType<typeof getVerdict>, string> = {
  "likely-ai": "#dc2626",
  "possibly-ai": "#d97706",
  "likely-real": "#16a34a",
};

export default async function OpengraphImage({ params }: PageProps<"/result/[id]">) {
  const { id } = await params;
  const result = await getResult(id);

  const percent = result ? Math.round(result.aiLikelihoodScore * 100) : null;
  const verdict = result ? getVerdict(result.aiLikelihoodScore) : null;
  const label = verdict ? VERDICT_LABEL[verdict] : "Result not found";
  const color = verdict ? VERDICT_COLOR[verdict] : "#71717a";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 32, color: "#a1a1aa", marginBottom: 16 }}>PixelTruth</div>
        {percent !== null ? (
          <div style={{ fontSize: 160, fontWeight: 700, color: "#fafafa", display: "flex" }}>
            {percent}%
          </div>
        ) : null}
        <div style={{ fontSize: 48, fontWeight: 600, color, display: "flex" }}>{label}</div>
      </div>
    ),
    { ...size },
  );
}
