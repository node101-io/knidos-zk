import type { UserFillsRequest } from '../utils/fetch-raw-fills.js';
import type { PrimusAttest, PrimusSubmit } from './task.js';

// IPC contract between attest-runner.ts (parent) and attest-child.ts
// (child). One request message in, one response message out; both are
// plain JSON (child_process `serialization: 'json'`).

export interface AttestChildRequest {
  submit: PrimusSubmit;
  request: UserFillsRequest;
}

export type AttestChildResponse =
  | { ok: true; attest: PrimusAttest }
  | { ok: false; error: unknown };
