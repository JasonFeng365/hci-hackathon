"""REST backend for the whale-tutoring study."""
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
MODEL = os.environ.get("OPENAI_MODEL", "gpt-6-luna")
TEST_MODE = False

SYSTEM_PROMPT = """You are a kind, smart professor tutoring a participant about whales. Be warm,
curious, patient, and accurate. Guide the lesson proactively while responding to
the participant's questions and interests. Teach the following study facts in a
natural, conversational way over the session; do not dump them all at once, and
never claim to have covered a fact you have not explained:

- Whales are mammals, not fish. They breathe air with lungs and are warm-blooded.
- Whales give birth to live young and feed their calves milk.
- Whales belong to the order Cetacea, along with dolphins and porpoises.
- Cetaceans are divided into baleen whales and toothed whales.
- Baleen whales filter small prey from water using plates of baleen.
- Humpback, blue, gray, and fin whales are baleen whales.
- Toothed whales use teeth to catch prey; sperm whales and orcas are toothed whales.
- Despite the common name, orcas are the largest members of the dolphin family.
- The blue whale is the largest animal known to have lived on Earth.
- A blue whale's heart is exceptionally large, roughly comparable in size to a small car.
- The blue whale's tongue can weigh about as much as an elephant.
- Humpback whales are known for complex songs, especially males on breeding grounds.
- Humpbacks can migrate thousands of miles between feeding and breeding areas.
- Gray whales undertake one of the longest migrations of any mammal.
- Many baleen whales migrate seasonally, feeding in cooler waters and breeding in warmer waters.
- Whales communicate using sounds; some calls can travel long distances underwater.
- Toothed whales such as dolphins use echolocation to navigate and find prey.
- Sperm whales are deep divers and can hunt squid at great depths.
- Narwhals are toothed whales; the long tusk is an elongated tooth, usually found in males.
- Belugas are called white whales and can make a wide variety of sounds.
- The bowhead whale lives in Arctic and sub-Arctic waters and has a very long lifespan.
- Whale blubber helps with insulation and energy storage.
- Whale tails are called flukes; they move up and down to propel the animal.
- The two blowholes of a baleen whale are visible as a paired opening; toothed whales usually have one.
- Whales surface to breathe through blowholes located on top of their heads.
- A whale's spout is warm, moist air and water vapor, not water being breathed out from the lungs.
- Some whale species live in social groups, while others are often solitary.
- Whales can play important roles in marine ecosystems and nutrient cycling.
- Entanglement in fishing gear, ship strikes, and ocean noise are threats to some whale populations.
- Conservation measures and responsible maritime practices can reduce some human-caused risks.

Use appropriately qualified language for scientific details. Do not test or quiz the
participant during this tutoring phase. After about ten of your replies, the app will
move them to an assessment. Keep replies concise and explain ideas clearly."""

WELCOME = "Hello! I’m glad you’re here. I’ll be your tutor for a short lesson about whales. What would you like to know, or should I get us started with how whales differ from fish?"

# Answer keys stay on the server. The frontend receives the questions and choices only.
ANSWER_KEY = ["B", "D", "A", "C", "E", "B", "D", "A", "C", "E", "B", "D", "A", "C", "E"]

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


def _save_user(user_id: str, data: dict[str, Any]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = _log_path(user_id)
    temp_path = path.with_suffix(".json.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def _new_user() -> tuple[str, dict[str, Any]]:
    user_id = str(uuid.uuid4())
    data: dict[str, Any] = {
        "mode": "training",
        "trainer_agent_evaluations": [],
        "application_evaluations": [],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "assistant", "content": WELCOME},
        ],
    }
    return user_id, data


def _training_response_count(data: dict[str, Any]) -> int:
    # The first assistant message is the static welcome, not a generated reply.
    count = sum(message.get("role") == "assistant" for message in data.get("messages", [])) - 1
    return max(0, count)


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


@app.get("/api/session")
def get_session():
    user_id = request.args.get("user_uuid", "")
    if not user_id:
        return jsonify({"mode": "training", "messages": [], "response_count": 0})
    try:
        with _file_lock:
            data = _load_user(user_id)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Could not load this participant session.", 400)
    if data is None:
        return _json_error("Participant session not found. Use Start over to begin a new session.", 404)
    return jsonify({
        "mode": data.get("mode", "training"),
        "messages": [m for m in data.get("messages", []) if m.get("role") != "system"],
        "response_count": _training_response_count(data),
    })


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

        if data.get("mode") != "training":
            return _json_error("The tutoring phase is complete.", 409)
        if _training_response_count(data) >= 10:
            data["mode"] = "testing"
            _save_user(user_id, data)
            return _json_error("The tutoring phase is complete.", 409)

        messages = data["messages"] + [{"role": "user", "content": message}]
        try:
            if TEST_MODE:
                time.sleep(3)
                next_number = _training_response_count(data) + 1
                reply = f"### Practice tutor response {next_number}\n\nGreat question! Here’s a whale fact to explore: **whales are mammals, not fish**. They breathe air with lungs and need to surface regularly. What else would you like to learn?\n\n*This is a simulated reply for local testing.*"
            else:
                from openai import OpenAI
                client = OpenAI()
                completion = client.chat.completions.create(model=MODEL, messages=messages)
                reply = completion.choices[0].message.content or "I’m sorry, I couldn’t form a response. Please try again."
        except Exception as exc:  # Keep API details out of the browser response.
            app.logger.exception("Chat completion failed")
            return _json_error(f"The tutor could not respond. Check the backend configuration and try again. ({type(exc).__name__})", 502)

        data["messages"] = messages + [{"role": "assistant", "content": reply}]
        response_count = _training_response_count(data)
        if response_count >= 10:
            data["mode"] = "testing"
        _save_user(user_id, data)

    return jsonify({"user_uuid": user_id, "reply": reply, "response_count": response_count,
                    "mode": data["mode"]})


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
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Invalid participant session.", 400)
    return jsonify({"results": [answer == correct for answer, correct in zip(normalized, ANSWER_KEY)]})


@app.post("/api/phase")
def update_phase():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    new_mode = payload.get("mode")
    if new_mode != "evaluating":
        return _json_error("Unsupported phase transition.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
            if data is None:
                return _json_error("Participant session not found.", 404)
            if data.get("mode") not in {"testing", "evaluating"}:
                return _json_error("The evaluation phase cannot begin yet.", 409)
            data["mode"] = "evaluating"
            _save_user(user_id, data)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Invalid participant session.", 400)
    return jsonify({"mode": "evaluating"})


@app.post("/api/submit-evaluation")
def submit_evaluation():
    payload = request.get_json(silent=True) or {}
    user_id = (payload.get("user_uuid") or "").strip()
    trainer_answers = payload.get("trainer_agent_evaluations")
    application_answers = payload.get("application_evaluations")
    name = (payload.get("participant_name") or "").strip()
    if not isinstance(trainer_answers, list) or not all(isinstance(x, str) for x in trainer_answers):
        return _json_error("Trainer evaluation responses are required.", 400)
    if not isinstance(application_answers, list) or not all(isinstance(x, str) for x in application_answers):
        return _json_error("Survey responses are required.", 400)
    if len(trainer_answers) > 5 or len(application_answers) > 10 or len(name) > 120:
        return _json_error("One or more evaluation fields exceed the allowed limits.", 400)
    try:
        with _file_lock:
            data = _load_user(user_id)
            if data is None:
                return _json_error("Participant session not found.", 404)
            if data.get("mode") != "evaluating":
                return _json_error("This participant is not awaiting evaluation.", 409)
            data["trainer_agent_evaluations"] = trainer_answers
            data["application_evaluations"] = application_answers
            data["participant_name"] = name
            data["mode"] = "done"
            _save_user(user_id, data)
    except (ValueError, json.JSONDecodeError, OSError):
        return _json_error("Could not save the evaluation. Please try submitting again.", 400)
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
