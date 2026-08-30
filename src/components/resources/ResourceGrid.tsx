import type { ResourceId, ResourceStatus } from "@/types/nimbus";
import { ResourceCard } from "./ResourceCard";

const ORDER: ResourceId[] = ["hospital", "desalination", "residential", "resort"];

export function ResourceGrid({ resources }: { resources: ResourceStatus[] }) {
  const sorted = [...resources].sort(
    (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {sorted.map((r) => (
        <ResourceCard key={r.id} resource={r} />
      ))}
    </div>
  );
}
