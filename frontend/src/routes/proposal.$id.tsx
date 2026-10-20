import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import {
  PageIntro,
  ConnectionNotice,
  EmptyState,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "@/components/veto/shared";
import {
  challengeEvaluationAvailable,
  connectionState,
  formatGen,
  formatPolicy,
  integrationMessage,
  normalizeContractId,
  resolutionStep,
  shortAddress,
  VETO_LIMITS,
} from "@/lib/veto/domain";
import { simpleWrite } from "@/lib/veto/contract";
import { useCampaign, useProposal, useProposalChallenges } from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pageHead } from "@/lib/veto/metadata";
import { normalizeVetoError } from "@/lib/veto/errors";

export const Route = createFileRoute("/proposal/$id")({
  head: () =>
    pageHead(
      "Proposal details",
      "Review a VETO governance proposal, separately funded GEN escrow, ordered challenges and GenLayer evaluation status.",
    ),
  component: ProposalPage,
});

function ProposalPage() {
  const { id: rawId } = Route.useParams();
  const id = normalizeContractId(rawId);
  const proposalQuery = useProposal(id ?? "");
  const proposal = proposalQuery.data;
  const campaignQuery = useCampaign(proposal?.campaignId ?? "");
  const challengesQuery = useProposalChallenges(id ?? "");
  const wallet = useWallet();
  if (!id)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="SPENDING PROPOSAL / INVALID ID"
          title="That proposal ID is not valid."
          description="Proposal IDs are positive on-chain integers. Open a proposal from a verified campaign record."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Proposal not found."
          description="The route did not contain a valid proposal identifier."
        />
      </main>
    );
  if (connectionState !== "ready")
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="SPENDING PROPOSAL / CONFIGURATION"
          title="Proposal reads are not configured."
          description={integrationMessage}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="The VETO deployment is unavailable in this environment."
          description={integrationMessage}
        />
      </main>
    );
  if (proposalQuery.isPending && !proposal)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="SPENDING PROPOSAL / READING"
          title="Before this payment moves."
          description="Reading the authoritative proposal record…"
        />
        <ConnectionNotice />
        <ReadLoading message={`Reading proposal #${id} from Studio Next…`} />
      </main>
    );
  if (proposalQuery.isError)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="SPENDING PROPOSAL / READ FAILED"
          title={
            normalizeVetoError(proposalQuery.error).kind === "contract_state"
              ? "Proposal not found."
              : "Proposal data could not be read."
          }
          description={`The VETO contract did not provide a usable record for proposal #${id}.`}
        />
        <ConnectionNotice />
        <ReadFailure
          error={proposalQuery.error}
          onRetry={() => {
            void proposalQuery.refetch();
          }}
        />
      </main>
    );
  if (!proposal)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="SPENDING PROPOSAL / NOT FOUND"
          title="Proposal not found."
          description={`Proposal #${id} was not returned by the configured contract.`}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="No proposal record returned."
          description="The read completed successfully, but this proposal ID does not exist."
        />
      </main>
    );
  const campaign = campaignQuery.data;
  const now = Math.floor(Date.now() / 1000);
  const funder = Boolean(
    wallet.address && proposal.funder.toLowerCase() === wallet.address.toLowerCase(),
  );
  const terminal = proposal.stage === "CLEARED" || proposal.stage === "VETOED";
  const challenges = challengesQuery.data?.items ?? [];
  const resolution = campaign ? resolutionStep(proposal, challenges, campaign.intakeOpen) : null;
  return (
    <main className="page-body">
      {campaign ? (
        <Link to="/campaign/$id" params={{ id: campaign.id }} className="text-link mt-0 mb-8">
          <ArrowLeft size={13} /> {campaign.name}
        </Link>
      ) : (
        <Link to="/campaigns" className="text-link mt-0 mb-8">
          <ArrowLeft size={13} /> Explore campaigns
        </Link>
      )}
      <PageIntro
        eyebrow={`SPENDING PROPOSAL / ${proposal.stage}`}
        title={proposal.title}
        description={proposal.description}
        action={
          campaign?.intakeOpen &&
          !terminal &&
          proposal.challengeCount < VETO_LIMITS.challengesPerProposal ? (
            <Button asChild>
              <Link to="/challenge/$proposalId" params={{ proposalId: id }}>
                Challenge this proposal <ArrowUpRight />
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ConnectionNotice />
      {campaignQuery.isPending && !campaign && (
        <ReadLoading message="Reading the associated campaign record…" />
      )}
      {campaignQuery.isError && (
        <ReadFailure
          title="The associated campaign could not be read."
          error={campaignQuery.error}
          onRetry={() => {
            void campaignQuery.refetch();
          }}
        />
      )}
      <div className="metrics">
        {[
          ["Recipient", shortAddress(proposal.recipient)],
          ["Separate escrow", `${formatGen(proposal.paymentAmount)} GEN`],
          ["Applicable policy", `#${proposal.applicablePolicyIndex}`],
          ["Proposal state", proposal.stage],
          ["Submission priority", `${proposal.resolutionCursor} / ${proposal.challengeCount}`],
          [
            "Pending evaluations",
            challengesQuery.data
              ? String(
                  challengesQuery.data.items.filter((challenge) => challenge.status === "PENDING")
                    .length,
                )
              : "—",
          ],
        ].map(([title, value]) => (
          <div className="metric" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>Authoritative contract value</small>
          </div>
        ))}
      </div>
      <div className="detail-block mt-7">
        <p className="eyebrow">OUTCOME GUIDE</p>
        <div className="stage-track">
          {[
            ["OPEN", "Campaign intake remains available."],
            ["PENDING", "A submitted challenge or ordered resolution remains."],
            ["CLEARED", "The authorized recipient may execute the escrow once."],
            ["VETOED", "The intended payment is blocked; the original funder may refund escrow."],
          ].map(([state, detail]) => (
            <div key={state} className={proposal.stage === state ? "filter-active" : ""}>
              {state}
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="detail-grid">
        <div>
          <div className="detail-block">
            <h3>Immutable policy</h3>
            <p>{formatPolicy(proposal.applicablePolicy)}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {proposal.policyLimitWei && proposal.policyLimitWei > 0n
                ? `Deterministic payment limit: ${formatGen(proposal.policyLimitWei)} GEN. The contract compares the actual escrow amount directly.`
                : "Semantic findings require authority-authenticated evidence before they can authorize a reward."}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              Funder: {shortAddress(proposal.funder)} · recipient: {proposal.recipient}
            </p>
          </div>
          <div className="detail-block">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">ORDERED FINDINGS</p>
                <h2>Evidence record</h2>
              </div>
              {proposal.stage === "CLEARED" && proposal.escrowState === "LOCKED" && (
                <ContractAction
                  write={simpleWrite("execute_proposal", id)}
                  label="Execute cleared payment"
                />
              )}
              {proposal.stage === "VETOED" && proposal.escrowState === "REFUNDABLE" && funder && (
                <ContractAction
                  write={simpleWrite("claim_proposal_refund", id)}
                  label="Claim escrow refund"
                />
              )}
            </div>
            {challengesQuery.isPending && !challengesQuery.data && (
              <ReadLoading message="Reading ordered challenge records…" />
            )}
            {challengesQuery.isError && (
              <ReadFailure
                title="Challenge data could not be read."
                error={challengesQuery.error}
                onRetry={() => {
                  void challengesQuery.refetch();
                }}
              />
            )}
            {challenges.map((challenge, index) => (
              <div className="list-row" key={challenge.id}>
                <div>
                  <strong>
                    #{index + 1} · Challenge {challenge.id}
                  </strong>
                  <p>{challenge.allegation}</p>
                  <p className="text-xs text-muted-foreground">
                    <Link to="/agent/$id" params={{ id: challenge.agentId }}>
                      Agent #{challenge.agentId}
                    </Link>{" "}
                    · submitted {new Date(challenge.submittedAt * 1000).toLocaleString()} · attempts{" "}
                    {challenge.attempts}/2
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link to="/finding/$id" params={{ id: challenge.id }}>
                      View finding <ArrowUpRight />
                    </Link>
                  </Button>
                </div>
                <div>
                  <span className="eyebrow">
                    {challenge.accepted ? "ACCEPTED WINNER" : challenge.status}
                  </span>
                  {challengeEvaluationAvailable(challenge, now) && (
                    <ContractAction
                      write={simpleWrite("evaluate_challenge", challenge.id)}
                      label={
                        challenge.status === "INCONCLUSIVE" ? "Retry evaluation" : "Evaluate now"
                      }
                    />
                  )}
                </div>
              </div>
            ))}
            {challengesQuery.data &&
              !challengesQuery.isError &&
              challengesQuery.data.items.length === 0 && (
                <EmptyState
                  title="No challenges recorded."
                  description="A proposal can be cleared only after campaign intake closes and no eligible challenge remains."
                  action={false}
                />
              )}
          </div>
        </div>
        <aside>
          <div className="detail-block">
            <h3>Priority is onchain</h3>
            <p>
              Evaluation may complete in any order. The contract resolves challenge records by
              submission order, so a later VALID result is not claimable until earlier eligible
              records are terminal.
            </p>
          </div>
          {resolution && resolution.kind === "challenge" && (
            <div className="detail-block">
              <h3>Next resolution step</h3>
              <p>
                The ordered cursor is ready to process Challenge #{resolution.challenge.id}. A
                separate transaction is required to advance the proposal; it will either finalize
                the winner or move past this terminal finding.
              </p>
              <ContractAction
                write={simpleWrite("resolve_proposal", id)}
                label="Resolve proposal"
              />
            </div>
          )}
          {resolution && resolution.kind === "clear" && (
            <div className="detail-block">
              <h3>Proposal ready to clear</h3>
              <p>
                All submitted challenges are terminal and campaign intake has closed. Resolve the
                proposal to establish CLEARED.
              </p>
              <ContractAction write={simpleWrite("resolve_proposal", id)} label="Clear proposal" />
            </div>
          )}
          {resolution && resolution.kind === "blocked" && (
            <div className="detail-block">
              <h3>Earlier finding unresolved</h3>
              <p>
                Challenge #{resolution.challenge.id} is the next submission-priority record and must
                be evaluated or become terminal before this proposal can advance.
              </p>
              <Button asChild variant="outline">
                <Link to="/finding/$id" params={{ id: resolution.challenge.id }}>
                  Open next finding <ArrowUpRight />
                </Link>
              </Button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
