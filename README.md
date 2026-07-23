# LearnSync AI: An Artificial Intelligence-Based Personalized Learning Companion for Pasig Christian Academy

## 🏗️ Project Overview

**LearnSync AI** is an AI-powered personalized learning companion designed to enhance the independent learning of Junior High School students at Pasig Christian Academy. The platform integrates **Bayesian Knowledge Tracing (BKT)** and **Generative Artificial Intelligence (GenAI)** to provide adaptive learning activities, AI-assisted study strategies, gamified learning experiences, and personalized learning analytics — all within a single, centralized platform.

Rather than replacing the school's existing instructional practices, LearnSync AI complements the current independent learning process by providing personalized learning support derived exclusively from **educator-uploaded instructional materials**.

> ### 🚀 Production Architecture
>
> This repository contains the complete codebase for the production-ready implementation of LearnSync AI. The platform follows a **dual-portal, three-tier architecture** with an **Educator Portal** for material management and student monitoring, and a **Student Portal** for AI-assisted independent learning. The system runs a **React** client, **Node.js/Express** API gateway, and **Supabase (PostgreSQL + pgvector)** database tier.

---

## 👥 User Roles

LearnSync AI operates under three distinct user roles:

| Role | Responsibilities |
| :--- | :--- |
| **Admin** | Manages user accounts (creating, editing, disabling accounts for educators and students). Does not interact with learning content, study activities, or analytics. |
| **Educator** | Uploads and manages official learning materials (PDF documents), assigns grade-level access controls, and monitors student learning progress through a class-level analytics dashboard. |
| **Student** | Accesses educator-uploaded learning materials assigned to their grade level and engages with the platform's AI-assisted learning features. |

---

## 🎯 Core Purpose & Philosophy

LearnSync AI is built around a single mission: enhancing independent learning through AI-driven tools that understand and respond to each student's unique learning needs:

* **For Students:** A personal, adaptive study environment where every tool — flashcards, free recall, Feynman technique, adaptive tests, and games — actively adapts to their current knowledge level using real-time BKT mastery tracking, all grounded in educator-verified learning resources.
* **For Educators:** A secure portal for uploading and managing official learning resources, with real-time visibility into students' learning progress and mastery statistics, without significantly increasing their workload.
* **For the Institution:** A centralized, AI-assisted learning platform that complements existing curriculum and instructional practices, designed strictly for asynchronous independent study at home.

---

## 🛠️ Technical Configuration (The 3-Tier Architecture)

The production infrastructure follows a dual-portal, three-tier model:

| Layer | Component | Technologies Used | Operational Focus |
| :--- | :--- | :--- | :--- |
| **Presentation** | Educator Dashboard | React, Tailwind CSS | Material upload, grade-level access control, class-level mastery analytics. |
| **Presentation** | Student Portal (Study Space Hub, PlayMe Portal, Dashboard) | React, Tailwind CSS | Study space access, adaptive learning activities, gamified review, personal analytics. |
| **Application** | API Gateway | Node.js / Express | Routing, input validation, JWT authentication, role-based access control. |
| **Application** | AI & BKT Engine | Express backend + Gemini/Groq APIs | Document parsing, concept extraction, BKT mastery calculation, adaptive content generation, AI feedback. |
| **Data Tier** | Unified Backend | Supabase (PostgreSQL + pgvector) | Relational storage, vector embeddings, Blob storage, Row-Level Security (RLS) for multi-tenant data isolation. |

---

## ✨ System Features & Core Modules

### 📚 1. Study Spaces (Educator-Managed Content)

The central hub of LearnSync AI. Study spaces are created from **educator-uploaded learning materials** assigned to specific grade levels. Students access materials uploaded by their teachers and engage with the platform's learning features. Every study space contains **five dedicated tabs**:

| Tab | Purpose |
| :--- | :--- |
| **Flashcards** | AI-generated and manual flashcards with spaced repetition + BKT |
| **Free Recall** | Open-ended memory retrieval evaluated by AI |
| **Feynman Technique** | Concept explanation evaluated by AI through a 3-step pipeline |
| **Test Mode** | Adaptive AI-generated practice tests driven by BKT mastery |
| **Course Resources** | View educator-uploaded materials + integrated AI chatbot |

> **Material Access:** Only authenticated educators can upload learning resources. Educators select which grade level(s) can access each material. Students receive access only to materials assigned to their grade level. The platform accepts plain-text PDF learning modules (max 20 MB) and image-based/scanned PDFs (max 20 pages).

---

### 🧠 2. Adaptive Learning Engine (BKT-Powered)

All study tools inside a study space are powered by **Bayesian Knowledge Tracing (BKT)**, the classical four-parameter probabilistic model implemented directly in the platform backend. BKT continuously estimates each student's latent mastery (0.0–1.0) per concept based on their sequential responses.

#### Default BKT Parameters
Since LearnSync AI has no pre-existing historical student interaction data, **Expectation Maximization (EM) fitting is not used**. The system does **NOT** use pyBKT. Instead, BKT parameters are initialized using empirically grounded default values (Bulut et al., 2023):

| Parameter | Value | Description |
| :--- | :--- | :--- |
| P(L₀) | 0.10 | Initial knowledge state — conservative 10% prior |
| P(T) | 0.20 | Learning rate — 20% transition probability per learning opportunity |
| P(S) | 0.15 | Slip probability — 15% chance of careless error |
| P(G) | Context-sensitive | Varies by assessment mode and question format |

> **Self-Correcting:** BKT is inherently self-correcting. The Bayesian updating mechanism continuously refines mastery estimates as interaction data accumulates. Default parameters serve as reasonable initialization points, and accuracy improves organically through practice.

#### 🃏 Flashcards (Spaced Repetition + BKT)
- Students can manually create flashcards or use **AI Auto-Generation**, which reads the educator-uploaded course materials to generate relevant cards automatically.
- When a student reviews a card, they self-rate their recall:
  - ✅ **Easy** → obs=1, P(G)=0.05 → Card reappears in **7 days** (Leitner later tier)
  - 🟡 **Medium** → obs=1, P(G)=0.25 → Card reappears in **3 days** (Leitner intermediate tier)
  - 🔴 **Hard** → obs=0, P(G)=0.10 → Card reappears in **1 day** (Leitner first tier)
- Each rating event triggers a **BKT two-phase update** (evidence update → transition update), updating the student's mastery score for that concept.

#### ✍️ Free Recall
- Students type out everything they remember from their studied materials without any reference.
- The AI evaluates the submission using `pgvector` cosine similarity to compare the student's text against reference concept embeddings.
- AI provides structured feedback identifying:
  - Concepts the student **missed entirely**
  - Areas where their understanding is **incomplete or unclear**
- Free Recall provides personalized feedback but **does not directly update BKT mastery estimates**.

#### 🗣️ Feynman Technique (3-Step AI Evaluation)
- Students explain a concept from their materials in their own words, as if teaching a **10-year-old child**.
- The AI evaluates the explanation through a **three-step pipeline**:
  1. **Jargon Check** — Flags complex terms used without simplification
  2. **Analogy Verification** — Checks for helpful comparisons or analogies
  3. **Finding the Gaps** — Compares explanation against stored definitions, produces accuracy score (0–100) and verdict (Correct / Needs Improvement / Incorrect)
- The Feynman Technique provides personalized feedback but **does not directly update BKT mastery estimates**.

#### 📝 Test Mode (Adaptive)
- Students generate practice tests from their educator-uploaded materials.
- Students can select one or more question types:
  - Multiple Choice, Identification, Matching Type, Fill in the Blank, True or False
- Test difficulty adapts based on the student's BKT mastery scores using tiered thresholds:
  - Mastery ≥ 0.85 → **Advanced** (analytical scenarios, synthesis, edge cases)
  - Mastery 0.50–0.85 → **Intermediate** (comparisons, multi-concept recall, applications)
  - Mastery < 0.50 → **Foundational** (definitions, basic associations)
- BKT is recalculated per-question using **question-type-specific guess probabilities**:
  - Multiple Choice (4 options): P(G) = 0.25
  - True or False: P(G) = 0.50
  - Identification: P(G) = 0.05
  - Fill in the Blank: P(G) = 0.05
  - Matching Type (4 terms, 6 definitions): P(G) = 0.17

#### 📂 Course Resources (with AI Chatbot)
- Students view educator-uploaded learning materials assigned to their grade level.
- An integrated **AI Chatbot** allows students to ask natural language questions about their materials using Retrieval-Augmented Generation (RAG).
- The chatbot generates responses **exclusively** from educator-uploaded learning resources and cannot access external knowledge sources.

---

### 🎮 3. The PlayMe Game Module

An independent gamification framework designed to reinforce study habits through engaging, AI-generated games. Game content is produced from the educator-uploaded materials and adapts difficulty based on BKT mastery (M_doc).

**Games Available:**

| Game | Description |
| :--- | :--- |
| **Crossword** | AI generates a crossword puzzle from key terms and vocabulary in the educator-uploaded materials |
| **Term Matching** | AI generates term-definition pairs for a card matching game |
| **Timed Trivia** | AI generates timed trivia questions from the learning resources |

**BKT-Adaptive Difficulty:**
- Game difficulty is calibrated using the student's **document mastery score (M_doc)**, the arithmetic mean of all per-concept BKT probabilities for a given document.
- Games **do NOT modify BKT mastery estimates** — they use existing estimates only for difficulty personalization.

**Streaks:**
- The app tracks **day streaks** and **total hours studied** across all activities.
- Example: Using flashcards or the crossword game for **5 consecutive days** results in a **5-day streak**.

**Badges:**
- Milestone-based digital badges are awarded for sustained engagement and achievement.
- Example: Achieving a **5-day streak** on flashcards earns a **Flashcard Streak badge**.

---

### 👨‍🏫 4. Educator Portal

A secure portal for authenticated educators to manage learning content and monitor student progress.

| Feature | Description |
| :--- | :--- |
| **Material Upload** | Upload PDF learning materials (plain-text up to 20 MB, scanned up to 20 pages) |
| **Grade-Level Access** | Assign which JHS grade level(s) can access each uploaded material |
| **Mastery Analytics** | View real-time student mastery progress at the individual, concept, and document level |
| **Data Isolation** | RLS restricts educators to mastery data for students within their assigned grade level |

---

### 🔐 5. Admin Module

A lightweight account management interface for system administrators.

| Feature | Description |
| :--- | :--- |
| **Account Management** | Create, edit, and disable accounts for educators and students |
| **Role Assignment** | Assign appropriate roles (educator or student) to platform users |

> The admin role does not interact with learning content, study activities, analytics, or AI features.

---

## 🎨 Design System & Security Directives

All engineering contributions to the frontend UI or database layers must comply with these operational rules:

* **Aesthetic Profile:** *"Neuro-Academic"* – clean, highly readable, minimized data clutter to avoid cognitive overload, utilizing light slate/off-white canvas backdrops.
* **Color Architecture:** Futuristic Indigo/Cyan for primary system hooks and CTA states; muted Crimson reserved strictly for input constraints, system errors, or validation warnings.
* **Database Guardrails:** No application layer logic may bypass database-level security boundaries. Every structural table containing user profiles or practice analytics must operate under active multi-tenant Row-Level Security (RLS) policies. RLS enforces data isolation between students and restricts educators to the mastery data of students within their selected grade level.

---

## 📈 System Testing & Validation

The system is verified through a multi-layered validation strategy:

1. **BKT Algorithm Implementation Verification:** Deterministic verification comparing system-generated mastery values against hand-computed expected values using predefined test cases. Implementation correctness is quantified using the **Implementation Correctness Rate (ICR)**: `ICR = (Passed Test Cases / Total Test Cases) × 100`. A test case passes if the absolute difference between system-generated and manually computed values falls within ±0.01.
2. **Generative AI Functional Verification:** Outputs from all AI-powered features are verified against four criteria: Contextual Relevance, Factual Correctness, Difficulty Alignment (based on BKT mastery tier), and Content Consistency.
3. **Black-Box Functional Testing:** Test cases verify expected behavior across both the Educator and Student portals, including material upload, grade-level access, adaptive testing, BKT tracking, game generation, and AI feedback.
4. **ISO/IEC 25010 Quality Evaluation:** A structured survey is administered to **50 Junior High School students (Grades 7–10)** and their assigned educators at Pasig Christian Academy during a **2-to-4-week implementation period**, evaluating: Functional Suitability, Performance Efficiency, Compatibility, Usability, Reliability, Security, Maintainability, and Portability.
