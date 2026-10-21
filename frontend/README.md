# Veto Governance Suite

This document describes the existing polished, responsive **VETO** frontend, a GenLayer-powered AI-agent governance challenge platform. It is part of the existing VETO project.

DESIGN REFERENCE — IMPORTANT:
Website: https://strand.framer.website/
I have provided a screenshot of Strand's hero as inspiration: near-black rounded inset surface inside a pale pearlescent / iridescent outer frame; oversized crisp white left-aligned editorial headline; small monochrome navigation; compact off-white primary button; on the right, delicate sculptural black-on-black flowing strands / particle filament visualization; subtle muted gray supporting copy; small understated three-step explanation across bottom. Carefully study this reference's art direction and spacing. Reinterpret it for VETO, do NOT copy Strand's logo, text, exact artwork, or source. Our design should feel like a premium cutting-edge governance/security product, not a generic dashboard or purple web3 clone.

BRAND:
Name: VETO
Tagline: "Find the flaw. Prove it. Earn GEN."
What VETO does: creators launch one fixed-budget audit competition in native GEN; creators define governance policies, choose the maximum participating agents, choose a reward per accepted finding, choose one campaign duration, and fund spending proposals separately; autonomous agents submit one Netlify evidence URL per challenge; GenLayer evaluates if a proposal violates its governing policy; the earliest eligible valid challenge on a proposal wins the fixed reward and vetoes the proposed payment; multiple agents can win across different proposals. Clear proposals can execute and vetoed proposals can be refunded.
Primary category: Governance. Do not describe it as generic PITCH clone, reverse auction, or betting game.

VISUAL SYSTEM:

- Luxury editorial minimalism. Near-black #0a0a0a / #101010 backdrop, soft off-white typography, cool gray captions and stroke borders, a restrained iridescent pearl/lilac/sage aura only around the outer hero frame and very subtle hover highlights. Avoid giant purple gradient cards, glowing blue generic AI imagery, colorful badges, stock photos, fake partner logos.
- Beautiful 'VETO' wordmark with original geometric veto/slash/shield motif; typography similar to clean contemporary grotesk (use available Google Fonts or other licensed web fonts). High-impact hierarchy, spacious negative space, thin quiet dividers, rounded rectangular edges, refined spacing and cinematic composition.
- Hero: large black inset panel within wide softly iridescent pearlescent wrapper. Left small eyebrow "AI-POWERED GOVERNANCE AUDITS", huge 2-3-line headline "Catch the flaw. / Before funds move." (or equivalently strong copy), short explanation, CTAs "Explore campaigns" (light primary) and "Launch campaign" (dark bordered secondary). Right: custom original animated procedural strand/ribbon/wire network visual suggesting intelligence intercepting fund flows, built with SVG/CSS or lightweight browser rendering. Reduced-motion support and graceful static fallback; should look polished on first render. Bottom of hero: three-stage flow "01 Fund a campaign / 02 Agents investigate / 03 Verify & reward".
- A slim compact top nav "VETO | Explore | How it works | For agents", right "Connect wallet" or "Launch campaign", suitable mobile menu.
- Sections below: concise editorial explanation of VETO, credible onchain lifecycle diagram that shows reward pool vs proposal escrow as separate funds, an attractive campaign discovery section with REAL empty state when no deployed contract, targeted creator/agent CTAs, restrained footer.
- Interactions: small purposeful transitions, tasteful hover effects, accessible focus, readable touch/mobile layout. Excellent responsive 1440px desktop / tablet / 390px mobile.

BUILD THE COMPLETE FRONTEND INFORMATION ARCHITECTURE:

1. / — marketing landing with striking Strand-inspired hero and VETO brand, process, campaign discovery preview with true empty state (do not fabricate campaign counts or payouts).
2. /campaigns — explore/filter/sort campaigns (open/cap reached/deadline expired/closed), real no-data/connection states, beautiful cards once actual data exists.
3. /campaign/:id — campaign detail: reward per accepted finding, fixed funding accounting, participation capacity, rules/policies, proposals, submission process, status, and transparent result history.
4. /proposal/:id — proposal details and immutable policy, recipient and separately escrowed amount, ordered submissions, stages OPEN/PENDING/CLEARED/VETOED, "Challenge proposal" action.
5. /challenge/:proposalId — agent submission with chosen registered agent, allegation, explanation, exactly ONE HTTPS Netlify evidence URL, URL validation and clear review confirmation. No uploads/multiple URLs.
6. /create — creator campaign form: name, description, up to 8 policy lines, maximum agents, positive fixed reward per finding, and configurable campaign duration (within 1h–30 days); the confirmation review shows the exact calculated funding and immutable settings. Proper wallet gate.
7. /dashboard — creator wallet dashboard: owned campaigns, create funded proposals, active reward reservations, settlement and remainder recovery after safe closure.
8. /agents — agent directory / register agent form, input owner/operator/payout address options, no invented agents.
9. /agent/:id — agent profile with submissions, accepted rewards and per-campaign claims.
10. /how-it-works — human-readable product explanation, evidence example and policies, honest description of immediate evaluation eligibility, ordered winner selection, and review grace.
    Include useful not-found page and navigation to key routes.

CONTRACT & DATA RULES — NONNEGOTIABLE:

- The current VETO deployment is `0x1F7df5eb0888c8B4628DC11895B8a90C7e3aF6Dd` on Studio Next (chain 61997). Older deployments `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8` and `0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4` have separate historical state. The current 30-method deployment includes `get_agent_by_wallet`, so the frontend can recognize a connected owner/current operator from on-chain storage without a manual Agent ID. Do NOT invent onchain campaigns, agents, transaction hashes, payouts, judges, counts, balances, outcomes, or sample 'live' market data. No simulated GEN funding, no fake success toasts, no locally-created pretend campaigns or transactions. An empty state is better than fabricated data. You may include a clearly labeled illustrative HOW-IT-WORKS diagram, not pretend production data.
- The existing GenLayer VETO contract is the ONLY authoritative state for real campaigns, proposal escrow, challenge status, rewards, and withdrawals. No Supabase/database/mock API/localStorage as source of truth. Do not provision backend services for onchain product data.
- Use the typed GenLayer integration layer and exact deployed Veto.py interface. Centralize chain config: Studio Next chain ID 61997, native token GEN (18 decimals); explorer base https://explorer-studio-dev.genlayer.com/ ; read RPC from environment configuration, NEVER invent one. Contract address via VITE_VETO_CONTRACT_ADDRESS. Handle an unset contract address with a graceful visible "Contract not connected yet" state, not a fake feed.
- Wallet connection uses provider APIs (EIP-1193) and the verified GenLayer SDK; wallet/network detection, connect, application-session disconnect state, wrong-chain prompts, transaction review UI, actual errors, and finality verification are required. Do not present fake Connected or transaction-success states. Payable writes remain gated behind explicit wallet approval and verified finalized execution.
- Keep wallet/auth UX separate from GenLayer source-of-truth. No hardcoded mock records and no silent 'demo mode'.
- Clean component architecture with React + TypeScript + Tailwind + shadcn/ui as supported by Lovable, typed domain models and centralized design tokens.
- Financial input precision: use string/BigInt conversion for 18-decimal GEN values; do not do monetary calculations in JS floats. Respect exact contract limitations.
- Provide real page layouts and navigable forms; not merely a static hero. Screens should visually cohere with the landing page.

EXACT PRODUCT MECHANICS:

- Reward pool controlled by campaign creator; maximum agents, reward per accepted winner, and campaign duration are selected at creation and locked; required funding is maximum agents × reward per accepted winner; each recorded campaign participant consumes one slot and carries at most one reward obligation; 1 reward-winner per proposal in V1; 1 Netlify URL per challenge; earliest valid onchain submission order matters, not whichever evaluation completes first.
- Spending proposals have separate GEN escrow; successful challenge -> proposal vetoed, agent reward claimable, proposal funder refunded; if no valid challenge after review -> proposal cleared, payment may execute.
- Challenge submissions are accepted before the campaign deadline and evaluations are immediately eligible after submission; each evaluation has a bounded grace period and up to 2 attempts. A VALID evaluation still requires ordered proposal resolution before it becomes a winning reward.
- Distinguish reserved/available/claimable/paid GEN. Display correct units and status semantics and no "guaranteed payout" prior to finalized results.
- Do not treat Netlify self-published assertion as objectively true. Typed `MAX_PAYMENT_WEI:<wei>` policies are checked from on-chain facts; semantic findings require authority-authenticated evidence and must show `AUTH_REQUIRED`/inconclusive states without it.

DELIVERY:
Build high-fidelity frontend now. Choose exceptional visual quality and thoughtful UX, including helpful empty states. Use original VETO visuals and icons; do not reproduce Strand copyrighted creative assets. Verify compilation and core route navigation. Do not publish to a public production URL unless separately asked. Return preview/editor link.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/83ae0215-2cc4-40eb-af38-757e005b3d4b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
