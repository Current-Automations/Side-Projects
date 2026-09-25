import torch
from transformers import Owlv2Processor, Owlv2ForObjectDetection

MID = "google/owlv2-base-patch16-ensemble"
QUERIES = ["a pokemon trading card", "a graded card slab", "a trading card in a plastic case"]

_proc = None
_model = None


def _load():
    global _proc, _model
    if _model is None:
        _proc = Owlv2Processor.from_pretrained(MID)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        _model = Owlv2ForObjectDetection.from_pretrained(MID, dtype=dtype).to(device).eval()
    return _proc, _model


@torch.no_grad()
def detect_candidates(images):
    """Batched OWLv2 zero-shot card detection.

    Same tuned geometric filters as the original detect_crop.py: aspect 1.15-2.3,
    center column, min size, max area, score >= 0.15.

    Returns one list of (score, x0, y0, x1, y1, aspect) per image, sorted largest
    box first. Empty list if nothing passed the filters.
    """
    if not images:
        return []
    proc, model = _load()
    device = next(model.parameters()).device
    dtype = next(model.parameters()).dtype
    text = [QUERIES] * len(images)
    x = proc(text=text, images=images, return_tensors="pt").to(device)
    x["pixel_values"] = x["pixel_values"].to(dtype)
    out = model(**x)
    target_sizes = torch.tensor([[max(im.size), max(im.size)] for im in images]).to(device)
    all_r = proc.post_process_grounded_object_detection(out, threshold=0.1, target_sizes=target_sizes)

    results = []
    for im, r in zip(images, all_r):
        W, H = im.size
        boxes = []
        for b, s in zip(r["boxes"].tolist(), r["scores"].tolist()):
            x0, y0, x1, y1 = [max(0, v) for v in b]
            x1, y1 = min(W, x1), min(H, y1)
            w, h = x1 - x0, y1 - y0
            if w < 40 or h < 60 or w * h > 0.5 * W * H:
                continue
            ar = h / max(w, 1)
            cx = (x0 + x1) / 2
            if not (0.25 * W < cx < 0.75 * W) or y1 > 0.95 * H or not (1.15 < ar < 2.3):
                continue
            boxes.append((s, x0, y0, x1, y1, ar))
        boxes = [b for b in boxes if b[0] >= 0.15]
        boxes.sort(key=lambda b: -((b[3] - b[1]) * (b[4] - b[2])))
        results.append(boxes)
    return results


def detect_card(images):
    """Convenience wrapper: best (largest passing) box per image, or None."""
    out = []
    for boxes in detect_candidates(images):
        if not boxes:
            out.append(None)
            continue
        s, x0, y0, x1, y1, ar = boxes[0]
        out.append({"score": round(s, 3), "box": [int(x0), int(y0), int(x1), int(y1)], "aspect": round(ar, 2)})
    return out
