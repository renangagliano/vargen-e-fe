import { ReviewWorkspace } from "../../../../src/components/admin/review-workspace";
import { requireAdminPage } from "../../lib/page-auth";
import { getRemoteRepository } from "../../lib/repository";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireAdminPage();
  const data = await (await getRemoteRepository()).getReviewQueue();
  return <ReviewWorkspace initialData={data} readOnly candidateDetailEndpoint="/api/admin/candidates" />;
}
