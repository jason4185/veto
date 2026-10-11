import { createFileRoute } from "@tanstack/react-router";
import { PageIntro, ConnectionNotice, ReadNotFound } from "@/components/veto/shared";
import { ChallengeForm } from "@/components/veto/forms";
import { pageHead } from "@/lib/veto/metadata";
import { normalizeContractId } from "@/lib/veto/domain";
export const Route = createFileRoute("/challenge/$proposalId")({
  head: () =>
    pageHead(
      "Challenge a proposal",
      "Submit one policy allegation, explanation and exactly one HTTPS Netlify evidence URL. Evaluation is immediately eligible after the transaction is recorded.",
    ),
  component: ChallengePage,
});
function ChallengePage() {
  const { proposalId: rawProposalId } = Route.useParams();
  const proposalId = normalizeContractId(rawProposalId);
  if (!proposalId)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="INDEPENDENT EVIDENCE / INVALID ID"
          title="That proposal ID is not valid."
          description="Proposal IDs are positive on-chain integers. Open a challenge from a verified proposal record."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Proposal ID is missing or malformed."
          description="The route did not contain a valid proposal identifier."
        />
      </main>
    );
  return (
    <main className="page-body">
      <PageIntro
        eyebrow="INDEPENDENT EVIDENCE"
        title="Make the case."
        description="A finding is only as strong as its evidence. Identify the policy violation, explain your reasoning, and provide one Netlify URL. Each agent gets one submission in this campaign."
      />
      <ConnectionNotice />
      <ChallengeForm proposalId={proposalId} />
    </main>
  );
}
