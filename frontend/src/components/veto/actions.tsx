import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { connectionState } from "@/lib/veto/domain";
import type { ContractWrite } from "@/lib/veto/contract";
import { TransactionRunner } from "@/lib/veto/transaction";
import { useWallet } from "@/lib/veto/wallet";
import { invalidateVetoQueries, invalidationKeysForWrite } from "@/lib/veto/hooks";
import { VetoErrorNotice } from "./shared";

export function ContractAction({
  write,
  label,
  disabled = false,
}: {
  write: ContractWrite;
  label: string;
  disabled?: boolean;
}) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>();
  const [txId, setTxId] = useState("");
  const available =
    connectionState === "ready" &&
    wallet.status === "connected" &&
    Boolean(wallet.kit && wallet.connectedClient);
  return (
    <div className="action-stack">
      <Button
        type="button"
        disabled={disabled || !available}
        onClick={() => {
          setError("");
          setTxId("");
          setOpen(true);
        }}
      >
        {available ? label : "Connect contract and wallet"}
      </Button>
      {Boolean(error) && <VetoErrorNotice error={error} />}
      {txId && <p className="text-xs text-muted-foreground">Finalized: {txId}</p>}
      {open && wallet.kit && wallet.connectedClient && (
        <TransactionRunner
          kit={wallet.kit}
          client={wallet.connectedClient}
          write={write}
          label={label}
          onSuccess={(id) => {
            setTxId(id);
            setOpen(false);
            void invalidateVetoQueries(
              queryClient,
              invalidationKeysForWrite(write, queryClient, {
                address: wallet.address,
                chainId: wallet.chainId,
              }),
            );
          }}
          onError={(reason) => {
            setError(reason);
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </div>
  );
}
