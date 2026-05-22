# WRITE_COVER_LETTER

Reusable prompt for generating a tailored cover letter for Jarrett Goodwin.

The letter is assembled from a fixed opening template, one or two experience
blocks selected from `story_bank.json` by matching the posting, an optional
Current Automations or communication block, and a fixed closing template. Target
length is around 400 words.

---

Write a sincere, specific cover letter. Output ONLY the letter body (no date, no
address block, no commentary). Around 400 words, about 4 to 5 paragraphs.
Detailed and concrete, never generic.

## JOB
- Company: `{{company}}`
- Title: `{{job_title}}`
- Location: `{{location}}`

Job description:
```
{{job_description}}
```

## STORY BANK (select blocks from here; never invent experience)
```
{{story_bank}}
```

## STRUCTURE (around 400 words total)

1. **Opening (about 60 to 90 words)**, based on this template with the brackets filled:
   > I am writing to apply for the [job_title] position at [company_name]. As a recent graduate with a double degree in Chemical Engineering and Computer Technology from the University of Ottawa, with co-op experience across pulp and paper, food manufacturing, and construction, I am drawn to this opportunity because [one specific phrase from the posting]. I bring both hands-on process experience and strong data and systems thinking, and I am looking to grow under experienced engineers on a team that does real operational work.

2. **Body (2 to 3 paragraphs).** Select the 1 to 2 most relevant experience blocks from the story bank using the selection logic below, and tell them in real detail (the situation, what he did, the result), tying each to specific requirements or responsibilities named in the posting. Add the Current Automations or communication block only if the posting calls for it. Do not cram in unrelated blocks.

3. **Close (about 50 to 70 words)**, based on this template:
   > I am looking to do the work that matters on the plant floor and in the field, and I know I am early in my career. I am motivated to learn from experienced engineers and operators and to contribute wherever I can. Thank you for considering my application. I would welcome the opportunity to discuss how my co-op experience, data and systems background, and hands-on work with Current Automations can be useful to [company_name].

## BLOCK SELECTION LOGIC (posting keywords to story-bank block id)
- plant / process / quality / paper / chemistry / trials: `ryam-pulp-paper`
- automation / change management / AGV / implementation / rollout: `fritolay-agv-automation`
- utilities / energy / resource / conservation / sustainability / data monitoring: `fritolay-resource-conservation`
- construction / field / project / drawings / coordination: `ellisdon-construction`
- data / digital / systems / automation / continuous improvement: `current-automations`
- stakeholder / communication / client / cross-functional / leadership: `communication-ownership`

Pick the 1 to 2 best matches. If several apply, choose the blocks closest to the role's core responsibilities.

## POST-GENERATION CHECKLIST (verify before returning)
1. No em dashes or en dashes anywhere. Use periods, commas, colons, or hyphens.
2. The exact job title appears verbatim in the opening paragraph.
3. At least 3 to 5 phrases from the posting are mirrored in the body.
4. Total length is around 400 words.
5. Every claim is truthful; nothing is invented.
6. Plain prose. No bullet points. No "To Whom It May Concern".
