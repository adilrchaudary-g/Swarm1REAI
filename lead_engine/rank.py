from .config import PERSONA_URGENCY_ORDER, DEFAULT_TOP_N


def _persona_urgency_rank(persona: str) -> int:
    try:
        return PERSONA_URGENCY_ORDER.index(persona)
    except ValueError:
        return len(PERSONA_URGENCY_ORDER)


def _equity_ratio(lead: dict) -> float:
    est_value = lead.get("est_value") or 0
    est_equity = lead.get("est_equity") or 0
    if est_value <= 0:
        return 0.0
    return est_equity / est_value


def _arv_band_score(lead: dict) -> int:
    arv = lead.get("est_value") or 0
    if 200_000 <= arv <= 350_000:
        return 0
    if 150_000 <= arv < 200_000:
        return 1
    if 350_000 < arv <= 500_000:
        return 2
    return 3


def _contact_quality(lead: dict) -> int:
    if lead.get("has_cell"):
        return 0
    if lead.get("phone_count", 0) > 0:
        return 1
    if lead.get("emails"):
        return 2
    return 3


def rank_sort_key(lead: dict):
    return (
        -lead.get("motivation_score", 0),
        _persona_urgency_rank(lead.get("persona_primary", "")),
        -_equity_ratio(lead),
        _arv_band_score(lead),
        _contact_quality(lead),
        -lead.get("phone_count", 0),
    )


def run_rank(proceed: list[dict], top_n: int = DEFAULT_TOP_N) -> tuple[list[dict], list[dict]]:
    ranked = sorted(proceed, key=rank_sort_key)

    for i, lead in enumerate(ranked):
        lead["rank"] = i + 1

    top = ranked[:top_n]
    rest = ranked[top_n:]

    if top:
        score_range = f"{top[-1].get('motivation_score', 0)}-{top[0].get('motivation_score', 0)}"
        personas = {}
        for l in top:
            p = l.get("persona_primary", "Unknown")
            personas[p] = personas.get(p, 0) + 1
        persona_str = ", ".join(f"{v} {k}" for k, v in sorted(personas.items(), key=lambda x: -x[1]))
        print(f"RANK     Top {len(top)} selected (scores {score_range})")
        print(f"         {persona_str}")
    else:
        print(f"RANK     No leads qualified")

    if rest:
        print(f"         {len(rest)} remaining as qualified-pending")

    return top, rest
