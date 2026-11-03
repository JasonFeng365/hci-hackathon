// Change this for a deployed backend. Local development uses Flask on port 5000.
const API_BASE_URL = "http://localhost:5000";
const SESSION_STORAGE_KEY = "fieldnotes_participant_uuid";
const USER_ANSWERS_PREFIX = "fieldnotes_trainer_evaluations_";
const QUIZ_ANSWERS_PREFIX = "fieldnotes_quiz_answers_";
const LETTERS = ["A", "B", "C", "D", "E"];

const QUESTIONS = [
  { text: "What kind of animals are whales?", options: ["Fish", "Mammals", "Reptiles", "Amphibians", "Invertebrates"] },
  { text: "How do whales breathe?", options: ["Through gills", "Through their skin", "They do not breathe air", "They breathe air with lungs through blowholes", "Through their mouths only"] },
  { text: "What is the scientific order that includes whales, dolphins, and porpoises?", options: ["Cetacea", "Carnivora", "Primates", "Rodentia", "Pinnipedia"] },
  { text: "Which animal is the largest known to have lived on Earth?", options: ["African elephant", "Great white shark", "Blue whale", "Giant squid", "Humpback whale"] },
  { text: "How do baleen whales collect small prey from the water?", options: ["They dig it from the sea floor", "They stun it with electricity", "They swallow seawater without filtering", "They use long, sharp teeth", "They filter it through plates of baleen"] },
  { text: "Which statement about orcas is true?", options: ["They are a type of shark", "They are the largest members of the dolphin family", "They are baleen whales", "They are fish", "They are a type of seal"] },
  { text: "How do whales mainly move forward with their tails?", options: ["They move their flukes side to side", "They paddle with their front flippers", "They use a spiral tail", "They move their flukes up and down", "They use their dorsal fin"] },
  { text: "Which whales are well known for complex songs?", options: ["Humpback whales", "Gray whales", "Bowhead whales", "Belugas only", "Narwhals"] },
  { text: "What is a narwhal's long tusk?", options: ["A horn made of bone", "A piece of baleen", "An elongated tooth", "A fin spine", "A strand of blubber"] },
  { text: "What is one important function of whale blubber?", options: ["It helps whales breathe underwater", "It produces baleen", "It makes whales buoyant enough to fly", "It helps them hear", "It provides insulation and stores energy"] },
  { text: "Which whale is known for deep dives to hunt squid?", options: ["Gray whale", "Sperm whale", "Humpback whale", "Beluga", "Blue whale"] },
  { text: "What ability do toothed whales such as dolphins use to navigate and find prey?", options: ["Photosynthesis", "Magnetic levitation", "Baleen filtering", "Echolocation", "Thermal vision"] },
  { text: "Which whale undertakes one of the longest migrations of any mammal?", options: ["Gray whale", "Sperm whale", "Beluga", "Orca", "Narwhal"] },
  { text: "What is a whale's spout mostly made of?", options: ["Seawater forced from its lungs", "Smoke from digestion", "Warm, moist air and water vapor", "Oil from its skin", "Exhaled food"] },
  { text: "Which are examples of human-caused risks to some whale populations?", options: ["Moonlight and tides", "Seaweed and coral", "Freshwater and rain", "Clouds and wind", "Fishing-gear entanglement, ship strikes, and ocean noise"] },
];

const EVALUATION_QUESTIONS = [
  "How friendly and welcoming did the tutor feel? What made you feel that way?",
  "How clearly and competently did the tutor explain the whale facts?",
  "Did the tutor respond well to your questions and interests? Please explain.",
  "What, if anything, would you change about the tutor’s style or manner?",
];

const $ = (selector) => document.querySelector(selector);
const views = {
  training: $("#training-view"), testing: $("#testing-view"),
  evaluating: $("#evaluating-view"), done: $("#done-view"),
};
let userId = localStorage.getItem(SESSION_STORAGE_KEY) || "";
let mode = "training";
let messages = [];
let responseCount = 0;
let quizAnswers = [];
let evaluationAnswers = [];
let quizIndex = 0;
let evaluationIndex = 0;
let busy = false;

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function api(path, body) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function renderMarkdown(value) {
  if (window.marked) {
    const html = window.marked.parse(value, { breaks: true });
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : escapeHtml(value).replace(/\n/g, "<br>");
  }
  return escapeHtml(value).replace(/\n/g, "<br>");
}
function setBusy(value, element = "#chat-loading") {
  busy = value;
  $(element).hidden = !value;
  $("#send-button").disabled = value || mode !== "training";
  $("#message-input").disabled = value || mode !== "training";
}
function setMode(nextMode, bannerText = "") {
  mode = nextMode;
  Object.entries(views).forEach(([name, element]) => { element.hidden = name !== nextMode; });
  document.querySelectorAll(".phase-step").forEach((step) => {
    const order = { training: 0, testing: 1, evaluating: 2 };
    const current = order[nextMode] ?? 3;
    const index = order[step.dataset.phase];
    step.classList.toggle("active", index === current);
    step.classList.toggle("complete", index < current);
  });
  const banner = $("#phase-banner");
  banner.textContent = bannerText;
  banner.hidden = !bannerText;
  if (nextMode !== "training") {
    $("#send-button").disabled = true;
    $("#message-input").disabled = true;
  }
}
function appendChatMessage(role, content) {
  messages.push({ role, content });
  renderChat();
}
function renderChat() {
  const log = $("#chat-log");
  const content = messages.length ? messages : [{ role: "assistant", content: "Hello! I’m glad you’re here. I’ll be your tutor for a short lesson about whales. What would you like to know, or should I get us started with how whales differ from fish?" }];
  log.innerHTML = content.map((item) => {
    const user = item.role === "user";
    const body = user ? escapeHtml(item.content).replace(/\n/g, "<br>") : renderMarkdown(item.content);
    return `<div class="message-row ${user ? "user" : "assistant"}"><span class="message-avatar" aria-hidden="true">${user ? "Y" : "✦"}</span><div class="message-bubble">${body}</div></div>`;
  }).join("");
  log.scrollTop = log.scrollHeight;
  $("#response-counter").textContent = `${responseCount} / 10 replies`;
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $("#message-input");
  const message = input.value.trim();
  if (!message || busy || mode !== "training") return;
  input.value = "";
  if (!userId && messages.length === 0) {
    messages.push({ role: "assistant", content: "Hello! I’m glad you’re here. I’ll be your tutor for a short lesson about whales. What would you like to know, or should I get us started with how whales differ from fish?" });
  }
  appendChatMessage("user", message);
  setBusy(true);
  try {
    const result = await api("/api/chat", { user_uuid: userId, message });
    userId = result.user_uuid;
    localStorage.setItem(SESSION_STORAGE_KEY, userId);
    responseCount = result.response_count;
    appendChatMessage("assistant", result.reply);
    if (result.mode === "testing" || responseCount >= 10) {
      setMode("testing", "The lesson is complete. Your knowledge check is beginning now.");
      beginQuiz();
    }
  } catch (error) {
    // Remove optimistic user bubble if the server did not accept the message.
    messages.pop();
    renderChat();
    input.value = message;
    alert(error.message);
  } finally {
    setBusy(false);
    if (mode === "training") input.focus();
  }
}

function beginQuiz() {
  quizAnswers = [];
  quizIndex = 0;
  if (userId) {
    try { quizAnswers = JSON.parse(localStorage.getItem(QUIZ_ANSWERS_PREFIX + userId) || "[]"); } catch { quizAnswers = []; }
    if (!Array.isArray(quizAnswers) || quizAnswers.length >= QUESTIONS.length) quizAnswers = [];
  }
  quizIndex = quizAnswers.length;
  renderQuestion();
}
function renderQuestion() {
  $("#question-counter").textContent = `Question ${quizIndex + 1} of ${QUESTIONS.length}`;
  const question = QUESTIONS[quizIndex];
  $("#quiz-content").innerHTML = `<p class="question-kicker">Question ${quizIndex + 1}</p><h3 class="question-text">${escapeHtml(question.text)}</h3><div class="answer-options" role="group" aria-label="Answer options">${question.options.map((option, i) => `<button class="answer-option" type="button" data-answer="${LETTERS[i]}"><span class="answer-letter">${LETTERS[i]}</span><span>${escapeHtml(option)}</span></button>`).join("")}</div>`;
  $("#quiz-content").querySelectorAll(".answer-option").forEach((button) => button.addEventListener("click", () => chooseAnswer(button.dataset.answer)));
}
async function chooseAnswer(answer) {
  if (busy) return;
  busy = true;
  $("#quiz-content").querySelectorAll(".answer-option").forEach((button) => { button.disabled = true; button.classList.toggle("selected", button.dataset.answer === answer); });
  quizAnswers[quizIndex] = answer;
  if (userId) localStorage.setItem(QUIZ_ANSWERS_PREFIX + userId, JSON.stringify(quizAnswers));
  await pause(400);
  quizIndex += 1;
  busy = false;
  if (quizIndex < QUESTIONS.length) renderQuestion();
  else await gradeQuiz();
}
async function gradeQuiz() {
  $("#quiz-content").hidden = true;
  $("#grading-loading").hidden = false;
  try {
    const { results } = await api("/api/grade", { user_uuid: userId, answers: quizAnswers });
    $("#grading-loading").hidden = true;
    const list = $("#feedback-list");
    list.hidden = false;
    list.innerHTML = "";
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      await pause(3000);
      const item = document.createElement("article");
      item.className = "feedback-item";
      const resultLabel = results[i] ? "Right" : "Wrong";
      const className = results[i] ? "correct" : "incorrect";
      item.innerHTML = `<div class="feedback-title"><span>Question ${i + 1}</span><span class="${className}">${resultLabel}</span></div><p><strong>Your answer: ${quizAnswers[i]}</strong> — ${escapeHtml(QUESTIONS[i].options[LETTERS.indexOf(quizAnswers[i])])}</p>`;
      list.appendChild(item);
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    await pause(500);
    await api("/api/phase", { user_uuid: userId, mode: "evaluating" });
    localStorage.removeItem(QUIZ_ANSWERS_PREFIX + userId);
    setMode("evaluating", "The knowledge check is complete. Your feedback phase is beginning now.");
    beginEvaluation();
  } catch (error) {
    $("#grading-loading").hidden = true;
    alert(error.message);
  }
}
function beginEvaluation() {
  evaluationAnswers = [];
  evaluationIndex = 0;
  if (userId) {
    try { evaluationAnswers = JSON.parse(localStorage.getItem(USER_ANSWERS_PREFIX + userId) || "[]"); } catch { evaluationAnswers = []; }
  }
  if (!Array.isArray(evaluationAnswers)) evaluationAnswers = [];
  if (evaluationAnswers.length >= EVALUATION_QUESTIONS.length) {
    showSurveyLaunch();
    return;
  }
  renderEvaluationQuestion();
}
function renderEvaluationQuestion() {
  $("#evaluation-counter").textContent = `Question ${evaluationIndex + 1} of ${EVALUATION_QUESTIONS.length}`;
  const previousAnswer = evaluationAnswers[evaluationIndex] || "";
  $("#evaluation-content").innerHTML = `<p class="question-kicker">Question ${evaluationIndex + 1}</p><p class="evaluation-prompt">${escapeHtml(EVALUATION_QUESTIONS[evaluationIndex])}</p><textarea id="evaluation-answer" maxlength="3000" placeholder="Write your response…">${escapeHtml(previousAnswer)}</textarea><button id="evaluation-next" class="primary-button evaluation-next" type="button">${evaluationIndex === EVALUATION_QUESTIONS.length - 1 ? "Finish feedback" : "Continue"}<span aria-hidden="true">→</span></button>`;
  $("#evaluation-next").addEventListener("click", submitEvaluationAnswer);
}
async function submitEvaluationAnswer() {
  if (busy) return;
  const answer = $("#evaluation-answer").value.trim();
  if (!answer) { $("#evaluation-answer").focus(); return; }
  busy = true;
  $("#evaluation-next").disabled = true;
  $("#evaluation-loading").hidden = false;
  await pause(500);
  evaluationAnswers[evaluationIndex] = answer;
  if (userId) localStorage.setItem(USER_ANSWERS_PREFIX + userId, JSON.stringify(evaluationAnswers));
  evaluationIndex += 1;
  $("#evaluation-loading").hidden = true;
  busy = false;
  if (evaluationIndex < EVALUATION_QUESTIONS.length) renderEvaluationQuestion();
  else showSurveyLaunch();
}
function showSurveyLaunch() {
  $("#evaluation-content").hidden = true;
  $("#evaluation-counter").hidden = true;
  $("#survey-launch").hidden = false;
  $("#goodbye-text").textContent = "Thank you for learning with me. I appreciate your questions and your time. I hope you leave with a few new whale facts to remember. Goodbye!";
}
function openSurvey() {
  if (!userId) { $("#survey-error").hidden = false; $("#survey-error").textContent = "Your participant session is unavailable. Please use Start over and contact the study team."; return; }
  const key = USER_ANSWERS_PREFIX + userId;
  localStorage.setItem(key, JSON.stringify(evaluationAnswers));
  const popup = window.open(`survey.html?user_uuid=${encodeURIComponent(userId)}`, "fieldnotes-survey", "width=640,height=780,resizable=yes,scrollbars=yes");
  if (!popup) { $("#survey-error").hidden = false; $("#survey-error").textContent = "Your browser blocked the survey window. Please allow pop-ups for this page and try again."; }
}
async function initialize() {
  $("#chat-form").addEventListener("submit", sendMessage);
  $("#message-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#chat-form").requestSubmit(); }
  });
  $("#open-survey").addEventListener("click", openSurvey);
  $("#start-over").addEventListener("click", () => {
    if (confirm("Start a new participant session? The current session remains saved on the server, but this browser will use a new ID.")) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      location.reload();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === `fieldnotes_session_done_${userId}` && event.newValue === "true") {
      localStorage.removeItem(USER_ANSWERS_PREFIX + userId);
      setMode("done", "");
    }
  });

  renderChat();
  if (!userId) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/session?user_uuid=${encodeURIComponent(userId)}`);
    if (response.status === 404) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      userId = "";
      renderChat();
      return;
    }
    if (!response.ok) throw new Error("Could not load the saved session.");
    const data = await response.json();
    messages = data.messages || [];
    responseCount = data.response_count || 0;
    renderChat();
    if (data.mode === "done") setMode("done");
    else if (data.mode === "testing") { setMode("testing", "Your knowledge check is ready to continue."); beginQuiz(); }
    else if (data.mode === "evaluating") { setMode("evaluating", "Your feedback phase is ready to continue."); beginEvaluation(); }
    else setMode("training");
  } catch (error) {
    console.error(error);
    $("#phase-banner").textContent = "Could not connect to the backend. Check that the local server is running, then refresh.";
    $("#phase-banner").hidden = false;
  }
}
initialize();
