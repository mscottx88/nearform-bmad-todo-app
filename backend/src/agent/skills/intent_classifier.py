from crewai import Crew, Process, Task

from src.agent.skills.base import build_base_agent
from src.agent.skills.registry import SkillContext


def build(ctx: SkillContext) -> Crew:
    """Single-agent crew that returns the best matching skill name."""
    from src.agent.skills.registry import SKILL_REGISTRY  # noqa: PLC0415

    skill_list = "\n".join(
        f"- {name}: {spec.description}"
        for name, spec in SKILL_REGISTRY.items()
        if name != "intent_classifier"
    )

    agent = build_base_agent(
        role="Intent Classifier",
        goal=(
            "Analyse the user message and return exactly one skill name"
            " from the registry. Output only the bare skill name —"
            " no markdown, no punctuation, no explanation."
        ),
        backstory_extra=(
            f"Available skills:\n{skill_list}\n\nIf uncertain, return 'chat'."
        ),
        llm=ctx.llm,
    )

    task = Task(
        description=(
            f"User message: {ctx.user_message!r}\n\n"
            "Return the single best skill name from the registry above."
        ),
        expected_output="A bare skill name string (e.g. 'chat')",
        agent=agent,
    )

    return Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
