"""Base class for conversational agents in the Mega-Agent Orchestrator."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime
    from .proxy_client import ClaudeProxyClient


@dataclass
class AgentResponse:
    content: str
    actions_taken: list[dict] = field(default_factory=list)
    confirmation: dict | None = None
    data: dict | None = None


class ConversationalAgent(ABC):
    agent_type: str = ""
    system_prompt: str = ""

    def __init__(self, store: HermesStore, runtime: HermesRuntime | None,
                 proxy: ClaudeProxyClient):
        self.store = store
        self.runtime = runtime
        self.proxy = proxy

    @abstractmethod
    def get_operations(self) -> list[dict]:
        """Return the list of operations this agent can perform.
        Each dict has: name, description, params (list of param dicts), tier ('read'|'write'|'approval')
        """
        ...

    @abstractmethod
    def execute_operation(self, operation: str, params: dict, user: dict) -> dict:
        """Execute a single operation and return the result."""
        ...

    def handle(self, message: str, context: list[dict], user: dict,
               conversation_id: int | None = None) -> AgentResponse:
        ops = self.get_operations()
        ops_description = "\n".join(
            f"- {op['name']}: {op['description']} [tier: {op['tier']}]"
            + (f"\n  params: {json.dumps(op.get('params', []))}" if op.get('params') else "")
            for op in ops
        )

        state_snapshot = self._get_state_snapshot()

        prompt = f"""You are the {self.agent_type} agent for a real estate wholesaling CRM.

{self.system_prompt}

AVAILABLE OPERATIONS:
{ops_description}

CURRENT STATE:
{state_snapshot}

CONVERSATION CONTEXT:
{self._format_context(context)}

USER REQUEST: {message}

Respond with a JSON object:
{{
  "operations": [
    {{"name": "operation_name", "params": {{...}}}}
  ],
  "response": "Natural language response to show the user"
}}

Rules:
- For read operations, execute and include results in your response text.
- For write operations, execute immediately and confirm in response.
- For approval-tier operations, set the operation but note it needs confirmation.
- If no operation matches, just respond conversationally with what you know.
- Keep responses concise and specific with numbers.
- ALWAYS return valid JSON. No markdown wrapping."""

        ai_response = self.proxy.prompt(prompt, system=self.system_prompt)

        if not ai_response:
            return self._handle_without_ai(message, user, conversation_id)

        try:
            parsed = json.loads(ai_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())
        except json.JSONDecodeError:
            return AgentResponse(content=ai_response)

        actions_taken = []
        confirmation = None
        response_text = parsed.get("response", "Done.")

        for op_call in parsed.get("operations", []):
            op_name = op_call.get("name", "")
            op_params = op_call.get("params", {})

            op_def = next((o for o in ops if o["name"] == op_name), None)
            if not op_def:
                continue

            if op_def["tier"] == "approval":
                desc = f"{op_def['description']}"
                if op_params:
                    desc += f" (params: {json.dumps(op_params)})"

                if conversation_id is not None:
                    cid = self.store.create_pending_confirmation(
                        conversation_id=conversation_id,
                        agent_type=self.agent_type,
                        action=op_name,
                        params=op_params,
                        description=desc,
                    )
                    confirmation = {
                        "id": cid,
                        "action": op_name,
                        "description": desc,
                        "params": op_params,
                    }
                continue

            try:
                result = self.execute_operation(op_name, op_params, user)
                actions_taken.append({
                    "operation": op_name,
                    "params": op_params,
                    "result": result,
                })
            except Exception as e:
                actions_taken.append({
                    "operation": op_name,
                    "params": op_params,
                    "error": str(e),
                })

        return AgentResponse(
            content=response_text,
            actions_taken=actions_taken,
            confirmation=confirmation,
        )

    def _handle_without_ai(self, message: str, user: dict,
                           conversation_id: int | None) -> AgentResponse:
        """Keyword-based fallback when Claude proxy is unavailable."""
        msg = message.lower()
        ops = self.get_operations()

        for op in ops:
            keywords = op.get("keywords", [])
            if any(kw in msg for kw in keywords):
                if op["tier"] == "approval":
                    if conversation_id is not None:
                        cid = self.store.create_pending_confirmation(
                            conversation_id=conversation_id,
                            agent_type=self.agent_type,
                            action=op["name"],
                            params={},
                            description=op["description"],
                        )
                        return AgentResponse(
                            content=f"This action requires confirmation: {op['description']}",
                            confirmation={"id": cid, "action": op["name"],
                                          "description": op["description"], "params": {}},
                        )
                try:
                    fallback_params = {"_raw_message": message}
                    result = self.execute_operation(op["name"], fallback_params, user)
                    summary = self._summarize_result(result)
                    return AgentResponse(
                        content=summary or f"Done. ({op['description']})",
                        actions_taken=[{"operation": op["name"], "result": result}],
                        data=result if isinstance(result, dict) else None,
                    )
                except Exception as e:
                    return AgentResponse(content=f"Error: {e}")

        return AgentResponse(
            content="I couldn't understand that request. AI is currently offline for detailed interpretation. Try a simpler command.",
        )

    def _summarize_result(self, result: Any) -> str | None:
        """Generate a human-readable summary of an operation result."""
        if not isinstance(result, dict):
            return None
        lines = []
        for key, val in result.items():
            if isinstance(val, (int, float)):
                lines.append(f"{key.replace('_', ' ').title()}: {val:,}" if isinstance(val, int) else f"{key.replace('_', ' ').title()}: {val:.1f}")
            elif isinstance(val, dict):
                items = [f"{k}: {v:,}" if isinstance(v, int) else f"{k}: {v}" for k, v in val.items()]
                if items:
                    lines.append(f"{key.replace('_', ' ').title()}: {', '.join(items[:8])}")
            elif isinstance(val, list) and len(val) > 0:
                lines.append(f"{key.replace('_', ' ').title()}: {len(val)} items")
        return "\n".join(lines) if lines else None

    def _get_state_snapshot(self) -> str:
        """Override in subclasses to provide current state context."""
        return "No state snapshot available."

    def _format_context(self, context: list[dict]) -> str:
        if not context:
            return "(No prior messages)"
        lines = []
        for msg in context[-10:]:
            role = msg.get("role", "?")
            content = msg.get("content", "")
            agent = msg.get("agent_type", "")
            prefix = f"[{role}]" if not agent else f"[{role}/{agent}]"
            lines.append(f"{prefix} {content[:200]}")
        return "\n".join(lines)
