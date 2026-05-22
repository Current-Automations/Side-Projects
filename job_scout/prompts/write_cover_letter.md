# WRITE_COVER_LETTER

Reusable prompt for generating a tailored cover letter. Call it as:

```
WRITE_COVER_LETTER(job_description, tailored_resume_summary, story_bank) -> cover_letter_text
```

`write_cover_letter.ts` picks the single most relevant anecdote from your
`story_bank.json` (by tag overlap with the job) and fills the slots below.

---

Write a sincere, specific cover letter. Output ONLY the letter body (no date, no address block, no commentary). Aim for 4 to 5 substantive paragraphs, roughly 350 to 450 words. Be detailed and concrete, not generic.

## JOB
- Company: `{{company}}`
- Title: `{{job_title}}`
- Location: `{{location}}`

Job description:
```
{{job_description}}
```

## CANDIDATE'S TOP RELEVANT ACHIEVEMENTS
```
{{tailored_resume_summary}}
```

## STORY TO WEAVE IN (use this concrete anecdote, lightly edited to fit)
```
{{selected_story}}
```

## INSTRUCTIONS
- **Paragraph 1 (hook):** reference `{{company}}` and the `{{job_title}}` role specifically. Show you understand what the role needs and why Jarrett fits it. No generic flattery.
- **Body (2 to 3 paragraphs):** go beyond a single line. Tell the most relevant story above in real detail (the situation, what he did, and the measurable result), and tie it explicitly to 2 or 3 concrete requirements or responsibilities named in the posting. Bring in a second relevant achievement from the resume summary where it strengthens the case. Use specifics and numbers; avoid vague claims.
- **Fit paragraph:** briefly connect his background (Chemical Engineering plus Computer Technologies, with data and automation skills) to what this team or company does.
- **Close:** express genuine interest and a clear, low-pressure next step.
- Keep every claim truthful; never invent facts, numbers, employers, or dates.
- **Do NOT use em dashes or en dashes anywhere.** Use commas, colons, periods, or hyphens instead.
- Plain prose. No bullet points. No "To Whom It May Concern".
