"""Display token -> pronunciation spelling used for CTC alignment.

Each display token (lyric line split on spaces) maps to one or more
pronunciation sub-words made of plain letters (and internal apostrophes).
Project-specific spellings (acronyms, names, URLs) live in the profile's PRON
dict; everything else is lower-cased, folded to ASCII letters and split.
"""
import re
import unicodedata

import common

PRON = common.PROFILE.PRON
# alternative pronunciations to test (scored by alignment likelihood)
ALT = common.PROFILE.PRON_ALT


def fold(s: str) -> str:
    """Strip diacritics (ü -> u, é -> e, ß -> ss), as the romanizing aligner
    (MMS_FA) expects."""
    s = s.replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def pron(token: str) -> list[str]:
    if token in PRON:
        return PRON[token].split()
    w = token.lower()
    w = w.replace("’", "'")
    w = fold(w)
    w = re.sub(r"[^a-z' ]", " ", w)
    w = w.strip("' ")
    return [p.strip("'") for p in w.split() if p.strip("'")]


if __name__ == "__main__":
    for _, _, t in common.load_lyrics_src():
        print(t, "->", " | ".join(" ".join(pron(w)) for w in t.split(" ")))
