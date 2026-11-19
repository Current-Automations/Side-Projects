import sys
from pathlib import Path

from ebooklib import epub, ITEM_DOCUMENT
from bs4 import BeautifulSoup

path = Path(sys.argv[1])
book = epub.read_epub(str(path), options={"ignore_ncx": False})

print("=== TITLE/META ===")
print(book.get_metadata("DC", "title"))

print("\n=== SPINE ORDER (id, href) ===")
id_to_item = {item.get_id(): item for item in book.get_items()}
for idref, _ in book.spine:
    item = id_to_item.get(idref)
    print(idref, "->", item.get_name() if item else "MISSING")

print("\n=== DOCUMENT ITEMS: first 300 chars of text each ===")
for item in book.get_items_of_type(ITEM_DOCUMENT):
    soup = BeautifulSoup(item.get_content(), "html.parser")
    text = soup.get_text(" ", strip=True)
    print(f"\n--- {item.get_name()} ({len(text)} chars) ---")
    print(text[:300])
