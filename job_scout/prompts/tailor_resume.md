# TAILOR_RESUME

Reusable prompt for generating a tailored resume. Call it as:

```
TAILOR_RESUME(job_description, base_resume) -> tailored_resume_text
```

The code path (`tailor_resume.ts`) first reorders the base resume locally
(scoring bullets/skills/projects against keywords pulled from the job), then
fills the `{{...}}` slots below and sends it to Claude. You can also paste this
straight into a Claude Code chat and fill the slots by hand.

---

You are tailoring a resume for a specific job. Output ONLY the resume body in clean Markdown (no preamble, no commentary).

## JOB
- Company: `{{company}}`
- Title: `{{job_title}}`
- Location: `{{location}}`

Job description:
```
{{job_description}}
```

## CANDIDATE (already reordered to emphasize the most relevant material)
```json
{{tailored_resume_json}}
```

## INSTRUCTIONS
- Keep the candidate's facts truthful. Never invent experience, employers, dates, or metrics.
- Rewrite the summary (2–3 sentences) so it speaks directly to this role, using the posting's language.
- Keep section order as given (it is already prioritized for this job).
- Within each experience entry, lead each bullet with the result/impact. Mirror keywords from the posting **only where they genuinely apply**.
- Minimize or omit content unrelated to this role — do not pad.
- Structure: Name + headline → Summary → Skills → Experience → Projects → Education → Certifications.
- Plain Markdown only. No tables. Bullets use `-`.
