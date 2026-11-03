import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function IntegrationBack({ projectId, title }: { projectId: string; title: string }) {
  return (
    <div className="mb-4">
      <Link href={`/projects/${projectId}/integrations`} className="inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        接入
      </Link>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
    </div>
  );
}
