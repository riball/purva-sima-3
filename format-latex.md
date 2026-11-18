\documentclass[11pt]{article}

\usepackage[a4paper, top=0.50in, bottom=0.50in, left=0.65in, right=0.65in]{geometry}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}
\usepackage{setspace}
\usepackage[T1]{fontenc}
\usepackage{microtype}

% Charter: clean, readable serif -- closer to the image's feel than lmodern
\usepackage[charter]{mathdesign}

\titleformat{\section}
  {\normalsize\bfseries}{}{0em}{\MakeUppercase}[\vspace{-5pt}\rule{\linewidth}{0.5pt}]
\titlespacing*{\section}{0pt}{8pt}{5pt}

\setlist[itemize]{noitemsep, topsep=2pt, leftmargin=1.3em, label=\textbullet}
\pagenumbering{gobble}
\setstretch{1.04}

\begin{document}

% ── HEADER ──────────────────────────────────────────────────────
\begin{center}
    {\LARGE\bfseries Ankith D Prabhu}\\[4pt]
    {\small
    Bangalore, India \enspace\textbar\enspace
    \href{mailto:ankithdprabhu46@gmail.com}{ankithdprabhu46@gmail.com} \enspace\textbar\enspace
    \href{tel:+916360000388}{+91 63600 00388} \enspace\textbar\enspace
    \href{https://linkedin.com/in/ankith-d-prabhu}{linkedin.com/in/ankith-d-prabhu} \enspace\textbar\enspace
    \href{https://github.com/Ankxth}{github.com/Ankxth}}\\[3pt]
    {\small Full-stack-leaning CS undergraduate who ships systems with real users --- auth, databases, document generation, and multi-service architecture.}
\end{center}

% ── EDUCATION ───────────────────────────────────────────────────
\section*{Education}

\noindent\textbf{Dayananda Sagar University} \hfill Bangalore, India \\
{\small B.Tech in Computer Science Engineering (AI \& ML) \enspace|\enspace CGPA: 8.4} \hfill {\small Aug 2023 -- May 2027}

\vspace{2pt}
\noindent\textbf{Deeksha Jnana Sweekar PU College} \hfill Bangalore, India \\
{\small PCMB (Science)} \hfill {\small 2019 -- 2021}

% ── EXPERIENCE ──────────────────────────────────────────────────
\section*{Experience}

\noindent\textbf{Software Developer (Freelance) --- Spoorti Technologies} \hfill {\small Jul 2026 -- Present} \\
{\small Project: TSE Offer Generator --- internal automation platform} \hfill {\small Python, FastAPI, PostgreSQL, Alembic, React}
\begin{itemize}\small
    \item Built an internal platform for Tech Sphere Engineering, an industrial air-engineering firm, where engineers enter values and receive calculated, bill-style reports, replacing manual Excel-based entry.
    \item Implemented JWT-based auth with role-gated access (admin vs.\ engineer) and Alembic-managed database migrations.
    \item Automated Word, Excel, and PDF offer-document generation from engineering input, with live climate-data integration (Open-Meteo).
    \item Built the machine catalog storing the company's machine details.
\end{itemize}

\vspace{3pt}
\noindent\textbf{Software Developer --- DSU $\times$ Puravankara Embodied Carbon Project} \hfill {\small Aug 2026 -- Oct 2026} \\
{\small Project: \href{https://github.com/riball/purva-sima-3}{Purva Sima --- BOQ analysis \& estimation web app}} \hfill {\small FastAPI, React/Vite, pandas, Recharts, Groq/Ollama}
\begin{itemize}\small
    \item Built a full-stack platform covering embodied carbon, construction cost, and operational emissions, with multi-company project tracking and interactive dashboards.
    \item Engineered carbon engines that convert raw BOQ spreadsheets and Work Order PDFs into line-by-line kg\,CO\textsubscript{2}e, using a material classifier and a single CEA-adjusted ICE emission-factor source.
    \item Implemented a material-substitution engine that re-computes carbon on affected line items, plus bill-based construction tracking against a project baseline with an audit log.
    \item Designed a ``what-if'' chatbot where the LLM only parses questions into calls on the real recompute path, keeping every reported number traceable.
\end{itemize}

% ── PROJECTS ────────────────────────────────────────────────────
\section*{Selected Projects}

\noindent\textbf{\href{https://github.com/Ankxth/ppbig}{PaperPilot --- Academic Paper Formatting Toolkit}} \hfill {\small FastAPI, React/Vite, Firebase, LaTeX, Groq API}
\begin{itemize}\small
    \item Built an automated LaTeX rendering pipeline converting raw manuscripts into IEEE/APA/MLA-formatted PDFs.
    \item Engineered a Firebase-backed real-time collaborative editor alongside citation-detection and AI-critique modules.
    \item Unified document formatting, review tooling, and live collaboration into a single full-stack workflow.
\end{itemize}

\vspace{3pt}
\noindent\textbf{\href{https://github.com/Ankxth/Noah}{Noah --- AI-Powered VSCode Coding Companion}} {\small (ongoing)} \hfill {\small Python, FastAPI, TypeScript, ChromaDB, LiteLLM}
\begin{itemize}\small
    \item Designing a FastAPI daemon that indexes codebases into ChromaDB, giving the extension persistent semantic memory across sessions.
    \item Orchestrating multiple LLM providers (Gemini, Groq, Mistral) via LiteLLM with BYOK support and automatic context compression.
    \item Building a self-healing code-generation loop that writes files to disk and re-prompts automatically on test failure.
\end{itemize}

% ── TECHNICAL SKILLS ─────────────────────────────────────────────
\section*{Technical Skills}

\begin{itemize}\small
    \item \textbf{Languages:} Python, Java, TypeScript, SQL
    \item \textbf{Backend \& Frameworks:} FastAPI, React, Node.js
    \item \textbf{Data \& Cloud:} PostgreSQL, MongoDB, AWS, Docker, GitHub Actions
    \item \textbf{Tools:} Git, GitHub, Postman, Firebase, ChromaDB
    \item \textbf{Certifications:} LeetCode 260+ problems solved $\cdot$ AWS Academy Cloud Foundations
\end{itemize}

\end{document}