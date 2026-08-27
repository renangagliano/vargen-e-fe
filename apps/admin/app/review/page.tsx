import { ReviewWorkspace } from "@vargenfe/admin-shared/ui/review-workspace";
import { requireAdminPage } from "../../lib/page-auth";
import { getRemoteRepository } from "../../lib/repository";
import { getAdminRuntimeConfig, isOperationalAdminMode } from "../../lib/runtime-config";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const identity = await requireAdminPage();
  const data = await (await getRemoteRepository()).getReviewQueue();
  const config = getAdminRuntimeConfig();
  return <ReviewWorkspace initialData={data} role={identity.role} readOnly={!isOperationalAdminMode(config)} publishingEnabled={config.publishingEnabled} publicationTargetAccount={process.env.INSTAGRAM_ACCOUNT_ID?.trim() || "conta não configurada"} candidateDetailEndpoint="/api/admin/candidates" mutationEndpoint="/api/admin/mutations" publicationEndpoint="/api/admin/publications" />;
}
