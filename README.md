# Fieldnotes whale tutoring study prototype

A static HTML/JavaScript study frontend backed by a Flask REST API. Participant conversations and evaluation responses are stored in one JSON file per participant under `logs/` (ignored by git).

## Run locally

Requirements: Python 3.10+.

1. Create and activate a virtual environment, then install the backend dependencies:

   ```sh
   python -m venv .venv
   # Windows PowerShell: .venv\Scripts\Activate.ps1
   # macOS/Linux: source .venv/bin/activate
   pip install -r backend/requirements.txt
   ```

2. Start the API in simulated mode (each tutor response waits three seconds; no API key is needed):

   ```sh
   python backend/app.py --test-mode
   ```

   The backend listens on `http://localhost:5000` by default. It generates ten simulated tutor replies before entering the assessment phase.

3. In a second terminal, serve the static frontend from its directory:

   ```sh
   cd frontend
   python -m http.server 8000
   ```

4. Open <http://localhost:8000>.

The frontend's backend URL is configured at the top of `frontend/app.js` and `frontend/survey.js` as `API_BASE_URL`. Keep both values in sync. Serve the HTML over HTTP rather than opening it as a `file://` URL; the survey popup uses same-origin local storage to pass the in-app evaluation responses.

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

## Study flow

- A participant ID is created on their first chat message and persists in browser `localStorage` until **Start over** is clicked.
- Ten tutor replies complete the lesson. The frontend then presents 15 placeholder whale questions. The answer key is held only by the backend.
- Quiz feedback is shown one question at a time, including the participant's answer and whether it was right or wrong, without revealing the correct answer.
- Four in-app free-response questions are followed by a separate plain-HTML survey popup. A session is marked `done` only after the survey is successfully posted.
- Each participant's JSON log contains the phase, both evaluation response lists, the optional participant name, and the conversation messages.

The lesson facts, questions, answer key, evaluation prompts, and survey prompts are placeholders for the study team to review and replace. The frontend quiz questions live in `frontend/app.js`; their answer key is in `backend/app.py`.
