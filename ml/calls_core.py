"""
Call Desk (E5): the pure part of the optional Eva-4B evasion task (calls.evasion), kept apart from Modal so it is
tested locally (python ml/test_calls_core.py). Eva-4B (FutureMa/Eva-4B, Apache-2.0 weights on Qwen3-4B-Instruct)
labels an earnings-call answer as direct, intermediate or fully evasive. Only the weights are used, never the
EvasionBench dataset (built from licensed S&P Capital IQ transcripts); and the whole path stays off unless the
owner confirms the weights may be used commercially (EDGE_CALLS_EVA=1 on the app side).

Probabilities come from the model's next-token scores for the first token of each label after the prompt,
normalised over the three labels (a softmax over their logits). When only generated text is available the label
is parsed from it and smoothed, so a single word never becomes a certainty.
"""
from __future__ import annotations

import math
import re

LABELS = ("direct", "intermediate", "fully_evasive")
SYSTEM = ("You are a financial analyst. Classify how the management answer responds to the analyst question on an "
          "earnings call: direct (answers the core question with specific information), intermediate (gives related "
          "information but sidesteps the core) or fully_evasive (does not answer). Reply with one word: direct, "
          "intermediate or fully_evasive.")
MAX_CHARS = {"question": 3000, "answer": 5000}


def build_messages(question: str, answer: str) -> list[dict]:
    """Chat messages for one pair, each side trimmed to its limit."""
    q = (question or "").strip()[: MAX_CHARS["question"]]
    a = (answer or "").strip()[: MAX_CHARS["answer"]]
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"Question: {q}\n\nAnswer: {a}\n\nLabel:"}]


def softmax(xs: list[float]) -> list[float]:
    m = max(xs)
    e = [math.exp(x - m) for x in xs]
    s = sum(e)
    return [v / s for v in e]


def label_probs(logits: list[float]) -> list[float]:
    """Probabilities of (direct, intermediate, fully_evasive) from the three labels' first-token logits."""
    if len(logits) != 3 or not all(math.isfinite(x) for x in logits):
        raise ValueError("need three finite logits")
    return softmax(list(logits))


def parse_label(text: str, smooth: float = 0.15) -> list[float]:
    """A generated reply as probabilities: the named label gets 1 - smooth, the others share smooth."""
    t = (text or "").strip().lower()
    m = re.search(r"fully[_\s-]?evasive|evasive|intermediate|direct", t)
    if not m:
        return [1 / 3, 1 / 3, 1 / 3]
    word = m.group(0)
    k = 2 if "evasive" in word else 1 if word == "intermediate" else 0
    out = [smooth / 2] * 3
    out[k] = 1 - smooth
    return out


def clean_pairs(pairs) -> list[dict]:
    """Validate the request: a list of at most 80 {question, answer} with text on both sides."""
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("input needs 'pairs': a list of {question, answer}")
    if len(pairs) > 80:
        raise ValueError("at most 80 pairs a call")
    out = []
    for p in pairs:
        if not isinstance(p, dict) or not str(p.get("question") or "").strip() or not str(p.get("answer") or "").strip():
            raise ValueError("each pair needs a question and an answer")
        out.append({"question": str(p["question"]), "answer": str(p["answer"])})
    return out
