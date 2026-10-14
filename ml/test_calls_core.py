"""
Local checks for the Eva-4B task's pure code (ml/calls_core.py): python ml/test_calls_core.py (standard library only).
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import calls_core  # noqa: E402

passed = failed = 0


def check(label, cond):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label}")


m = calls_core.build_messages("What is capex next year?", "We don't guide on that." + "x" * 9000)
check("messages: system then user, the answer trimmed", m[0]["role"] == "system" and m[1]["role"] == "user" and len(m[1]["content"]) < 8200)
p = calls_core.label_probs([2.0, 0.0, -1.0])
check("label probabilities sum to one and follow the logits", abs(sum(p) - 1) < 1e-9 and p[0] > p[1] > p[2])
try:
    calls_core.label_probs([1.0, float("nan"), 0.0])
    check("non-finite logits are refused", False)
except ValueError:
    check("non-finite logits are refused", True)
check("a generated 'fully_evasive' is smoothed, never certain", calls_core.parse_label("Fully_evasive")[2] == 0.85)
check("'intermediate' parses", calls_core.parse_label(" intermediate.")[1] == 0.85)
check("an unreadable reply is uniform", calls_core.parse_label("unsure") == [1 / 3, 1 / 3, 1 / 3])
try:
    calls_core.clean_pairs([{"question": "q", "answer": ""}])
    check("a pair without an answer is refused", False)
except ValueError:
    check("a pair without an answer is refused", True)
check("valid pairs pass through", calls_core.clean_pairs([{"question": "q?", "answer": "a."}]) == [{"question": "q?", "answer": "a."}])
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
