import { CaptureForm } from "@/components/CaptureForm";
import { OpeningPrompt } from "@/components/OpeningPrompt";

export const dynamic = "force-dynamic";

export default function CapturePage() {
  return (
    <main>
      <h1>Write</h1>
      <p className="lede">
        No title needed. No category, no date, no tags. Type it and save it; it stays readable and findable exactly as
        it is, for as long as you like.
      </p>
      <CaptureForm />
      <OpeningPrompt />
    </main>
  );
}
