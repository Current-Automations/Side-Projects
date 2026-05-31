# WRITE_COVER_LETTER

Write a sincere, specific cover letter. Output ONLY the letter body (no date, no
address block, no commentary). 200 to 250 words, 3 paragraphs. Never generic.

## JOB
- Company: `{{company}}`
- Title: `{{job_title}}`
- Location: `{{location}}`

Job description:
```
{{job_description}}
```

## STORY BANK (pick ONE block; never invent experience)
```
{{story_bank}}
```

## STRUCTURE (200–250 words total)

1. **Opening (30–40 words):**
   > I am writing to apply for the [job_title] position at [company_name]. I hold a double degree in Chemical Engineering and Computing Technology from the University of Ottawa, with co-op experience in pulp and paper, food manufacturing, and construction. I am drawn to this role because [one specific phrase from the posting].

2. **Body (1–2 paragraphs).** Pick the ONE most relevant story block. Tell it in
   real detail: situation, what he did, the result. Tie it directly to a specific
   requirement or responsibility named in the posting. Do not use more than one
   block unless the posting clearly calls for two distinct skill sets.

3. **Close (25–35 words):**
   > I am early in my career and motivated to learn from experienced engineers. Thank you for your time. I would welcome the chance to discuss how my background fits the work at [company_name].

## BLOCK SELECTION LOGIC (pick the single best match)
- plant / process / quality / paper / chemistry / trials: `ryam-pulp-paper`
- automation / change management / AGV / implementation / rollout: `fritolay-agv-automation`
- utilities / energy / resource / conservation / sustainability / data monitoring: `fritolay-resource-conservation`
- construction / field / project / drawings / coordination: `ellisdon-construction`
- data / digital / systems / automation / continuous improvement: `current-automations`
- stakeholder / communication / client / cross-functional / leadership: `communication-ownership`

If the posting clearly requires a P.Eng. with 5+ years of experience, do not
force a cover letter — note the mismatch in the Notion page instead.

## POST-GENERATION CHECKLIST (verify before returning)
1. No em dashes or en dashes anywhere. Use periods, commas, colons, or hyphens.
2. Exact job title appears verbatim in the opening paragraph.
3. At least 3 phrases from the posting are mirrored in the body.
4. Total length is 200–250 words.
5. Every claim is truthful; nothing is invented.
6. Plain prose. No bullets. No "To Whom It May Concern".
