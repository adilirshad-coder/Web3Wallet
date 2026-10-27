import type { ApprovedAttestation, VerifierSigner } from "./verifier-signer.js";

export interface AttestationJobQueue {
  enqueue(attestation: ApprovedAttestation): Promise<void>;
}

export class MemoryAttestationJobQueue implements AttestationJobQueue {
  constructor(private readonly signer: VerifierSigner, private readonly onFailure: (error: unknown) => void = () => {}) {}

  async enqueue(attestation: ApprovedAttestation): Promise<void> {
    queueMicrotask(() => {
      void this.signer.setVerification(attestation).catch(this.onFailure);
    });
  }
}

export class NullAttestationJobQueue implements AttestationJobQueue {
  async enqueue(_attestation: ApprovedAttestation): Promise<void> {
    throw new Error("VerifierSigner is not configured for background attestation jobs");
  }
}
