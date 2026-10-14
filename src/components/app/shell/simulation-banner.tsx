import { FlaskConical } from "lucide-react";
import { isSimulationMode } from "@/lib/platforms/registry";

/** Shown on every page while a platform is simulated, so nothing simulated passes for real. */
export function SimulationBanner() {
  if (!isSimulationMode()) return null;
  return (
    <div role="note" aria-label="Simulation mode" className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-[13px] text-orange-950 md:px-8">
      <p className="mx-auto flex max-w-[1600px] items-start gap-2">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Simulation mode.</strong> Posts are not sent to YouTube or Facebook yet. Anything marked
          &ldquo;Simulated&rdquo;, and every view and like count, is generated for testing.
        </span>
      </p>
    </div>
  );
}
