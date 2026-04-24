from typing import Any

from crewai import Agent

from src.agent.system_prompt import BASE_SYSTEM_PROMPT


def build_base_agent(
    role: str,
    goal: str,
    backstory_extra: str = "",
    tools: list[Any] | None = None,
    llm: object = None,
) -> Agent:
    """Construct a CrewAI Agent with the base system prompt included."""
    backstory = BASE_SYSTEM_PROMPT
    if backstory_extra:
        backstory = f"{backstory}\n\n{backstory_extra}"
    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        tools=tools or [],
        llm=llm,
        verbose=False,
    )
