"""EPUB -> ordered list of {"title": str, "text": str} chapters, plus book metadata.

Strategy (general, tested across Calibre conversions and several publishers):
1. The EPUB's own table of contents decides where chapters start: a spine
   document that a TOC entry points at opens a new chapter with that title.
   Spine documents the TOC doesn't mention are continuations of the current
   chapter (split files, "Key Takeaways" boxes, etc).
2. TOC entries that are really sub-sections ("1.", "2.", "Takeaways") are
   continuations too, not chapters.
3. Front/back matter is dropped by title (cover, copyright, index, ads...).
4. Chapters that end up tiny (a "Part I" divider page) fold into the next one.
5. If the book has no usable TOC, fall back to one chapter per spine document
   titled by its first heading.
"""
import re
import warnings
from pathlib import Path
from urllib.parse import unquote

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from ebooklib import epub, ITEM_DOCUMENT, ITEM_COVER, ITEM_IMAGE

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
warnings.filterwarnings("ignore", category=UserWarning, module="ebooklib")
warnings.filterwarnings("ignore", category=FutureWarning, module="ebooklib")

# Titles that mean "not book content". Matched case-insensitively as a prefix
# of the whole title, so "Acknowledgments" and "Acknowledgements and Thanks"
# both hit. Introductions, prefaces, prologues, epilogues, conclusions,
# postscripts and afterwords are deliberately NOT here: they're content.
SKIP_TITLE_RE = re.compile(
    r"^\s*("
    r"cover|title page|half[ -]?title|copyright|contents|table of contents|dedication|"
    r"acknowledg|about the author|about the publisher|index|notes|endnotes|footnotes|"
    r"bibliography|references|sources|further reading|reading list|reading recommendations|"
    r"also by|praise for|advance praise|digital bonus|corporate workshop|newsletter|"
    r"let'?s connect|connect with|credits|permissions|appendix|glossary|discussion questions|"
    r"reader'?s guide|a note on the (type|text)|colophon|image|figure|map|illustration"
    r")",
    re.IGNORECASE,
)
# Structural wrappers in a TOC that aren't chapters and shouldn't skip anything
# either: just ignore the entry and let the doc be judged on its own.
IGNORE_TITLE_RE = re.compile(r"^\s*(front ?matter|back ?matter|body ?matter|main ?matter|start|begin reading)\s*$", re.IGNORECASE)
# TOC entries that are sections inside a chapter, not chapters. Numeric ("1.",
# "IV"), or recap boxes.
CONTINUATION_TITLE_RE = re.compile(
    r"^\s*(\d+\.?|[ivxlc]+\.?|key takeaways?|takeaways?|summary|chapter summary|exercises?|"
    r"questions?|action steps?|in brief|recap)\s*$",
    re.IGNORECASE,
)
# A bare number label ("Chapter 1", "Part II", "7") that should lead a title,
# not trail it.
NUMBER_LABEL_RE = re.compile(r"^\s*((chapter|part|book|lesson|section|step|day|week|rule|law)\s+[\w-]+|\d+)\.?\s*$", re.IGNORECASE)
# Tiny chapters whose title should NOT be merged into the next chapter's label
# (their text still leads it in).
NO_PREFIX_RE = re.compile(r"^\s*(epigraph|dedication|part\b.*|book\s+\w+.*)$", re.IGNORECASE)
MIN_CHAPTER_WORDS = 250

BLOCK_TAGS = ["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "td", "dd", "dt", "figcaption"]
FOOTNOTE_SELECTORS = [
    "sup", "a.noteref", "a.footnote", "a.fn", "span.footnote", "aside", "[role=doc-noteref]",
    "[role=doc-footnote]", "[role=doc-endnote]", "[epub\\:type~=noteref]", "[epub\\:type~=footnote]",
    "[epub\\:type~=endnote]", "[epub\\:type~=pagebreak]", "span.pagenum", "span.page-number", "a.pageref",
]


def _clean_text(text: str) -> str:
    # Normalize the punctuation espeak/Kokoro handles worse than plain ASCII.
    replacements = {
        "‘": "'", "’": "'", "“": '"', "”": '"',
        "–": "-", "—": ", ", "…": "...", " ": " ", "­": "",
        "•": "",  # bullet marker -> dropped, sentence punctuation carries the pause
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?, ?, ?", ", ", text)
    text = re.sub(r" +,", ",", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _join(prev: str, body: str) -> str:
    """Append a continuation document. Calibre splits files at arbitrary
    points, so if the previous doc stopped mid-sentence this is a space, not
    a paragraph break (which would become a 700ms pause mid-sentence)."""
    if not prev:
        return body
    if not body:
        return prev
    if prev.rstrip()[-1] in ".!?\"'”’)]:":
        return prev + "\n\n" + body
    return prev.rstrip() + " " + body.lstrip()


def _clean_title(title: str) -> str:
    title = _clean_text(title)
    title = re.sub(r"\s*:\s*", ": ", title)
    title = title.rstrip(":. ").strip()
    if title.isupper():
        title = re.sub(r"[A-Za-z]+(?:'[A-Za-z]+)?", lambda m: m.group(0).capitalize(), title)
    return title


def _norm_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _strip_noise(soup, book_title_norm: str):
    for sel in FOOTNOTE_SELECTORS:
        try:
            for tag in soup.select(sel):
                tag.decompose()
        except Exception:
            pass
    # Running header: a heading that just repeats the book title on every page.
    for h in soup.find_all(["h1", "h2", "h3"]):
        if _norm_title(h.get_text(" ", strip=True)) == book_title_norm:
            h.decompose()


def _leaf_blocks(soup):
    """Block-level text nodes, innermost only, so a blockquote wrapping <p>s
    doesn't get its text read twice."""
    out = []
    for b in soup.find_all(BLOCK_TAGS):
        if b.find(BLOCK_TAGS) is not None:
            continue
        t = b.get_text(" ", strip=True)
        if t:
            out.append((b.name, t))
    return out


def _doc_text(soup) -> tuple[str, list[str]]:
    """Returns (paragraph-joined body text, leading heading texts)."""
    blocks = _leaf_blocks(soup)
    if len(blocks) < 3:
        # <div>-only or bare-text documents: fall back to newline structure.
        raw = soup.get_text("\n", strip=True)
        paras = [p for p in re.split(r"\n\s*\n|\n", raw) if p.strip()]
        return "\n\n".join(paras), []
    heads = []
    for name, t in blocks:
        if name.startswith("h"):
            heads.append(t)
        else:
            break
    # Body excludes the leading headings: the chapter label is spoken as an
    # announcement, so leaving them in reads the title twice.
    return "\n\n".join(t for _, t in blocks[len(heads):]), heads


def _flatten_toc(toc, depth=0) -> list[tuple[str, str, int]]:
    """ebooklib's toc mixes Link objects and (Section, children) pairs, nested,
    and children may be a bare Link instead of a list. Yields
    (title, href-without-fragment, depth) in reading order."""
    out = []
    if hasattr(toc, "href") or hasattr(toc, "title"):
        toc = [toc]
    for item in toc:
        if isinstance(item, (tuple, list)) and len(item) == 2 and not hasattr(item, "href"):
            sec, kids = item
            href = getattr(sec, "href", None)
            if href:
                out.append((getattr(sec, "title", "") or "", href.split("#")[0], depth))
            out.extend(_flatten_toc(kids, depth + 1))
        elif hasattr(item, "href"):
            if item.href:
                out.append((getattr(item, "title", "") or "", item.href.split("#")[0], depth))
        elif isinstance(item, (tuple, list)):
            out.extend(_flatten_toc(item, depth))
    return out


def read_metadata(epub_path: Path) -> dict:
    book = epub.read_epub(str(epub_path), options={"ignore_ncx": False})
    titles = [t for t, _ in book.get_metadata("DC", "title")]
    creators = [c for c, _ in book.get_metadata("DC", "creator")]
    title = _clean_text(titles[0]) if titles else epub_path.stem
    author = _clean_text(creators[0]) if creators else ""
    # "Gladwell, Malcolm" -> "Malcolm Gladwell"
    if author.count(",") == 1 and " " not in author.split(",")[0].strip():
        last, first = [s.strip() for s in author.split(",")]
        author = f"{first} {last}"
    images = list(book.get_items_of_type(ITEM_COVER)) + list(book.get_items_of_type(ITEM_IMAGE))
    images = [i for i in images if i.get_name().lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png")]
    cover = None
    for item in images:
        if item.get_type() == ITEM_COVER or "cover" in item.get_name().lower():
            cover = item
            break
    if cover is None and images:
        # No declared cover: the first spine document's image, else the
        # largest image in the book (covers are almost always the biggest).
        id_to_item = {i.get_id(): i for i in book.get_items()}
        for idref, _ in book.spine[:2]:
            doc = id_to_item.get(idref)
            if doc is None or doc.get_type() != ITEM_DOCUMENT:
                continue
            soup = BeautifulSoup(doc.get_content(), "lxml")
            srcs = [unquote(t.get("src") or t.get("xlink:href") or "") for t in soup.find_all(["img", "image"])]
            for img in images:
                if any(s and img.get_name().endswith(s.split("/")[-1]) for s in srcs):
                    cover = img
                    break
            if cover:
                break
        if cover is None:
            cover = max(images, key=lambda i: len(i.get_content()))
    cover_out = (cover.get_name().lower().rsplit(".", 1)[-1], cover.get_content()) if cover else None
    return {"title": title, "author": author, "cover": cover_out}


def _toc_map(book) -> dict[str, str]:
    """doc href -> chapter title. When several TOC entries point at one doc
    (a Part wrapper and its first chapter sharing a file), the deepest entry
    wins: the chapter, not the wrapper."""
    best: dict[str, tuple[int, str]] = {}
    try:
        entries = _flatten_toc(book.toc)
    except Exception:
        return {}
    for title, href, depth in entries:
        if IGNORE_TITLE_RE.match(title or ""):
            continue
        key = unquote(href).lstrip("/")
        if key not in best or depth > best[key][0]:
            best[key] = (depth, title)
    return {k: v[1] for k, v in best.items()}


def extract_chapters(epub_path: Path) -> list[dict]:
    book = epub.read_epub(str(epub_path), options={"ignore_ncx": False})
    meta_title = read_metadata(epub_path)["title"]
    book_title_norm = _norm_title(meta_title)

    id_to_item = {item.get_id(): item for item in book.get_items()}
    doc_ids = {item.get_id() for item in book.get_items_of_type(ITEM_DOCUMENT)}

    toc_by_href = _toc_map(book)
    use_toc = len(toc_by_href) >= 3

    chapters: list[dict] = []
    skipping = True  # nothing kept yet -> front matter gets dropped
    ended = False    # heading-less fallback hit a "Notes"/"Index" page

    for idref, _ in book.spine:
        if idref not in doc_ids or ended:
            continue
        item = id_to_item[idref]
        soup = BeautifulSoup(item.get_content(), "lxml")
        _strip_noise(soup, book_title_norm)
        body, heads = _doc_text(soup)
        body = _clean_text(body)
        href_key = unquote(item.get_name()).lstrip("/")

        toc_title = toc_by_href.get(href_key) if use_toc else None
        if toc_title is None and not use_toc:
            if heads:
                toc_title = heads[0]
            elif len(body.split()) <= 3 and SKIP_TITLE_RE.match(body):
                # A bare "Notes" / "Index" page in a heading-less book: back
                # matter starts here.
                ended = bool(chapters)
                skipping = True
                continue
            elif skipping and len(body.split()) >= MIN_CHAPTER_WORDS:
                # No TOC, no headings (old Calibre conversions): the whole
                # book becomes one chapter and the segmenter carves it into
                # "(n of m)" parts. Structure is lost, the audio still works.
                toc_title = meta_title

        if toc_title is not None:
            title = _clean_title(toc_title)
            if not title or SKIP_TITLE_RE.match(title) or (_norm_title(title) == book_title_norm and use_toc):
                skipping = True
                continue
            if CONTINUATION_TITLE_RE.match(title) and chapters and not skipping:
                chapters[-1]["text"] = _join(chapters[-1]["text"], body)
                continue
            # Fold the doc's own extra heading into the label: a bare number
            # label ("Chapter 1") leads, a subtitle trails.
            tn = _norm_title(title)
            extra = [h for h in heads
                     if _norm_title(h) not in (tn, book_title_norm)
                     and _norm_title(h) not in tn and tn not in _norm_title(h)]
            if extra and len(extra[0]) < 80:
                ex = _clean_title(extra[0])
                if NUMBER_LABEL_RE.match(ex) and not NUMBER_LABEL_RE.match(title):
                    title = f"{ex}: {title}"
                elif NUMBER_LABEL_RE.match(title):
                    title = f"{title}: {ex}"
                elif not NUMBER_LABEL_RE.match(ex):
                    title = f"{title}: {ex}"
            chapters.append({"title": title, "text": body})
            skipping = False
            continue

        if skipping or not chapters:
            continue
        # Continuation doc: its headings are sub-section titles, keep them.
        chapters[-1]["text"] = _join(chapters[-1]["text"], "\n\n".join(heads + [body]).strip())

    # Fold tiny chapters (part dividers, "CHAPTER ONE" label pages, epigraphs)
    # into the next chapter: their text leads it in, and a label like
    # "Introduction" prefixes the title, while "Part I"/"Epigraph" doesn't.
    merged: list[dict] = []
    carry_text, carry_title = "", ""
    for ch in chapters:
        if len(ch["text"].split()) < MIN_CHAPTER_WORDS:
            carry_text = (carry_text + "\n\n" + ch["text"]).strip()
            if not NO_PREFIX_RE.match(ch["title"]):
                carry_title = ch["title"] if not carry_title else f"{carry_title} / {ch['title']}"
            continue
        if carry_text or carry_title:
            ch["text"] = (carry_text + "\n\n" + ch["text"]).strip()
            if carry_title and len(carry_title) + len(ch["title"]) < 70:
                ch["title"] = f"{carry_title}: {ch['title']}"
            carry_text, carry_title = "", ""
        merged.append(ch)
    if carry_text and merged:
        merged[-1]["text"] += "\n\n" + carry_text

    for ch in merged:
        ch["text"] = _clean_text(ch["text"])
        ch["title"] = _clean_title(ch["title"])

    if not merged:
        raise RuntimeError(f"No chapters extracted from {epub_path.name}: TOC entries={len(toc_by_href)}, spine docs={len(doc_ids)}")
    return merged


def safe_name(text: str, limit: int = 80) -> str:
    """Filesystem-safe folder/file stem for a title or 'Title - Author'."""
    text = re.sub(r"[<>:\"/\\|?*]", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:limit].rstrip(" .") or "book"


if __name__ == "__main__":
    import sys
    path = Path(sys.argv[1])
    meta = read_metadata(path)
    print(f"{meta['title']} -- {meta['author']}  (cover: {'yes' if meta['cover'] else 'no'})")
    chapters = extract_chapters(path)
    total = 0
    for i, ch in enumerate(chapters, 1):
        words = len(ch["text"].split())
        total += words
        print(f"{i:2d}. {ch['title'][:64]!r:66s} {words:5d} words (~{words/150:.1f} min)")
    print(f"{len(chapters)} chapters, {total} words (~{total/150/60:.1f} h)")
