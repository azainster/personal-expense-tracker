/**
 * Hands a pasted email from the Parser lab to the trace screen in memory, instead of pushing
 * email text through navigation params (which can be logged by navigation tooling).
 */
export interface PastedEmail {
  from: string;
  subject: string;
  body: string;
}

let pending: PastedEmail | null = null;

export function setPendingTrace(email: PastedEmail): void {
  pending = email;
}

export function takePendingTrace(): PastedEmail | null {
  return pending;
}
