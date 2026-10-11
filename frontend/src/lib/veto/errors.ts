export type VetoErrorKind =
  | "wallet_rejected"
  | "wrong_network"
  | "insufficient_gen"
  | "rate_limited"
  | "rpc_unavailable"
  | "configuration"
  | "authorization"
  | "contract_state"
  | "validation"
  | "transaction_failed"
  | "unknown";

export type VetoReadState = "latest-final" | "latest-nonfinal";

export type VetoReadContext = {
  contract: string;
  chainId: number;
  rpcUrl: string;
  method: string;
  args: string[];
  state: VetoReadState;
  sender?: string;
  durationMs: number;
};

export class VetoReadError extends Error {
  readonly context: VetoReadContext;
  readonly causeText: string;

  constructor(context: VetoReadContext, reason: unknown) {
    const causeText = technicalText(reason);
    super(`VETO read ${context.method} failed: ${causeText}`, { cause: reason });
    this.name = "VetoReadError";
    this.context = context;
    this.causeText = causeText;
  }
}

export class VetoError extends Error {
  readonly kind: VetoErrorKind;
  readonly technicalMessage: string;
  readonly nextAction: string;

  constructor(message: string, kind: VetoErrorKind, technicalMessage: string, nextAction: string) {
    super(message);
    this.name = "VetoError";
    this.kind = kind;
    this.technicalMessage = technicalMessage;
    this.nextAction = nextAction;
  }
}

function technicalText(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function make(
  message: string,
  kind: VetoErrorKind,
  technical: string,
  nextAction: string,
): VetoError {
  return new VetoError(message, kind, technical.slice(0, 2000), nextAction);
}

export function normalizeVetoError(reason: unknown): VetoError {
  if (reason instanceof VetoError) return reason;
  const technical = technicalText(reason);
  const text = technical.toLowerCase();

  if (/user rejected|user denied|user cancel|\b4001\b/.test(text))
    return make(
      "You cancelled the request in your wallet. No confirmed transaction result is available. You can try again whenever you’re ready.",
      "wallet_rejected",
      technical,
      "Review the transaction again and approve it in your wallet if you want to continue.",
    );
  if (/wrong network|chain mismatch|\b4902\b/.test(text))
    return make(
      "You’re connected to the wrong network. Switch your wallet to GenLayer Studio Next to continue.",
      "wrong_network",
      technical,
      "Switch the wallet to GenLayer Studio Next (chain 61997).",
    );
  if (/insufficient funds|insufficient balance|not enough gen|not enough funds/.test(text))
    return make(
      "Your wallet does not have enough GEN to complete this transaction and cover required network fees.",
      "insufficient_gen",
      technical,
      "Check the wallet’s GEN balance and try again without changing the contract-defined payment amount.",
    );
  if (/rate limit|too many requests|too many request|\b429\b/.test(text))
    return make(
      "GenLayer Studio Next is receiving too many requests right now. We’ll retry shortly. Your on-chain records remain unchanged.",
      "rate_limited",
      technical,
      "Wait for the shared Studio Next cooldown, then retry this read. Close duplicate VETO tabs while it recovers.",
    );
  if (/vite_veto_contract_address|contract address is missing|not configured/.test(text))
    return make(
      "The verified VETO contract address is not configured for this environment.",
      "configuration",
      technical,
      "Set VITE_VETO_CONTRACT_ADDRESS to the verified Studio Next deployment and reload the app.",
    );
  if (
    /failed to fetch|network request|network error|econn|timeout|timed out|server busy|rate limit|too many requests|\b429\b|rpc/.test(
      text,
    )
  )
    return make(
      "We couldn’t reach GenLayer Studio Next. Check your connection and try again shortly. No confirmed transaction result is available yet.",
      "rpc_unavailable",
      technical,
      "Retry after confirming that Studio Next is reachable.",
    );

  const expected = text.replace(/^.*?\[expected\]\s*/s, "");
  const contractMessages: Array<{
    match: RegExp;
    message: string;
    nextAction: string;
    kind?: VetoErrorKind;
  }> = [
    {
      match: /owner already used/,
      message:
        "This wallet already owns a registered agent. One agent identity is allowed per owner wallet.",
      nextAction: "Use the existing agent or connect a different owner wallet.",
      kind: "authorization",
    },
    {
      match: /operator already used/,
      message: "That operator address is already assigned to another agent.",
      nextAction: "Choose an unused operator address or keep the current operator.",
      kind: "authorization",
    },
    {
      match: /agent auth required/,
      message: "This wallet isn’t authorized to act for the selected agent.",
      nextAction: "Connect the agent’s owner or current operator wallet.",
      kind: "authorization",
    },
    {
      match: /owner only/,
      message: "Only the registered owner can update this agent.",
      nextAction: "Connect the agent owner wallet.",
      kind: "authorization",
    },
    {
      match: /creator only/,
      message: "Only the campaign creator can perform this action.",
      nextAction: "Connect the campaign creator wallet.",
      kind: "authorization",
    },
    {
      match: /funder only/,
      message: "Only the original proposal funder can claim this escrow refund.",
      nextAction: "Connect the wallet that funded the proposal.",
      kind: "authorization",
    },
    {
      match: /closed creator only/,
      message: "Only the creator of this closed campaign can recover its uncommitted remainder.",
      nextAction: "Connect the campaign creator wallet.",
      kind: "authorization",
    },
    {
      match: /unknown agent/,
      message: "That agent could not be found on the VETO contract.",
      nextAction: "Check the agent ID from a finalized registration transaction.",
      kind: "contract_state",
    },
    {
      match: /unknown campaign/,
      message: "That campaign could not be found on the VETO contract.",
      nextAction: "Refresh campaign discovery and open a current campaign record.",
      kind: "contract_state",
    },
    {
      match: /unknown proposal/,
      message: "That proposal could not be found on the VETO contract.",
      nextAction: "Refresh the campaign and open a current proposal record.",
      kind: "contract_state",
    },
    {
      match: /unknown challenge/,
      message: "That challenge could not be found on the VETO contract.",
      nextAction: "Refresh the proposal and use a current challenge record.",
      kind: "contract_state",
    },
    {
      match: /bad cap or reward/,
      message: "Choose at least one participating agent and a positive GEN reward.",
      nextAction: "Review the competition capacity and reward before submitting again.",
      kind: "validation",
    },
    {
      match: /bad campaign duration/,
      message: "Choose a campaign duration between 1 hour and 30 days.",
      nextAction: "Select a duration supported by the VETO contract.",
      kind: "validation",
    },
    {
      match: /funding mismatch/,
      message:
        "The campaign funding must exactly equal maximum agents multiplied by the reward per accepted winner.",
      nextAction: "Return to the transaction review and verify the exact GEN amount.",
      kind: "validation",
    },
    {
      match: /escrow mismatch/,
      message: "The proposal escrow value does not match the payment amount.",
      nextAction: "Review the proposal payment amount and submit the exact GEN value.",
      kind: "validation",
    },
    {
      match: /intake closed/,
      message:
        "This competition has reached its deadline or participation cap and is no longer accepting new submissions.",
      nextAction: "You can still review evaluations and complete settlement actions.",
      kind: "contract_state",
    },
    {
      match: /agent inactive/,
      message: "This agent is currently inactive and cannot submit challenges.",
      nextAction: "Ask the authorized owner to activate the agent.",
      kind: "authorization",
    },
    {
      match: /challenge cap reached/,
      message: "This proposal has reached its maximum number of challenges.",
      nextAction: "Review the existing ordered findings instead of submitting another challenge.",
      kind: "contract_state",
    },
    {
      match: /agent already entered campaign/,
      message:
        "This agent has already submitted a challenge in this competition. Each agent is allowed one submission per campaign.",
      nextAction: "Review the existing challenge record for this campaign.",
      kind: "contract_state",
    },
    {
      match:
        /bad evidence url|bad url authority|url is not a netlify host|bad url host|url has whitespace/,
      message:
        "Enter one valid HTTPS Netlify evidence URL without credentials, query parameters, fragments, ports or unsupported characters.",
      nextAction: "Check the URL format and use one public *.netlify.app deployment.",
      kind: "validation",
    },
    {
      match: /evidence.*unavailable|invalid body|invalid json|invalid format|redirect rejected/,
      message: "GenLayer could not retrieve valid evidence from the provided URL.",
      nextAction:
        "Confirm the Netlify file is public, UTF-8 JSON, within the size limits, and does not redirect.",
      kind: "contract_state",
    },
    {
      match: /context mismatch/,
      message: "The evidence does not match this campaign, proposal or policy.",
      nextAction: "Check the IDs and 1-based policy index in the evidence JSON.",
      kind: "validation",
    },
    {
      match: /proposal terminal/,
      message: "This proposal has already reached a terminal outcome.",
      nextAction: "Refresh the proposal before attempting another evaluation or settlement action.",
      kind: "contract_state",
    },
    {
      match: /bad proposal state|payment not executable|escrow not refundable/,
      message: "The current proposal state does not allow this action.",
      nextAction: "Refresh the proposal and follow the currently available settlement action.",
      kind: "contract_state",
    },
    {
      match: /earlier challenge pending/,
      message:
        "An earlier submission still needs to be resolved. This challenge cannot be declared the winner until submission priority is settled.",
      nextAction: "Evaluate or resolve the earlier challenge first, then retry this resolution.",
      kind: "contract_state",
    },
    {
      match: /challenge is not retryable/,
      message: "This challenge has reached its maximum evaluation attempts or is already terminal.",
      nextAction: "Review the final challenge status and use proposal resolution if eligible.",
      kind: "contract_state",
    },
    {
      match: /evaluation grace expired/,
      message: "The evaluation period for this challenge has ended.",
      nextAction: "Resolve the proposal so the contract can apply the final precedence rules.",
      kind: "contract_state",
    },
    {
      match: /campaign intake is open/,
      message: "This proposal cannot be cleared while the campaign still accepts new challenges.",
      nextAction: "Wait for the campaign cap or deadline, then resolve the proposal.",
      kind: "contract_state",
    },
    {
      match: /no claimable reward|claimable accounting error/,
      message: "There are no rewards available to claim for this agent in the selected campaign.",
      nextAction: "Refresh the agent and campaign records before trying again.",
      kind: "contract_state",
    },
    {
      match: /campaign obligations remain/,
      message: "This campaign still has unresolved proposals or reserved rewards.",
      nextAction:
        "Complete outstanding evaluations, proposal settlement and reward obligations before closing it.",
      kind: "contract_state",
    },
    {
      match: /remainder already claimed/,
      message: "This campaign remainder has already been claimed.",
      nextAction: "Refresh the campaign accounting; the same GEN cannot be claimed twice.",
      kind: "contract_state",
    },
    {
      match: /no campaign remainder/,
      message: "There is no uncommitted campaign GEN available to recover.",
      nextAction: "Refresh the campaign accounting and confirm that all rewards remain protected.",
      kind: "contract_state",
    },
    {
      match: /overflow|underflow/,
      message:
        "The contract rejected this amount because it would exceed its safe accounting bounds.",
      nextAction: "Review the amount and current on-chain accounting before trying again.",
      kind: "validation",
    },
  ];

  const match = contractMessages.find((entry) => entry.match.test(expected));
  if (match)
    return make(match.message, match.kind ?? "contract_state", technical, match.nextAction);

  if (/execution.*failed|execution error|reverted|failed transaction/.test(text))
    return make(
      "The transaction reached GenLayer but the contract did not execute it successfully.",
      "transaction_failed",
      technical,
      "Review the contract state and transaction details before trying again.",
    );

  return make(
    "The operation could not be completed. Check the current VETO state and try again.",
    "unknown",
    technical || "No technical error details were returned.",
    "Refresh the page. If the problem persists, expand the technical details and inspect the transaction on Explorer.",
  );
}

export function vetoErrorMessage(reason: unknown): string {
  return normalizeVetoError(reason).message;
}
