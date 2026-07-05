# Graph Report - .  (2026-07-05)

## Corpus Check
- 171 files · ~110,663 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 493 nodes · 733 edges · 33 communities (25 shown, 8 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 78 edges (avg confidence: 0.88)
- Token cost: 703,162 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Skill-Writing Vocabulary|Skill-Writing Vocabulary]]
- [[_COMMUNITY_Studio Wizard UI|Studio Wizard UI]]
- [[_COMMUNITY_Codebase Design Method|Codebase Design Method]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Issues & PRD Workflow|Issues & PRD Workflow]]
- [[_COMMUNITY_Triage & TDD Conventions|Triage & TDD Conventions]]
- [[_COMMUNITY_Code Review & Domain Docs|Code Review & Domain Docs]]
- [[_COMMUNITY_Code Review & Domain Docs|Code Review & Domain Docs]]
- [[_COMMUNITY_Codebase Design Method|Codebase Design Method]]
- [[_COMMUNITY_Design-It-Twice Guides|Design-It-Twice Guides]]
- [[_COMMUNITY_Design System & Sora Infra|Design System & Sora Infra]]
- [[_COMMUNITY_Aspire AppHost Config|Aspire AppHost Config]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Grilling & Architecture Review|Grilling & Architecture Review]]
- [[_COMMUNITY_Prototype Skill|Prototype Skill]]
- [[_COMMUNITY_Landing Page Hero|Landing Page Hero]]
- [[_COMMUNITY_Import Clip API|Import Clip API]]
- [[_COMMUNITY_Azure RG Guard Script|Azure RG Guard Script]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_HITL Loop Template|HITL Loop Template]]
- [[_COMMUNITY_HITL Loop Template|HITL Loop Template]]
- [[_COMMUNITY_HITL Loop Template|HITL Loop Template]]
- [[_COMMUNITY_Research Skill|Research Skill]]
- [[_COMMUNITY_Handoff Skill|Handoff Skill]]
- [[_COMMUNITY_Primary-Source Research|Primary-Source Research]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Grandma Generation Script|Grandma Generation Script]]
- [[_COMMUNITY_Route Handlers|Route Handlers]]

## God Nodes (most connected - your core abstractions)
1. `Ask Matt (skill router)` - 20 edges
2. `compilerOptions` - 16 edges
3. `Codebase Design (deep-module vocabulary skill)` - 15 edges
4. `Writing Great Skills Glossary` - 15 edges
5. `Improve Codebase Architecture (skill)` - 13 edges
6. `Codebase Design Skill` - 12 edges
7. `Setup Matt Pocock Skills` - 12 edges
8. `Ask Matt Router Skill` - 11 edges
9. `Improve Codebase Architecture Skill` - 11 edges
10. `Triage Skill` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Test Seam` --semantically_similar_to--> `Seam (Feathers)`  [INFERRED] [semantically similar]
  .agents/skills/tdd/SKILL.md → .claude/skills/codebase-design/SKILL.md
- `Seam (Test Boundary)` --semantically_similar_to--> `Codebase Design Glossary Vocabulary`  [INFERRED] [semantically similar]
  .claude/skills/tdd/SKILL.md → .pi/skills/improve-codebase-architecture/HTML-REPORT.md
- `Teach GLOSSARY.md Format` --semantically_similar_to--> `CONTEXT.md Glossary`  [INFERRED] [semantically similar]
  .claude/skills/teach/GLOSSARY-FORMAT.md → .pi/skills/domain-modeling/CONTEXT-FORMAT.md
- `Learning Record` --semantically_similar_to--> `Architecture Decision Record (ADR)`  [INFERRED] [semantically similar]
  .claude/skills/teach/LEARNING-RECORD-FORMAT.md → .pi/skills/domain-modeling/ADR-FORMAT.md
- `Regression Test at a Correct Seam` --conceptually_related_to--> `Seam`  [INFERRED]
  .agents/skills/diagnosing-bugs/SKILL.md → .pi/skills/codebase-design/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Main Flow: idea → grill → PRD → issues → implement (TDD) → code review** — _agents_skills_grill_with_docs_skill_grill_with_docs, _agents_skills_to_prd_skill_to_prd, _agents_skills_to_issues_skill_to_issues, _agents_skills_implement_skill_implement, _agents_skills_tdd_skill_tdd, _agents_skills_code_review_skill_code_review [EXTRACTED 1.00]
- **Deep-module design vocabulary (module, interface, implementation, depth, seam, adapter, leverage, locality)** — _agents_skills_codebase_design_skill_module, _agents_skills_codebase_design_skill_interface, _agents_skills_codebase_design_skill_implementation, _agents_skills_codebase_design_skill_depth, _agents_skills_codebase_design_skill_seam, _agents_skills_codebase_design_skill_adapter, _agents_skills_codebase_design_skill_leverage, _agents_skills_codebase_design_skill_locality [EXTRACTED 1.00]
- **Per-repo engineering skills configuration (issue tracker, triage labels, domain docs)** — _agents_skills_setup_matt_pocock_skills_skill_setup_matt_pocock_skills, _agents_skills_setup_matt_pocock_skills_issue_tracker_github_issue_tracker_github, _agents_skills_setup_matt_pocock_skills_domain_domain_docs, _agents_skills_setup_matt_pocock_skills_skill_triage_label_vocabulary [EXTRACTED 1.00]
- **Shared Triage Label Vocabulary** — _agents_skills_setup_matt_pocock_skills_triage_labels_canonical_triage_roles, _agents_skills_triage_skill, _agents_skills_to_prd_skill, _agents_skills_to_issues_skill, _agents_skills_setup_matt_pocock_skills_issue_tracker_local [EXTRACTED 1.00]
- **Main Flow: Idea to Ship** — _claude_skills_ask_matt_skill_main_flow, _agents_skills_to_prd_skill, _agents_skills_to_issues_skill, _agents_skills_tdd_skill, _claude_skills_code_review_skill [EXTRACTED 1.00]
- **Opinionated Glossary with Avoid-Aliases Pattern** — _agents_skills_teach_glossary_format_opinionated_glossary, _agents_skills_writing_great_skills_glossary, _claude_skills_codebase_design_skill [INFERRED 0.85]
- **Interchangeable Issue Tracker Backends** — _claude_skills_setup_matt_pocock_skills_skill, _claude_skills_setup_matt_pocock_skills_issue_tracker_github, _claude_skills_setup_matt_pocock_skills_issue_tracker_gitlab, _claude_skills_setup_matt_pocock_skills_issue_tracker_local [EXTRACTED 1.00]
- **Domain Model Documentation System** — _claude_skills_domain_modeling_skill, _claude_skills_domain_modeling_adr_format, _claude_skills_domain_modeling_context_format, _claude_skills_setup_matt_pocock_skills_domain [EXTRACTED 1.00]
- **Skills That Read CONTEXT.md Before Exploring** — _claude_skills_diagnosing_bugs_skill, _claude_skills_tdd_skill, _claude_skills_improve_codebase_architecture_skill, _claude_skills_domain_modeling_context_format_context_md_glossary [EXTRACTED 1.00]
- **Teaching Workspace State Files** — _claude_skills_teach_skill, _claude_skills_teach_mission_format, _claude_skills_teach_resources_format, _claude_skills_teach_learning_record_format, _claude_skills_teach_glossary_format [EXTRACTED 1.00]
- **Opinionated Glossary with Avoid-Aliases Pattern** — _claude_skills_teach_glossary_format, _pi_skills_domain_modeling_context_format, _claude_skills_writing_great_skills_glossary [INFERRED 0.85]
- **Durable Specs Exclude File Paths and Line Numbers** — _claude_skills_triage_agent_brief_agent_brief, _claude_skills_to_prd_skill, _claude_skills_to_issues_skill [INFERRED 0.85]
- **Pluggable Issue Tracker Backends** — _pi_skills_setup_matt_pocock_skills_issue_tracker_github_github_issue_tracker, _pi_skills_setup_matt_pocock_skills_issue_tracker_gitlab_gitlab_issue_tracker, _pi_skills_setup_matt_pocock_skills_issue_tracker_local_local_markdown_issue_tracker, _pi_skills_setup_matt_pocock_skills_skill_setup_matt_pocock_skills [EXTRACTED 1.00]
- **Grilling Session Pattern** — _pi_skills_grilling_skill_grilling, _pi_skills_grill_me_skill_grill_me, _pi_skills_grill_with_docs_skill_grill_with_docs, _pi_skills_improve_codebase_architecture_skill_improve_codebase_architecture [EXTRACTED 1.00]
- **Teaching Workspace Document System** — _pi_skills_teach_mission_format_mission_md, _pi_skills_teach_glossary_format_glossary_md, _pi_skills_teach_learning_record_format_learning_record, _pi_skills_teach_learning_record_format_zone_of_proximal_development [EXTRACTED 1.00]
- **Issue Triage State Machine Flow** — _pi_skills_triage_skill_triage, _pi_skills_triage_agent_brief_agent_brief, _pi_skills_triage_out_of_scope_out_of_scope_knowledge_base, docs_agents_triage_labels_triage_label_mapping, docs_agents_issue_tracker_github_issue_tracker [EXTRACTED 1.00]
- **DancingGrandma Brand and Design System** — product_product_strategy, design_visual_system, readme_dancinggrandma [EXTRACTED 1.00]
- **Plan-to-Tracker Workflow** — _pi_skills_to_prd_skill_to_prd, _pi_skills_to_issues_skill_to_issues, _pi_skills_wayfinder_skill_wayfinder, docs_agents_issue_tracker_github_issue_tracker [INFERRED 0.85]
- **Landing page conversion flow: headline -> value prop -> CTA -> ticker reinforcement** — docs_hero_screenshot_headline_stacked_tricolor, docs_hero_screenshot_value_prop_copy, docs_hero_screenshot_cta_make_grandma_dance, docs_hero_screenshot_marquee_ticker [INFERRED 0.85]

## Communities (33 total, 8 thin omitted)

### Community 0 - "Skill-Writing Vocabulary"
Cohesion: 0.06
Nodes (54): Teaching GLOSSARY.md Format, Opinionated Glossary, Learning Record Format, Learning Record, MISSION.md Format, Learning Mission, RESOURCES.md Format, Teach Skill (+46 more)

### Community 1 - "Studio Wizard UI"
Cohesion: 0.07
Nodes (22): FAQS, MARQUEE_WORDS, STEPS, clipFiles, Dance, DANCES, GENERATION_STAGES, referenceClipFile() (+14 more)

### Community 2 - "Codebase Design Method"
Cohesion: 0.09
Nodes (37): Ask Matt (skill router), Code Review (two-axis skill), Refactoring, ch.3 (Fowler), Fowler Smell Baseline, Spec Axis, Standards Axis, Diagnosing Bugs (skill), Tight Feedback Loop (+29 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.06
Nodes (32): dependencies, @fal-ai/client, @fal-ai/server-proxy, next, react, react-dom, devDependencies, eslint (+24 more)

### Community 4 - "Issues & PRD Workflow"
Cohesion: 0.11
Nodes (32): To Issues Skill, Tracer Bullet Vertical Slice, Frontier, GitHub Issue Tracker Convention, GitLab Issue Tracker Convention, Local Markdown Issue Tracker Convention, Setup Matt Pocock Skills, Triage Label Vocabulary (+24 more)

### Community 5 - "Triage & TDD Conventions"
Cohesion: 0.09
Nodes (31): Issue Tracker: GitLab, Wayfinding Operations (GitLab), Issue Tracker: Local Markdown, Wayfinding Operations (Local Markdown), Triage Labels Mapping, Canonical Triage Roles, When to Mock, SDK-Style Interfaces (+23 more)

### Community 6 - "Code Review & Domain Docs"
Cohesion: 0.09
Nodes (31): Code Review Skill, Tight Feedback Loop, Implement Skill, When to Mock Guide, Mock at System Boundaries Only, SDK-Style Interfaces over Generic Fetchers, TDD Skill, Red-Green Loop (+23 more)

### Community 7 - "Code Review & Domain Docs"
Cohesion: 0.12
Nodes (31): Diagnosing Bugs Skill, Minimised Repro, ADR Format Guide, Architecture Decision Record (ADR), CONTEXT.md Format Guide, CONTEXT-MAP.md Multi-Context Map, CONTEXT.md Domain Glossary, Domain Modeling Skill (+23 more)

### Community 8 - "Codebase Design Method"
Cohesion: 0.11
Nodes (28): Deepening (safely merging shallow modules), Dependency Categories (in-process, local-substitutable, remote-owned, true external), Ports & Adapters, Replace, Don't Layer (testing strategy), Seam Discipline, Design It Twice (parallel sub-agent pattern), A Philosophy of Software Design (Ousterhout), Adapter (role at a seam) (+20 more)

### Community 9 - "Design-It-Twice Guides"
Cohesion: 0.12
Nodes (24): Behavioral (Integration-Style) Testing, Deepening Guide, Dependency Categories for Deepening, Ports & Adapters, Design It Twice Guide, Design It Twice (Ousterhout), Codebase Design Skill, Adapter (+16 more)

### Community 10 - "Design System & Sora Infra"
Cohesion: 0.11
Nodes (24): Kitchen Disco Theme, Motion System, OKLCH Color Tokens, Studio Wizard Pattern, Typography System, DancingGrandma Visual System, NamePrefix + Scope-Hash Naming, Public Repo Secret Hygiene (+16 more)

### Community 11 - "Aspire AppHost Config"
Cohesion: 0.12
Nodes (19): ASPIRE_ALLOW_UNSECURED_TRANSPORT, ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL, ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL, ASPNETCORE_ENVIRONMENT, DOTNET_ENVIRONMENT, applicationUrl, commandName, dotnetRunMessages (+11 more)

### Community 12 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 13 - "Grilling & Architecture Review"
Cohesion: 0.18
Nodes (18): Codebase Design Skill, Domain Modeling Skill, grill-me Skill, grill-with-docs Skill, Grilling Skill, Codebase Design Glossary Vocabulary, Before/After Diagram Patterns, Architecture Review HTML Report Format (+10 more)

### Community 14 - "Prototype Skill"
Cohesion: 0.21
Nodes (12): Logic Prototype Guide, Lightweight TUI Frame Loop, Portable Pure Logic Module, Prototype Skill, Throwaway Prototype, UI Prototype Guide, URL-Param Variant Switcher, Logic Prototype (+4 more)

### Community 15 - "Landing Page Hero"
Cohesion: 0.24
Nodes (11): Primary CTA: Make Grandma Dance, Dark Green / Pink / Yellow Brand Palette, From Fridge Magnet to For-You Page Section Heading, Stacked Tricolor Headline (Your Grandma / Their Dance / One Video), Hero Screenshot (Landing Page), Hero Section, Secondary Link: How Does It Work, Marquee Ticker Strip (Music Included / Make Grandma Dance ...) (+3 more)

### Community 16 - "Import Clip API"
Cohesion: 0.43
Nodes (5): POST(), importClip(), ImportedClip, IMPORTS_DIR, run()

### Community 17 - "Azure RG Guard Script"
Cohesion: 0.53
Nodes (5): deny(), flag_value(), load_pattern(), main(), Return (regex_or_None, error_message_or_None).

### Community 18 - "Root Layout"
Cohesion: 0.40
Nodes (3): lilita, metadata, schibsted

### Community 19 - "HITL Loop Template"
Cohesion: 0.83
Nodes (3): capture(), hitl-loop.template.sh script, step()

### Community 20 - "HITL Loop Template"
Cohesion: 0.83
Nodes (3): capture(), hitl-loop.template.sh script, step()

### Community 21 - "HITL Loop Template"
Cohesion: 0.83
Nodes (3): capture(), hitl-loop.template.sh script, step()

## Ambiguous Edges - Review These
- `Premature Completion` → `Main Flow: Idea to Ship`  [AMBIGUOUS]
  .pi/skills/ask-matt/SKILL.md · relation: conceptually_related_to

## Knowledge Gaps
- **146 isolated node(s):** `$schema`, `commandName`, `dotnetRunMessages`, `launchBrowser`, `applicationUrl` (+141 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Premature Completion` and `Main Flow: Idea to Ship`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Ask Matt (skill router)` connect `Codebase Design Method` to `Codebase Design Method`, `Code Review & Domain Docs`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `Ask Matt Router Skill` connect `Triage & TDD Conventions` to `Skill-Writing Vocabulary`, `Design-It-Twice Guides`, `Code Review & Domain Docs`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `Codebase Design Skill` connect `Design-It-Twice Guides` to `Codebase Design Method`, `Triage & TDD Conventions`, `Code Review & Domain Docs`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `Return (regex_or_None, error_message_or_None).`, `$schema`, `commandName` to the rest of the system?**
  _159 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Skill-Writing Vocabulary` be split into smaller, more focused modules?**
  _Cohesion score 0.061495457721872815 - nodes in this community are weakly interconnected._
- **Should `Studio Wizard UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07422402159244265 - nodes in this community are weakly interconnected._