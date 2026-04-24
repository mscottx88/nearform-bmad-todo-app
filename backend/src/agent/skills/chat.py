from crewai import Crew, Process, Task

from src.agent.skills.base import build_base_agent
from src.agent.skills.registry import SkillContext
from src.agent.tools.get_chat_history import GetChatHistoryTool
from src.agent.tools.get_todo import GetTodoTool
from src.agent.tools.list_todos import ListTodosTool
from src.agent.tools.search_todos import SearchTodosTool


def build(ctx: SkillContext) -> Crew:
    """Free-form chat crew with all four read-only tools."""
    tools = [
        ListTodosTool(session_factory=ctx.session_factory),
        GetTodoTool(session_factory=ctx.session_factory),
        SearchTodosTool(session_factory=ctx.session_factory),
        GetChatHistoryTool(session_factory=ctx.session_factory),
    ]

    agent = build_base_agent(
        role="Pond Assistant",
        goal=(
            "Help the user understand and manage their todos "
            "by answering questions accurately."
        ),
        tools=tools,
        llm=ctx.llm,
    )

    task = Task(
        description=ctx.user_message,
        expected_output="A helpful, concise response to the user's message.",
        agent=agent,
    )

    return Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
