import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { Campaign } from "@/lib/veto/domain";
import { campaignLabel, formatGen, formatDuration, shortAddress } from "@/lib/veto/domain";
// Render only records returned by the authoritative contract adapter.
export function CampaignCards({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div className="campaign-grid">
      {campaigns.map((c) => (
        <Link to="/campaign/$id" params={{ id: c.id }} key={c.id} className="campaign-card">
          <span className="eyebrow">{campaignLabel(c)}</span>
          <h3>{c.name}</h3>
          <p>{c.description}</p>
          <div className="card-bottom">
            <span>
              <span className="eyebrow">FIXED REWARD</span>
              <p>{formatGen(c.rewardPerAcceptedAgent)} GEN / winner</p>
            </span>
            <ArrowUpRight size={18} />
          </div>
          <p className="mt-3">
            {c.remainingAgentSlots} of {c.maxAgents} slots remain ·{" "}
            {formatDuration(c.durationSeconds)}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Creator {shortAddress(c.creator)} · {c.acceptedAgents} winning findings · deadline{" "}
            {new Date(c.deadline * 1000).toLocaleDateString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatGen(c.rewardFunded)} GEN fixed funding · {c.proposalCount} proposals
          </p>
        </Link>
      ))}
    </div>
  );
}
