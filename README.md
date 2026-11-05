# Fieldnotes whale tutoring study

A static HTML/JavaScript study frontend backed by a Flask REST API. Each participant's conversation and evaluation data are stored in `logs/<uuid>.json` (the logs directory is ignored by git).

## Run locally

Requirements: Python 3.10+.

1. Create and activate a virtual environment, then install the backend dependencies:

   ```sh
   python -m venv .venv
   # Windows PowerShell: .venv\Scripts\Activate.ps1
   # macOS/Linux: source .venv/bin/activate
   pip install -r backend/requirements.txt
   ```

2. Start the API in simulated mode (each clarification response waits three seconds; no API key is needed):

   ```sh
   python backend/app.py --test-mode
   ```

   The backend listens on `http://localhost:5000` by default. A participant may ask up to ten clarification questions about the fixed facts before the input is locked; the inline button can start the knowledge check at any time.

3. In a second terminal, serve the static frontend from its directory:

   ```sh
   cd frontend
   python -m http.server 8000
   ```

4. Open <http://localhost:8000>.

The backend URL is configured at the top of `frontend/app.js` and `frontend/survey.js` as `API_BASE_URL`; keep both values in sync. Serve the frontend over HTTP rather than opening it with a `file://` URL. The popup is served from the same origin as the main page.

## Evaluation-condition assignment

Participants are assigned sequentially when a new session starts; assignment is **not random**:

- Index 1, 3, 5, …: ratings are asked by the tutor inside the chat (`tutor` condition).
- Index 2, 4, 6, …: the tutor opens the independent plain-HTML questionnaire (`popup` condition).

The current index is persisted in the root-level `participant_index.json` file and is also saved in each participant log. **Start over** creates a new session and consumes the next index. Do not reset the counter during a study. To begin a fresh run, set `current_index` to `0` before recruiting participants; preserve the old logs separately if you need them. The counter coordinates concurrent requests within this single Flask process; use a single worker or implement a cross-process lock before running multiple backend workers.

## Use the OpenAI tutor

Set `OPENAI_API_KEY` in the backend environment, then run without `--test-mode`:

```sh
# PowerShell
$env:OPENAI_API_KEY = "your-key"
python backend/app.py

# macOS/Linux
export OPENAI_API_KEY="your-key"
python backend/app.py
```

The model defaults to `gpt-6-luna`; override it with `OPENAI_MODEL` if needed. The backend currently allows cross-origin requests for prototype use. Restrict `CORS_ALLOW_ORIGIN` before deployment.

## Study flow and logged measures

- The tutor presents the same 15 whale facts in its initial message. Participants can ask clarifications or continue to the five-question multiple-choice knowledge check.
- Quiz answer choices are shown in a single horizontal, scrollable row. The answer key remains on the backend. The review includes each question, the participant's answer, and right/wrong feedback, but not the correct answer.
- Evaluation has nine adapted 10-point items: five friendliness items and four competence items. Their wording and order are identical in both conditions. The 10-point scale is intended to align with Study 1 of *Computers Are Social Actors*; these item wordings are our adaptation, not claimed to be the paper's original items.
- Logs store `participant_index`, `evaluation_condition`, the nine item IDs/constructs/scores, and the training conversation. The relevant legacy response list (`trainer_agent_evaluations` or `application_evaluations`) is populated for the assigned condition. No participant name is collected.
- The session is marked `done` only after all nine ratings are successfully posted.

The fact list, five quiz questions, answer key, and rating statements are study materials that should be reviewed before data collection. Quiz questions are in `frontend/app.js`; the matching server-side key is in `backend/app.py`.
