import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthState {
  signedIn: boolean;
}

// Whether the current request is signed in, for the sign in/out links.
export const authState = new AsyncLocalStorage<AuthState>();
