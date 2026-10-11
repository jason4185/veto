<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## VETO architecture

- Keep GenLayer domain types, chain config and exact BigInt GEN helpers in `src/lib/veto`; chain state must come only from the audited contract adapter, never local storage or a database.
- Block reads and writes until the deployed address, verified RPC and audited ABI are available; this prevents invented state or unsafe guessed calls.
- Use EIP-1193 solely for real wallet identity and network detection; wallet connection never implies contract transaction readiness.
- Put shared chrome in the root route and individual content in leaf routes with unique metadata; this preserves navigable, shareable pages.
- Define visual roles and responsive styles in the global design system and use shared shadcn controls for commands; this keeps pages coherent.
