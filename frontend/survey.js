// Must match the local storage key used by app.js. The main page stores these
// responses before opening this same-origin survey window.
const SESSION_STORAGE_KEY = "fieldnotes_participant_uuid";
const USER_ANSWERS_PREFIX = "fieldnotes_trainer_evaluations_";
const SESSION_DONE_PREFIX = "fieldnotes_session_done_";
const API_BASE_URL = "http://localhost:5000";

const params = new URLSearchParams(window.location.search);
const userId = params.get("user_uuid") || localStorage.getItem(SESSION_STORAGE_KEY) || "";
const form = document.querySelector("#survey-form");
const status = document.querySelector("#status");
const submitButton = document.querySelector("#submit-button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!userId) {
    status.textContent = "This survey is missing its participant session. Return to the study page and try again.";
    return;
  }
  let trainerAnswers;
  try { trainerAnswers = JSON.parse(localStorage.getItem(USER_ANSWERS_PREFIX + userId) || "null"); }
  catch { trainerAnswers = null; }
  if (!Array.isArray(trainerAnswers) || trainerAnswers.length !== 4 || trainerAnswers.some((answer) => typeof answer !== "string" || !answer.trim())) {
    status.textContent = "The tutor feedback responses could not be found. Please return to the study page and complete that section first.";
    return;
  }

  const fields = [
    ["tone", "The tutor's tone was warm and respectful"],
    ["knowledge", "The tutor seemed knowledgeable about the subject"],
    ["clarity", "The tutor's explanations were easy to follow"],
    ["responsiveness", "The tutor responded appropriately to what I asked or said"],
    ["comfort", "I felt comfortable interacting with the tutor"],
  ];
  const applicationAnswers = fields.map(([name, label]) => {
    const selected = form.querySelector(`input[name="${name}"]:checked`);
    return `${label}: ${selected ? selected.value : ""} / 5`;
  });
  applicationAnswers.push(`What stood out most about the tutor's manner or style?: ${form.elements.comment.value.trim()}`);
  applicationAnswers.push(`What is one thing that could improve this tutoring experience?: ${form.elements.improvement.value.trim()}`);

  submitButton.disabled = true;
  status.textContent = "Submitting your responses…";
  try {
    const response = await fetch(`${API_BASE_URL}/api/submit-evaluation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_uuid: userId,
        trainer_agent_evaluations: trainerAnswers,
        application_evaluations: applicationAnswers,
        participant_name: form.elements["participant-name"].value.trim(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Submission failed (${response.status})`);
    localStorage.setItem(SESSION_DONE_PREFIX + userId, "true");
    localStorage.removeItem(USER_ANSWERS_PREFIX + userId);
    form.hidden = true;
    status.textContent = "Thank you. Your survey was submitted successfully, and your study session is complete.";
    document.querySelector("#close-button").hidden = false;
  } catch (error) {
    status.textContent = `${error.message} Please check your connection and submit again.`;
    submitButton.disabled = false;
  }
});

document.querySelector("#close-button").addEventListener("click", () => window.close());
