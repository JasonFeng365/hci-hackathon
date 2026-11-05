// Independent questionnaire condition. Keep these item IDs/order/text aligned with app.js.
const SESSION_DONE_PREFIX = "fieldnotes_session_done_";
const API_BASE_URL = "http://localhost:5000";
const ITEMS = [
  { id: "friendly", construct: "friendliness", statement: "The tutor was friendly." },
  { id: "clear", construct: "clarity", statement: "The tutor explained things clearly." },
  { id: "competent_knowledgeable", construct: "competence", statement: "The tutor was competent and knowledgeable." },
  { id: "pleasant", construct: "friendliness", statement: "The tutor was pleasant to interact with." },
  { id: "helpful", construct: "helpfulness", statement: "The tutor was helpful." },
];

const params = new URLSearchParams(window.location.search);
const userId = params.get("user_uuid") || "";
const form = document.querySelector("#survey-form");
const status = document.querySelector("#status");
const submitButton = document.querySelector("#submit-button");

function renderItems() {
  const container = document.querySelector("#rating-items");
  ITEMS.forEach((item, index) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${item.statement}`;
    fieldset.append(legend);
    for (let score = 1; score <= 10; score += 1) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = item.id;
      input.value = String(score);
      input.required = true;
      label.append(input, document.createTextNode(` ${score} `));
      fieldset.append(label);
    }
    container.append(fieldset);
  });
}
renderItems();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!userId) {
    status.textContent = "This questionnaire is missing its participant session. Return to the study page and try again.";
    return;
  }
  const responses = ITEMS.map((item) => Number(form.querySelector(`input[name="${item.id}"]:checked`)?.value));
  if (responses.length !== ITEMS.length || responses.some((score) => !Number.isInteger(score) || score < 1 || score > 10)) {
    status.textContent = "Please provide a rating for every statement.";
    return;
  }

  submitButton.disabled = true;
  status.textContent = "Submitting your responses…";
  try {
    const response = await fetch(`${API_BASE_URL}/api/submit-evaluation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_uuid: userId,
        evaluation_responses: responses,
        submission_channel: "popup",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Submission failed (${response.status})`);
    localStorage.setItem(SESSION_DONE_PREFIX + userId, "true");
    form.hidden = true;
    status.textContent = "Thank you. Your questionnaire was submitted successfully, and your study session is complete.";
    document.querySelector("#close-button").hidden = false;
  } catch (error) {
    status.textContent = `${error.message} Please check your connection and try submitting again.`;
    submitButton.disabled = false;
  }
});

document.querySelector("#close-button").addEventListener("click", () => window.close());
