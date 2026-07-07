# LearnSync AI: An AI-Driven Adaptive Learning Platform with Gamified Engagement and Secure Peer Workspace Synchronization

## 🏗️ Project Overview

**LearnSync AI** is a cloud-native student-centric learning platform engineered to provide a deeply personalized, AI-powered study experience. The application leverages advanced cognitive modeling, spaced repetition, and Bayesian Knowledge Tracing (BKT) to adapt dynamically to each student's evolving knowledge state. LearnSync AI operates under a single user role — **Student** — with no instructor or administrative role. Students own and control their entire learning environment.

> ### 🚀 Production Reality
>
> This repository contains the complete codebase for the production-ready implementation of LearnSync AI. It moves past static UI prototyping into an active, multi-layered full-stack architecture running a **React** client, **Node.js/Express** API gateways, a **Python ML** container, and **Supabase (PostgreSQL)** database tiers.

---

## 🎯 Core Purpose & Philosophy

LearnSync AI is built around a single mission: empowering students to study smarter through AI-driven tools that understand and respond to their unique learning needs:

* **For Students:** A personal, safe-to-fail study environment where every tool — flashcards, free recall, feynman technique, adaptive tests, and games — actively adapts to their current knowledge level using real-time BKT mastery tracking.
* **For Collaboration:** A secure, student-initiated workspace sharing system that allows peers to view and benefit from each other's study spaces while preserving the original author's data integrity.

---

## 🛠️ Technical Configuration (The 3-Tier Architecture)

The production infrastructure separates system responsibilities across fully decoupled layers to guarantee high availability, fault tolerance, and absolute maintainability:

| Layer | Component | Technologies Used | Operational Focus |
| :--- | :--- | :--- | :--- |
| **Presentation** | Frontend Client | React, Tailwind CSS, WebSockets | Local state handling, real-time UI rendering, hardware-accelerated 3D game transitions. |
| **Application** | API Gateway | Node.js / Express | Lightweight routing, input sanitization, JWT extraction, and student session management. |
| **Application** | ML Microservices | Python API Container | Cognitive telemetry tracking, NLP document parsing, and BKT knowledge vector calculation. |
| **Data Tier** | Unified Backend | Supabase (PostgreSQL Engine) | Relational storage, schema partitioning, `pgvector` semantic storage, Blob object storage, and PostgreSQL Write-Ahead Log (WAL) caching. |

---

## ✨ System Features & Core Modules

### 📚 1. Study Spaces

The central hub of LearnSync AI. Students create their own **Study Spaces**, each acting as a self-contained learning environment organized around their uploaded materials. Every study space contains **five dedicated tabs**:

| Tab | Purpose |
| :--- | :--- |
| **Flashcards** | AI-generated and manual flashcards with spaced repetition + BKT |
| **Free Recall** | Open-ended memory retrieval evaluated by AI |
| **Feynman Technique** | Concept explanation evaluated by AI for depth of understanding |
| **Test Mode** | Adaptive AI-generated practice tests driven by BKT mastery |
| **Course Resources** | Material uploads + integrated AI chatbot |

---

### 🧠 2. Adaptive Learning Engine (BKT-Powered)

All study tools inside a study space are powered by **Bayesian Knowledge Tracing (BKT)**, which continuously models each student's latent mastery (0.0–1.0) per concept based on their responses. This mastery score directly controls the difficulty and content of flashcards, tests, and gamification challenges.

#### 🃏 Flashcards (Spaced Repetition + BKT)
- Students can manually create flashcards or use **AI Auto-Generation**, which reads the uploaded course materials to generate relevant cards automatically.
- When a student reviews a card, they self-rate their recall:
  - ✅ **Easy** → Card reappears in **4 days**
  - 🟡 **Medium** → Card reappears in **3 days**
  - 🔴 **Hard** → Card reappears in **1 day**
- Each rating event triggers a **BKT recalculation**, updating the student's mastery score for that concept.

#### ✍️ Free Recall
- Students type out everything they remember from their studied materials without any reference.
- The AI evaluates the submission using `pgvector` cosine similarity to compare the student's text against reference concept embeddings.
- AI provides structured feedback identifying:
  - Concepts the student **missed entirely**
  - Areas where their understanding is **incomplete or unclear**

#### 🗣️ Feynman Technique
- Students explain a concept from their materials in their own words, as if teaching a 5-year-old.
- The AI processes the explanation and gives feedback on:
  - Whether the student has **correctly grasped** the core concept
  - Where the explanation is **vague, incorrect, or missing** key details

#### 📝 Test Mode (Adaptive)
- Students generate practice tests from their uploaded materials.
- Students can select one or more question types:
  - Multiple Choice, Identification, Matching Type, Fill in the Blank, True or False
- Test difficulty adapts **every generation** based on the student's BKT mastery scores:
  - High mastery concepts → **harder questions**
  - Low mastery concepts → **easier, foundational questions**
- After each test, BKT mastery is recalculated, making every future test progressively more accurate to the student's current state.

#### 📂 Course Resources (with AI Chatbot)
- Students upload learning materials (PDFs, documents) that serve as the knowledge base for all AI-powered features in the study space.
- An integrated **AI Chatbot** is embedded in this tab, allowing students to ask natural language questions directly about their uploaded materials using Retrieval-Augmented Generation (RAG).

---

### 🎮 3. The PlayMe Game Module

An independent gamification framework designed to reinforce study habits through engaging, AI-generated games. Game content is produced from the student's uploaded materials and adapts difficulty based on BKT mastery.

**Games Available:**

| Game | Description |
| :--- | :--- |
| **Crossword** | AI generates a crossword puzzle from key terms and vocabulary in the student's materials |
| **Term Matching** | AI generates term-definition pairs for a card matching game |
| **Timed Trivia** | AI generates timed trivia questions from the student's learning resources |

**BKT-Adaptive Difficulty:**
- When a student's BKT mastery for a concept is at or below **50%**, game content is calibrated to that foundational knowledge level — reinforcing core understanding before advancing to harder content.

**Streaks:**
- The app tracks **day streaks** and **total hours studied** across all activities.
- Example: Using flashcards or the crossword game for **5 consecutive days** results in a **5-day streak**.

**Badges:**
- Milestone-based badges are awarded for sustained engagement and achievement.
- Example: Achieving a **5-day streak** on flashcards earns a **Flashcard Streak badge**.

---

### 🔒 4. CollabShare — Peer-to-Peer Resource Sharing

A secure peer-to-peer workspace sharing framework that allows students to benefit from each other's study spaces while preserving data integrity.

- When a student **publishes** a study space, PostgreSQL **Row-Level Security (RLS)** policies instantly grant other students **read-only access** to the space, its flashcard decks, and its course resources.
- Peers **cannot modify** the original author's workspace.
- Peers can **clone** shared resources (e.g., flashcard decks) into their own profile, enabling personal customization of the copied content without affecting the original author.

---

## 🎨 Design System & Security Directives

All engineering contributions to the frontend UI or database layers must comply with these operational rules:

* **Aesthetic Profile:** *"Neuro-Academic"* – clean, highly readable, minimized data clutter to avoid cognitive overload, utilizing light slate/off-white canvas backdrops.
* **Color Architecture:** Futuristic Indigo/Cyan for primary system hooks and CTA states; muted Crimson reserved strictly for input constraints, system errors, or validation warnings.
* **Database Guardrails:** No application layer logic may bypass database-level security boundaries. Every structural table containing user profiles or practice analytics must operate under active multi-tenant Row-Level Security (RLS) policies.

---

## 📈 System Testing & Validation Lifecycles

The production code and underlying machine learning models are verified using a rigorous technical lifecycle prior to deployment stages:

1. **Model Accuracy Evaluations:** Microservice classification algorithms are tracked using a standard **Confusion Matrix (calculating Precision, Recall, and F1-Score)** to check mastery placement, alongside **Mean Absolute Error (MAE)** to eliminate BKT cognitive drift.
2. **Infrastructure Boundary Checks:** Black-box testing loops independently verify input-output API gateways, `pgvector` response latency limits, and that student access tokens are properly scoped to their own data.
3. **ISO/IEC 25010 Quality Auditing:** Production readiness is measured through empirical surveys deployed during a 2-to-4-week institutional pilot run with **100 undergraduate IT/CS students** at PLP, scoring the software across Functional Suitability, Usability, Performance Efficiency, and Security.
