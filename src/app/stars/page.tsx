import { StarCanvas } from "@/components/StarCanvas";

export const dynamic = "force-dynamic";

export default function StarsPage() {
  return (
    <main>
      <h1>Constellation</h1>
      <p className="lede">
        Every entry is a point. Points sit near each other when they share words, and the glowing areas are your
        collections. Drag to move, scroll or pinch to zoom, click a point to see what it is.
      </p>
      <StarCanvas />
    </main>
  );
}
