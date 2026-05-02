EduSpace: Collaborative Social Learning Platform (Frontend Prototype)

📖 Project Overview

EduSpace is a next-generation Learning Management System (LMS) that bridges the gap between formal academic instruction and personalized, independent studying. Moving beyond traditional siloed platforms, EduSpace utilizes a Hybrid Multi-Tenant Architecture, transforming course completion into verifiable social achievements and empowering students with AI-driven study tools.

⚠️ CURRENT DEVELOPMENT PHASE: FRONTEND PROTOTYPING ⚠️
This repository represents the frontend UI prototype exported to the Antigravity environment. There is currently no active backend or database integration. The primary focus is on establishing the design system, component architecture, responsive layouts, and interactive user flows using mock data and local state management.

🎯 Core Purpose & Philosophy

The intent behind EduSpace is to shift learning from an isolated task to a community-driven, gamified experience.

For Educators: Provide a secure, verifiable UI environment for distributing materials and conducting high-integrity exams.

For Students: Provide an interconnected dashboard where they can simulate generating study aids from professor's materials, visualize complex data placeholders for 3D AR, and build a public portfolio of their academic achievements.

🏗️ Architectural Context (Conceptual for UI)

While there is no backend, the UI components must be built to reflect the following relational concepts using mock data:

Hybrid Multi-Tenant System: Users generally belong to an Institution (University). However, Educators also have the option to act independently and create courses not tied to any university. Course cards and profile UIs must display institution tags/logos or an "Independent" badge.

Course Visibility States: The UI must visually distinguish between three types of courses using distinct badges and access flows:

Independent Courses: Not tied to a university. These are accessible globally to any student on the platform.

University - Public: Tied to a specific university. These are accessible/visible to all students registered under that university, whether they are formally enrolled in the class or just browsing.

University - Private: Tied to a specific university, but strictly restricted. Only accessible to specific sections or explicitly invited students managed by the educator.

Social Gamification: Profile views must include an Achievement section displaying Badges for completed simulated courses, complete with the authorizing university's tag (or an independent creator tag).

Dual-Interface App: The prototype has distinct simulated routing/layouts for Educators (Course creation modals, Exam deployment views, section management) vs. Students (Course enrollment, Study Spaces, Social Profiles).

✨ Revolutionary Features (To Be Prototyped)

AI Study Spaces (RAG): UI layouts showing split-screens with source documents on one side and simulated AI-generated flashcards on the other.

Web-AR Holographic Overlays: Interactive UI states (like a "Project to AR" button triggering a QR code handoff modal) to simulate the AR experience.

Lockdown Exam Mode: A full-screen, distraction-free assessment UI that visually demonstrates warning states for simulated tab-switching.

The Knowledge Profile: A public-facing student profile layout showcasing followers, published flashcard decks, and verifiable university badges.

🎨 Design System & UI Rules

AI Agents generating or modifying frontend code must adhere strictly to this design system:

Aesthetic: "Neuro-Academic" – modern, clean, and slightly futuristic.

Framework: Tailwind CSS.

Styling Directives:

Utilize soft glassmorphism (backdrop-blur, translucent backgrounds) for floating panels, modals, and AR UI elements.

Generous use of whitespace and rounded corners (rounded-xl or rounded-2xl for cards).

Color Palette: Off-white/slate backgrounds to reduce cognitive load; futuristic Cyan/Indigo for primary actions; muted Crimson for Lockdown/Warning states.

Icons: Phosphor Icons or Lucide Icons (clean, line-based styling).

Tags & Badges: Must be visually distinct (e.g., pill-shaped badges). Use specific color coding to differentiate between "Independent", "Uni-Public", and "Uni-Private" courses.

🤖 Instructions for Autonomous Agents (Frontend Focus)

If you are an AI agent analyzing this repository in Antigravity to build or modify features, adhere to the following rules:

NO BACKEND LOGIC: Do not write API calls (fetch, axios) to external databases or attempt to set up Express/Node backends. Use React local state (useState, useContext) to manage UI interactions.

Robust Mock Data: Always supply comprehensive mock data arrays/objects at the top of your components or in a dedicated mockData.js file. Mix the different course visibility types (Independent, Uni-Public, Uni-Private) to ensure the UI handles diverse access states correctly.

Maintain Component Reusability: Cards used for "Courses" should share base Tailwind styles with cards used for "Study Spaces" or "Achievements," varying only by the props passed into them (like visibility badges).

Modal-First Interactions: Operations like "Join Course," "Create Space," and "Deploy Exam" should trigger floating glassmorphic modals (using simulated state toggles) rather than entirely new page loads to maintain the SPA application flow.