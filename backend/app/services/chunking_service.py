from dataclasses import dataclass

from app.config import settings


@dataclass
class Chunk:
    content: str
    index: int
    start_pos: int
    end_pos: int


SEPARATORS = [
    "\n\n",  # Paragraphs
    "\n",    # Lines
    ". ",    # Sentences
    "! ",
    "? ",
    " ",     # Words
    "",      # Characters (last resort)
]


def _split_text(text: str, separator: str) -> list[str]:
    if separator == "":
        return list(text)
    return text.split(separator)


def _recursive_split(
    text: str,
    chunk_size: int,
    separators: list[str],
) -> list[str]:
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

    separator = separators[0]
    remaining_separators = separators[1:] if len(separators) > 1 else [""]

    parts = _split_text(text, separator)

    chunks = []
    current_chunk = ""

    for part in parts:
        joiner = separator if separator else ""
        candidate = current_chunk + joiner + part if current_chunk else part

        if len(candidate) <= chunk_size:
            current_chunk = candidate
        else:
            if current_chunk:
                chunks.append(current_chunk)
            if len(part) > chunk_size:
                chunks.extend(_recursive_split(part, chunk_size, remaining_separators))
                current_chunk = ""
            else:
                current_chunk = part

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def chunk_text(content: str) -> list[Chunk]:
    chunk_size = settings.chunk_size
    chunk_overlap = settings.chunk_overlap

    raw_chunks = _recursive_split(content, chunk_size, SEPARATORS)

    chunks = []
    pos = 0

    for i, raw_chunk in enumerate(raw_chunks):
        start_pos = content.find(raw_chunk, pos)
        if start_pos == -1:
            start_pos = pos
        end_pos = start_pos + len(raw_chunk)

        chunks.append(Chunk(
            content=raw_chunk,
            index=i,
            start_pos=start_pos,
            end_pos=end_pos,
        ))

        pos = max(pos, end_pos - chunk_overlap)

    return chunks
