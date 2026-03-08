export type EvidenceType = "commit" | "file" | "snippet" | "dependency" | "config" | "pull_request";

export interface Evidence {
  id: string;
  type: EvidenceType;
  hash: string;
  timestamp: string;
  ownership: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export type SkillInferenceMethod = "static" | "llm";

export interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: SkillInferenceMethod;
  strengths?: string[];
  reasoning?: string;
}

export type ClaimCategory = "language" | "framework" | "infrastructure" | "tool" | "practice";

export interface Claim {
  id: string;
  category: ClaimCategory;
  skill: string;
  confidence: number;
  evidence_ids: string[];
}

export type SignerType = "candidate" | "ci" | "policy";

export interface Signature {
  signer: SignerType;
  public_key: string;
  signature: string;
  timestamp: string;
  algorithm: "Ed25519";
}

export interface RepoInfo {
  url: string | null;
  head_commit: string;
}

export interface RepoEntry {
  url: string | null;
  head_commit: string;
  name: string;
}

export interface AuthorInfo {
  name: string;
  email: string;
  emails?: string[];
}

export interface Manifest {
  schema_version: "1.0";
  generated_at: string;
  repo: RepoInfo;
  author: AuthorInfo;
  evidence: Evidence[];
  skills: Skill[];
  claims: Claim[];
  signatures: Signature[];
  repos?: RepoEntry[];
}
