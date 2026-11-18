"""App settings loaded from environment variables (.env)."""
import os
from dotenv import load_dotenv

load_dotenv()

# LLM backend. Groq is the default (and only) provider.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

DATABASE_URL = os.getenv("DATABASE_URL", "")