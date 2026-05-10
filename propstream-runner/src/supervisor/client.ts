import type { SupervisorDecision, SupervisorInput } from "./schema.js";

export interface SupervisorClient {
  decide(input: SupervisorInput): Promise<SupervisorDecision>;
}
