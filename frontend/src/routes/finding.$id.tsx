import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import {
  ConnectionNotice,
  EmptyState,
  PageIntro,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "@/components/veto/shared";
import {
  agentControlsWallet,
  challengeEvaluationAvailable,
  connectionState,
  formatGen,
  integrationMessage,
  normalizeContractId,
  resolutionStep,
  shortAddress,
} from "@/lib/veto/domain";
import { claimRewardWrite, simpleWrite } from "@/lib/veto/contract";
import {
  useAgent,
  useAgentCampaignClaimable,
  useCampaign,
  useChallenge,
  useProposal,
  useProposalChallenges,
} from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pageHead } from "@/lib/veto/metadata";
import { normalizeVetoError } from "@/lib/veto/errors";

export const Route = createFileRoute("/finding/$id")({
  head: () =>
    pageHead(
      "Finding details",
      "Follow a VETO evidence finding from submission through evaluation, ordered resolution and GEN settlement.",
    ),
  component: FindingPage,
});

function FindingProgress({
  challenge,
  proposal,
  claimable,
}: {
  challenge: NonNullable<ReturnType<typeof useChallenge>["data"]>;
  proposal: NonNullable<ReturnType<typeof useProposal>["data"]>;
  claimable: bigint;
}) {
  const evaluated = challenge.status !== "PENDING" && challenge.evaluatedAt > 0;
  const resolved = proposal.stage === "CLEARED" || proposal.stage === "VETOED";
  const claimableReward = challenge.accepted && claimable > 0n;
  const settled = challenge.accepted && claimable === 0n && resolved;
  const steps = [
    [true, "Submitted"],
    [evaluated, "Evaluated"],
    [resolved, "Resolved"],
    [claimableReward, "Reward claimable"],
    [settled, "Reward settled"],
  ] as const;
  return (
    <div className="detail-block mt-7" aria-label="Finding progress">
      <p className="eyebrow">FINDING PROGRESS</p>
      <div className="stage-track">
        {steps.map(([complete, label]) => (
          <div key={label} className={complete ? "filter-active" : ""}>
            {complete ? "✓ " : "○ "}
            {label}
          </div>
        ))}
      </div>
      {settled && (
        <p className="text-xs text-muted-foreground mt-3">
          The contract reports no remaining campaign-specific claimable balance for this accepted
          finding.
        </p>
      )}
    </div>
  );
}

function FindingPage() {
  const { id: rawId } = Route.useParams();
  const id = normalizeContractId(rawId);
  const challengeQuery = useChallenge(id ?? "");
  const challenge = challengeQuery.data;
  const proposalQuery = useProposal(challenge?.proposalId ?? "");
  const proposal = proposalQuery.data;
  const campaignQuery = useCampaign(challenge?.campaignId ?? "");
  const campaign = campaignQuery.data;
  const agentQuery = useAgent(challenge?.agentId ?? "");
  const agent = agentQuery.data;
  const challengesQuery = useProposalChallenges(challenge?.proposalId ?? "");
  const wallet = useWallet();
  const claimableQuery = useAgentCampaignClaimable(
    challenge?.agentId ?? "",
    challenge?.campaignId ?? "",
  );

  if (!id)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="FINDING / INVALID ID"
          title="That finding ID is not valid."
          description="Finding IDs are positive on-chain challenge identifiers. Open a finding from a proposal or agent record."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Finding not found."
          description="The route did not contain a valid finding identifier."
        />
      </main>
    );
  if (connectionState !== "ready")
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="FINDING / CONFIGURATION"
          title="Finding reads are not configured."
          description={integrationMessage}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="The VETO deployment is unavailable."
          description={integrationMessage}
        />
      </main>
    );
  if (challengeQuery.isPending && !challenge)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="FINDING / READING"
          title="The evidence leaves a record."
          description="Reading the authoritative challenge record…"
        />
        <ConnectionNotice />
        <ReadLoading message={`Reading finding #${id} from Studio Next…`} />
      </main>
    );
  if (challengeQuery.isError)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="FINDING / READ FAILED"
          title="Finding data could not be read."
          description="The VETO contract did not return a usable challenge record."
        />
        <ConnectionNotice />
        <ReadFailure error={challengeQuery.error} onRetry={() => void challengeQuery.refetch()} />
      </main>
    );
  if (!challenge || !proposal || !campaign || !agent)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="FINDING / NOT FOUND"
          title="Finding context is incomplete."
          description="The challenge, proposal, campaign and agent records must all be available before settlement actions are shown."
        />
        <ConnectionNotice />
        {!proposal && challenge && <ReadLoading message="Reading the parent proposal…" />}
        {!campaign && challenge && <ReadLoading message="Reading the parent campaign…" />}
        {!agent && challenge && <ReadLoading message="Reading the submitting agent…" />}
      </main>
    );

  const challenges = challengesQuery.data?.items ?? [];
  const step = resolutionStep(proposal, challenges, campaign.intakeOpen);
  const currentTarget =
    step?.kind === "challenge" || step?.kind === "blocked" ? step.challenge : undefined;
  const actor = agentControlsWallet(agent, wallet.address);
  const claimable = claimableQuery.data ?? 0n;
  const canEvaluate = challengeEvaluationAvailable(challenge);
  const canResolveThis = step?.kind === "challenge" && step.challenge.id === challenge.id;
  const earlierChallenge =
    (step?.kind === "blocked" || step?.kind === "challenge") && step.challenge.id !== challenge.id
      ? step.challenge
      : undefined;
  const resolutionRequired = proposal.resolutionCursor < proposal.challengeCount;

  return (
    <main className="page-body">
      <Link to="/proposal/$id" params={{ id: proposal.id }} className="text-link mt-0 mb-8">
        <ArrowLeft size={13} /> {proposal.title}
      </Link>
      <PageIntro
        eyebrow={`FINDING #${challenge.id} / ${challenge.accepted ? "ACCEPTED WINNER" : challenge.status}`}
        title={challenge.allegation}
        description={challenge.explanation}
        action={
          <Button asChild variant="outline">
            <Link to="/proposal/$id" params={{ id: proposal.id }}>
              View proposal <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <ConnectionNotice />
      <FindingProgress challenge={challenge} proposal={proposal} claimable={claimable} />
      <div className="metrics mt-7">
        {[
          ["Challenge ID", `#${challenge.id}`],
          ["Agent", `#${agent.id} · ${agent.name}`],
          ["Submission", new Date(challenge.submittedAt * 1000).toLocaleString()],
          ["Attempts", `${challenge.attempts} / 2`],
          ["Verdict", challenge.status],
          [
            "Reward",
            challenge.accepted ? `${formatGen(campaign.rewardPerAcceptedAgent)} GEN` : "Not earned",
          ],
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>Authoritative contract value</small>
          </div>
        ))}
      </div>
      <div className="detail-grid mt-7">
        <div>
          <div className="detail-block">
            <h3>Evidence record</h3>
            <dl>
              <dt>Campaign</dt>
              <dd>
                <Link className="text-link" to="/campaign/$id" params={{ id: campaign.id }}>
                  {campaign.name} · #{campaign.id}
                </Link>
              </dd>
              <dt>Proposal</dt>
              <dd>
                <Link className="text-link" to="/proposal/$id" params={{ id: proposal.id }}>
                  {proposal.title} · #{proposal.id}
                </Link>
              </dd>
              <dt>Agent</dt>
              <dd>
                <Link className="text-link" to="/agent/$id" params={{ id: agent.id }}>
                  {agent.name} · #{agent.id}
                </Link>
              </dd>
              <dt>Applicable policy</dt>
              <dd>
                Policy #{proposal.applicablePolicyIndex}: {proposal.applicablePolicy}
              </dd>
              <dt>Evidence URL</dt>
              <dd>
                <a
                  className="text-link break-all"
                  href={challenge.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {challenge.evidenceUrl}
                </a>
              </dd>
              <dt>Evidence status</dt>
              <dd>{challenge.evidenceStatus}</dd>
              <dt>Evidence hash</dt>
              <dd className="break-all">{challenge.evidenceSha256 || "Not evaluated"}</dd>
              <dt>Policy match</dt>
              <dd>
                {challenge.evaluatedAt
                  ? challenge.policyMatch
                    ? "Matched"
                    : "Not matched"
                  : "Not evaluated"}
              </dd>
              <dt>Supporting evidence</dt>
              <dd>
                {challenge.evaluatedAt
                  ? challenge.evidenceSufficient
                    ? "Sufficient"
                    : "Insufficient"
                  : "Not evaluated"}
              </dd>
              <dt>Evaluation deadline</dt>
              <dd>{new Date(challenge.evaluationDeadline * 1000).toLocaleString()}</dd>
            </dl>
          </div>
          <div className="detail-block mt-7">
            <h3>Next action</h3>
            {canEvaluate && (
              <>
                <p>
                  {challenge.status === "INCONCLUSIVE"
                    ? "The previous evaluation was inconclusive. A bounded retry is still available."
                    : "GenLayer has not evaluated this submission yet. Evaluation is permissionless and may be triggered by any connected Studio Next wallet."}
                </p>
                <ContractAction
                  write={simpleWrite("evaluate_challenge", challenge.id)}
                  label={
                    challenge.status === "INCONCLUSIVE" ? "Retry evaluation" : "Evaluate challenge"
                  }
                />
              </>
            )}
            {!canEvaluate && challenge.status === "PENDING" && (
              <p>
                This challenge is outside its evaluation grace period. Ordered resolution can expire
                it when it reaches the proposal cursor.
              </p>
            )}
            {challenge.status === "VALID" && !challenge.accepted && resolutionRequired && (
              <>
                {canResolveThis ? (
                  <ContractAction
                    write={simpleWrite("resolve_proposal", proposal.id)}
                    label="Resolve proposal"
                  />
                ) : earlierChallenge ? (
                  <>
                    <p>
                      An earlier challenge must be resolved before this finding can become the
                      winning submission.
                    </p>
                    <Button asChild variant="outline">
                      <Link to="/finding/$id" params={{ id: earlierChallenge.id }}>
                        Open earlier finding <ArrowUpRight />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p>
                    This valid finding is waiting for the proposal’s ordered resolution cursor to
                    reach it.
                  </p>
                )}
              </>
            )}
            {challenge.status === "VALID" &&
              !challenge.accepted &&
              !resolutionRequired &&
              campaign.intakeOpen && (
                <p>
                  The finding is valid, but the campaign is still accepting submissions. Resolution
                  can clear or veto the proposal only after intake closes.
                </p>
              )}
            {challenge.accepted && claimable > 0n && actor && (
              <ContractAction
                write={claimRewardWrite(agent.id, campaign.id)}
                label={`Claim ${formatGen(claimable)} GEN`}
              />
            )}
            {challenge.accepted && claimable === 0n && proposal.stage === "VETOED" && (
              <p>
                {actor
                  ? "No campaign-specific GEN is currently claimable for this accepted finding."
                  : "This reward is assigned to the registered agent’s payout flow."}
              </p>
            )}
            {earlierChallenge && challenge.status !== "VALID" && (
              <>
                <p>An earlier challenge is still the next resolution target.</p>
                <Button asChild variant="outline">
                  <Link to="/finding/$id" params={{ id: earlierChallenge.id }}>
                    Open earlier finding <ArrowUpRight />
                  </Link>
                </Button>
              </>
            )}
            {challenge.status === "INVALID" && (
              <p>
                This finding was rejected by the contract’s GenLayer evaluation and earns no GEN.
              </p>
            )}
            {challenge.status === "SUPERSEDED" && (
              <p>
                Another finding established the proposal outcome first. This finding earns no GEN.
              </p>
            )}
            {challenge.status === "EXPIRED" && (
              <p>
                The evaluation grace period ended before this finding could be evaluated. Its
                participation slot remains consumed.
              </p>
            )}
            {challenge.status === "INCONCLUSIVE" && challenge.attempts >= 2 && (
              <p>This finding used both evaluation attempts and cannot be evaluated again.</p>
            )}
            {challenge.status === "PENDING" && !canEvaluate && !currentTarget && (
              <p>Evaluation is no longer available under the contract’s current grace rules.</p>
            )}
          </div>
        </div>
        <aside>
          <div className="detail-block">
            <h3>Priority is onchain</h3>
            <p>
              A VALID verdict is not automatically a win. The earliest eventually-valid challenge
              wins only when the proposal resolution cursor reaches it.
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              Current cursor: {proposal.resolutionCursor} / {proposal.challengeCount}
            </p>
          </div>
          <div className="detail-block">
            <h3>Settlement</h3>
            <p>Proposal state: {proposal.stage}</p>
            <p>Escrow: {proposal.escrowState}</p>
            <p>Agent payout address: {shortAddress(agent.payoutAddress)}</p>
            <p>Claimable for this campaign: {formatGen(claimable)} GEN</p>
          </div>
          {challengesQuery.isError && (
            <ReadFailure
              title="Priority data could not be read."
              error={challengesQuery.error}
              onRetry={() => void challengesQuery.refetch()}
            />
          )}
          {challengesQuery.isPending && !challengesQuery.data && (
            <ReadLoading message="Reading ordered proposal challenges…" />
          )}
          {challenges.length === 0 && !challengesQuery.isPending && (
            <EmptyState
              title="No ordered challenge list returned."
              description="The individual challenge exists, but its proposal index could not be read."
              action={false}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
