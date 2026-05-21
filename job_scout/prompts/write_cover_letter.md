# WRITE_COVER_LETTER

Reusable prompt for generating a tailored cover letter. Call it as:

```
WRITE_COVER_LETTER(job_description, tailored_resume_summary, story_bank) -> cover_letter_text
```

`write_cover_letter.ts` picks the single most relevant anecdote from your
`story_bank.json` (by tag overlap with the job) and fills the slots below.

---

Write a concise, sincere cover letter. Output ONLY the letter body (no date, no address block, no commentary). 3–5 short paragraphs, max ~250 words.

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
- **Paragraph 1 — hook:** reference `{{company}}` and the `{{job_title}}` role specifically; show you understand what they need. No generic flattery.
- **Middle — one concrete story:** tell the single anecdote above, tying it to a requirement in the posting.
- Keep every claim truthful; do not invent facts.
- **Close — short and direct:** express interest and a clear, low-pressure next step.
- Plain prose. No bullet points. No "To Whom It May Concern".
