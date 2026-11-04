---
"@stagefright5/pi-plan-mode": patch
---

Side-agent forks keep Plan Mode's restrictions and plan history but write their first revision to a new plan repository, seeded with the inherited plan, so they never overwrite the parent's plan files. Forking never approves a plan.
