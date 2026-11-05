"""REST backend for the whale-tutoring politeness study."""
from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = PROJECT_ROOT / "logs"
PARTICIPANT_INDEX_PATH = PROJECT_ROOT / "participant_index.json"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-6-luna")
TEST_MODE = False
MAX_CLARIFICATION_REPLIES = 10

TRAINING_FACTS = [
    "Whales are mammals, not fish. They breathe air with lungs and are warm-blooded.",
    "Whales give birth to live young and feed their calves milk.",
    "Whales belong to the order Cetacea, along with dolphins and porpoises.",
    "Cetaceans include two broad groups: baleen whales and toothed whales.",
    "Baleen whales filter small prey from water using plates of baleen instead of teeth.",
    "The blue whale is the largest animal known to have lived on Earth.",
    "Humpback whales are known for complex songs, especially males on breeding grounds.",
    "Gray whales and some other whale species migrate very long distances each year.",
    "Orcas are toothed whales and the largest members of the dolphin family.",
    "Toothed whales such as dolphins use echolocation to navigate and find prey.",
    "Sperm whales are deep divers and can hunt squid at great depths.",
    "A narwhal's long tusk is an elongated tooth, usually found in males.",
    "Whale blubber helps with insulation and energy storage.",
    "A whale's tail flukes move up and down to propel it; whales surface to breathe through blowholes.",
    "Fishing-gear entanglement, ship strikes, and ocean noise are threats to some whale populations.",
]

WELCOME = """Hello! I’m your tutor for a short lesson about whales. Here are the 15 facts we’ll use today. Read through them, then ask me if you’d like any of them clarified.

""" + "\n\n".join(f"**{index}.** {fact}" for index, fact in enumerate(TRAINING_FACTS, start=1)) + "\n\n**Ask me questions** about any of these facts, or use the **Take quiz** button below whenever you’re ready."

SYSTEM_PROMPT = """You are a kind, smart professor tutoring a participant about whales. The participant has already been shown a fixed list of 15 whale facts. Answer their clarification questions warmly and accurately, using only the facts in the provided conversation and the fact list below. Do not introduce additional factual claims or quiz the participant. If asked about something outside the list, say that it is outside the scope of this short lesson. Keep answers concise. The lesson list is:
""" + "\n".join(f"{index}. {fact}" for index, fact in enumerate(TRAINING_FACTS, start=1))

# The five factual questions are shown in the frontend; correct options remain server-side.
ANSWER_KEY = ["B", "D", "A", "C", "E"]

# Five adapted feedback items, rated on a 10-point scale.
EVALUATION_ITEMS = [
    {"id": "friendly", "construct": "friendliness", "statement": "The tutor was friendly."},
    {"id": "clear", "construct": "clarity", "statement": "The tutor explained things clearly."},
    {"id": "competent_knowledgeable", "construct": "competence", "statement": "The tutor was competent and knowledgeable."},
    {"id": "pleasant", "construct": "friendliness", "statement": "The tutor was pleasant to interact with."},
    {"id": "helpful", "construct": "helpfulness", "statement": "The tutor was helpful."},
]

app = Flask(__name__)
_file_lock = threading.RLock()


def _log_path(user_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", user_id or ""):
        raise ValueError("Invalid participant ID")
    return LOG_DIR / f"{user_id}.json"


def _load_user(user_id: str) -> dict[str, Any] | None:
    path = _log_path(user_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _atomic_json_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def _save_user(user_id: str, data: dict[str, Any]) -> None:
    _atomic_json_write(_log_path(user_id), data)


def _new_user() -> tuple[str, dict[str, Any]]:
    user_id = str(uuid.uuid4())
    data: dict[str, Any] = {
        "mode": "training",
        "participant_index": None,
        "evaluation_condition": None,
        "trainer_agent_evaluations": [],
        "application_evaluations": {},
        "evaluation_ratings": [],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "assistant", "content": WELCOME},
        ],
    }
    return user_id, data


def _assign_condition(data: dict[str, Any]) -> None:
    """Assign in arrival order: odd participant indices use tutor UI; even use popup."""
    if data.get("participant_index") and data.get("evaluation_condition") in {"tutor", "popup"}:
        return
    current_index = 0
    if PARTICIPANT_INDEX_PATH.exists():
        with PARTICIPANT_INDEX_PATH.open("r", encoding="utf-8") as handle:
            counter_data = json.load(handle)
        current_index = int(counter_data.get("current_index", 0))
    new_index = current_index + 1
    _atomic_json_write(PARTICIPANT_INDEX_PATH, {"current_index": new_index})
    data["participant_index"] = new_index
    data["evaluation_condition"] = "tutor" if new_index % 2 == 1 else "popup"


def _training_response_count(data: dict[str, Any]) -> int:
    # The initial assistant message contains the fixed facts; subsequent assistant messages are replies.
    count = sum(message.get("role") == "assistant" for message in data.get("messages", [])) - 1
    return max(0, count)


def _refresh_fact_message(data: dict[str, Any]) -> None:
    """Keep the initial fact formatting current for sessions created before a UI revision."""
    if data.get("mode") not in {"training", "testing"}:
        return
    for message in data.get("messages", []):
        if message.get("role") == "assistant":
            if "Here are the 15 facts" in message.get("content", ""):
                message["content"] = WELCOME
            break


def _session_payload(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_uuid": user_id,
        "participant_index": data.get("participant_index"),
        "evaluation_condition": data.get("evaluation_condition"),
        "mode": data.get("mode", "training"),
        "messages": [message for message in data.get("messages", []) if message.get("role") != "system"],
        "response_count": _training_response_count(data),
    }


def _json_error(message: str, status: int):
    return jsonify({"error": message}), status


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = os.environ.get("CORS_ALLOW_ORIGIN", "*")
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options(_path):
    return ("", 204)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "test_mode": TEST_MODE})


@app.post("/api/start")
def start_session():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    try:
        with _file_lock:
            if user_id:
                data = _load_user(user_id)
                if data is None:
                    return _json_error("Participant session not found. Use Start over to begin a new session.", 404)
            else:
                user_id, data = _new_user()
            _assign_condition(data)
            _refresh_fact_message(data)
            _save_user(user_id, data)
            return jsonify(_session_payload(user_id, data))
    except (ValueError, json.JSONDecodeError, OSError, TypeError):
        app.logger.exception("Could not start participant session")
        return _json_error("Could not start this participant session.", 500)


@app.get("/api/session")
def get_session():
    user_id = request.args.get("user_uuid", "")
    if not user_id:
        return _json_error("Participant ID is required.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Could not load this participant session.", 400)
    if data is None:
        return _json_error("Participant session not found. Use Start over to begin a new session.", 404)
    return jsonify(_session_payload(user_id, data))


@app.post("/api/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    message = (payload.get("message") or "").strip()
    if not message:
        return _json_error("Please enter a message.", 400)
    if len(message) > 4000:
        return _json_error("Message is too long (maximum 4,000 characters).", 400)

    with _file_lock:
        if user_id:
            try:
                data = _load_user(user_id)
            except (ValueError, json.JSONDecodeError, OSError):
                return _json_error("Invalid participant session.", 400)
            if data is None:
                return _json_error("Participant session not found. Use Start over to begin a new session.", 404)
        else:
            user_id, data = _new_user()
            _assign_condition(data)

        if data.get("mode") != "training":
            return _json_error("The clarification phase is complete.", 409)
        if _training_response_count(data) >= MAX_CLARIFICATION_REPLIES:
            return _json_error("You have reached the clarification limit. Begin the knowledge check.", 409)

        messages = data["messages"] + [{"role": "user", "content": message}]
        try:
            if TEST_MODE:
                time.sleep(3)
                next_number = _training_response_count(data) + 1
                reply = f"### Clarification {next_number}\n\nWhales are mammals, not fish. They breathe air with lungs and surface through blowholes. This is a simulated response for local testing."
            else:
                from openai import OpenAI
                client = OpenAI()
                completion = client.chat.completions.create(model=MODEL, messages=messages)
                reply = completion.choices[0].message.content or "I’m sorry, I couldn’t form a response. Please try again."
        except Exception as exc:
            app.logger.exception("Chat completion failed")
            return _json_error(f"The tutor could not respond. Check the backend configuration and try again. ({type(exc).__name__})", 502)

        data["messages"] = messages + [{"role": "assistant", "content": reply}]
        response_count = _training_response_count(data)
        if response_count >= MAX_CLARIFICATION_REPLIES:
            data["mode"] = "testing"
        _save_user(user_id, data)

    return jsonify({"user_uuid": user_id, "reply": reply, "response_count": response_count,
                    "mode": data["mode"], "evaluation_condition": data["evaluation_condition"]})


@app.post("/api/grade")
def grade():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    answers = payload.get("answers")
    if not isinstance(answers, list) or len(answers) != len(ANSWER_KEY):
        return _json_error(f"Submit exactly {len(ANSWER_KEY)} answers.", 400)
    normalized = [str(answer).strip().upper() for answer in answers]
    if any(answer not in {"A", "B", "C", "D", "E"} for answer in normalized):
        return _json_error("Each answer must be A, B, C, D, or E.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
            if data is None:
                return _json_error("Participant session not found.", 404)
            if data.get("mode") != "testing":
                return _json_error("The assessment is not available in this phase.", 409)
            results = [answer == correct for answer, correct in zip(normalized, ANSWER_KEY)]
            data["quiz_answers"] = normalized
            data["quiz_results"] = results
            _save_user(user_id, data)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Invalid participant session.", 400)
    return jsonify({"results": results})


@app.post("/api/phase")
def update_phase():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    new_mode = payload.get("mode")
    if new_mode not in {"testing", "evaluating"}:
        return _json_error("Unsupported phase transition.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
            if data is None:
                return _json_error("Participant session not found.", 404)
            old_mode = data.get("mode")
            allowed = (new_mode == "testing" and old_mode in {"training", "testing"}) or (
                new_mode == "evaluating" and old_mode in {"testing", "evaluating"}
            )
            if not allowed:
                return _json_error("This phase transition is not available yet.", 409)
            data["mode"] = new_mode
            _save_user(user_id, data)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Invalid participant session.", 400)
    return jsonify({"mode": new_mode})


@app.post("/api/submit-evaluation")
def submit_evaluation():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    responses = payload.get("evaluation_responses")
    submission_channel = payload.get("submission_channel")
    if not isinstance(responses, list) or len(responses) != len(EVALUATION_ITEMS):
        return _json_error(f"Submit exactly {len(EVALUATION_ITEMS)} evaluation ratings.", 400)
    if any(type(score) is not int or score < 1 or score > 10 for score in responses):
        return _json_error("Each evaluation rating must be an integer from 1 to 10.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
            if data is None:
                return _json_error("Participant session not found.", 404)
            if data.get("mode") != "evaluating":
                return _json_error("This participant is not awaiting evaluation.", 409)
            condition = data.get("evaluation_condition")
            if condition not in {"tutor", "popup"}:
                return _json_error("The participant's evaluation condition is missing.", 409)
            if submission_channel != condition:
                return _json_error("This questionnaire does not match the assigned evaluation condition.", 409)
            ratings = [
                {"item_id": item["id"], "construct": item["construct"],
                 "statement": item["statement"], "score": score}
                for item, score in zip(EVALUATION_ITEMS, responses)
            ]
            data["evaluation_ratings"] = ratings
            serialized = [f"{item['id']}: {score}" for item, score in zip(EVALUATION_ITEMS, responses)]
            application_ratings = {item["statement"]: score for item, score in zip(EVALUATION_ITEMS, responses)}
            data["trainer_agent_evaluations"] = serialized if condition == "tutor" else []
            data["application_evaluations"] = application_ratings if condition == "popup" else {}
            data["mode"] = "done"
            _save_user(user_id, data)
    except (ValueError, json.JSONDecodeError, OSError):
        app.logger.exception("Could not save participant evaluation")
        return _json_error("Could not save the evaluation. Please try submitting again.", 500)
    return jsonify({"mode": "done"})


def main():
    global TEST_MODE
    parser = argparse.ArgumentParser(description="Run the study backend")
    parser.add_argument("--test-mode", action="store_true", help="Use delayed simulated tutor responses")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()
    TEST_MODE = args.test_mode
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
