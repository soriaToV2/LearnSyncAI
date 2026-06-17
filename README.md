# LearnSync AI: An AI-Driven Adaptive Learning Platform with Gamified Engagement and Secure Peer Workspace Synchronization

## 🏗️ Project Overview

**LearnSync AI** is a cloud-native, multi-tenant Software-as-a-Service (SaaS) platform engineered to bridge the gap between standardized academic assessment and personalized independent study. Unlike traditional one-size-fits-all Learning Management Systems (LMS), LearnSync AI utilizes a highly decoupled architecture. It isolates high-stakes, fixed-difficulty instructor examinations from an autonomous, AI-driven student practice environment that actively updates student knowledge profiles using advanced cognitive modeling.

> ### 🚀 Production Reality
>
> This repository contains the complete codebase for the production-ready implementation of LearnSync AI. It moves past static UI prototyping into an active, multi-layered full-stack architecture running a **React** client, **Node.js/Express** API gateways, a **Python ML** container, and **Supabase (PostgreSQL)** database tiers.

---

## 🎯 Core Purpose & Philosophy

The core engineering problem solved by LearnSync AI is the preservation of academic integrity alongside highly tailored personal instruction:

* **For Educators:** Provides an automated, high-integrity framework to upload curriculum materials and generate cheat-resistant assessments without adding to manual grading workloads.
* **For Students:** Establishes a secure, safe-to-fail personal study space where formative review tools adapt dynamically to individual knowledge gaps and concept threshold levels.
* **For Collaboration:** Rejects invasive AI surveillance trackers in favor of secure, user-initiated workspace synchronization bound by database-level security policies.

---

## 🛠️ Technical Configuration (The 3-Tier Architecture)

The production infrastructure separates system responsibilities across fully decoupled layers to guarantee high availability, fault tolerance, and absolute maintainability:

| Layer | Component | Technologies Used | Operational Focus |
| :--- | :--- | :--- | :--- |
| **Presentation** | Frontend Client | React, Tailwind CSS, WebSockets | Local state handling, real-time UI rendering, hardware-accelerated 3D game transitions. |
| **Application** | API Gateway | Node.js / Express / Laravel | Lightweight multi-tenant routing, input sanitization, JWT extraction, and Role-Based Access Control (RBAC). |
| **Application** | ML Microservices | Python API Container | Cognitive telemetry tracking, NLP document parsing, and BKT knowledge vector calculation. |
| **Data Tier** | Unified Backend | Supabase (PostgreSQL Engine) | Relational storage, schema partitioning, `pgvector` semantic storage, Blob object storage, and PostgreSQL Write-Ahead Log (WAL) caching. |

---

## ✨ System Features & Core Modules

### 🧠 1. The Adaptive Learning Engine (Student Tracking)

Operating strictly inside the private Student Study Space, this module leverages **Bayesian Knowledge Tracing (BKT)** to map real-time performance metrics (item correctness and time-on-task latencies) into updated student mastery vectors. It features four self-paced learning modes:

* **Mode A (Flashcard Synthesis):** Generative scripts scan curriculum materials to auto-construct active recall flashcard decks.
* **Mode B (Free Recall AI Evaluator):** Vectorizes unstructured user summaries and compares them against reference material using `pgvector` cosine similarity thresholds to output concept coverage analysis.
* **Mode C (Feynman Technique Core):** Archive utility for simplified student explanations, supporting deep cognitive organization and peer-validation loops.
* **Mode D (BKT Adaptive Testing):** An active learning practice loop that handles algorithmic routing to keep question difficulty dynamically balanced within the user's learning threshold.

### 📝 2. Isomorphic Exam Factory (Instructor Tracking)

To combat academic cheating during high-stakes testing, the NLP parsing engine evaluates faculty-uploaded documents to build structural concept hierarchy maps. It generates parallel, functionally identical **isomorphic exam variants**—maintaining a fixed cognitive difficulty score across all instances while randomizing scenarios, names, variables, and values. To ensure system grading integrity, all completed high-stakes exam logs are saved as uneditable, immutable database rows.

### 🎮 3. The PlayMe Game Module

An independent, procedural gamification framework engineered to sustain study habits without altering core BKT cognitive metrics.

* **Procedural Board Generation:** Dynamically extracts the vocabulary glossary from the active study resource, calculates word lengths, and runs a backtracking layout algorithm to procedurally compile custom **Crossword** grids or **Matching Card** pairs tailored to that exact lesson material.
* **Deterministic Metrics:** Solves user completions to calculate Experience Points (XP) scaling, verifies milestone profile badges, and tracks consecutive login windows via a strict 48-hour study streak monitor.

### 🔒 4. The CollabShare Sync Engine

A secure peer-to-peer workspace replication framework that protects student data privacy and completely prevents bad-faith data alteration or plagiarism.

* When a student publishes a study space, the engine generates a cryptographic sync key and enforces strict **PostgreSQL Row-Level Security (RLS)** policies on the Supabase backend.
* Enrolled peers are granted strict, system-enforced **Read-Only** access layers to view shared flashcards, recall strings, and tests.
* Peers can safely clone shared database rows directly into their independent profiles under their unique User ID, allowing customization of asset copies while keeping the original author's workspace untouched.

---

## 🎨 Design System & Security Directives

All engineering contributions to the frontend UI or database layers must comply with these operational rules:

* **Aesthetic Profile:** *"Neuro-Academic"* – clean, highly readable, minimized data clutter to avoid cognitive overload, utilizing light slate/off-white canvas backdrops.
* **Color Architecture:** Futuristic Indigo/Cyan for primary system hooks and CTA states; muted Crimson reserved strictly for input constraints, system errors, or validation warnings.
* **Database Guardrails:** No application layer logic may bypass database-level security boundaries. Every structural table containing user profiles, class feeds, or practice analytics must operate under active multi-tenant Row-Level Security (RLS) policies.

---

## 📈 System Testing & Validation Lifecycles

The production code and underlying machine learning models are verified using a rigorous technical lifecycle prior to deployment stages:

1. **Model Accuracy Evaluations:** Microservice classification algorithms are tracked using a standard **Confusion Matrix (calculating Precision, Recall, and F1-Score)** to check mastery placement, alongside **Mean Absolute Error (MAE)** to eliminate BKT cognitive drift.
2. **Infrastructure Boundary Checks:** Black-box testing loops independently verify input-output API gateways, `pgvector` response latency limits, and that student access tokens are mathematically locked out of administrative boundaries.
3. **ISO/IEC 25010 Quality Auditing:** Production readiness is measured through empirical surveys deployed during a 2-to-4-week institutional pilot run with **100 undergraduate IT/CS students** and **3 to 5 faculty instructors** at PLP, scoring the software across Functional Suitability, Usability, Performance Efficiency, and Security.
