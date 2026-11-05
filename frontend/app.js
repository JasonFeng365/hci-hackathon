// Keep this URL in sync with survey.js when changing backend hosts.
const API_BASE_URL = "https://immortal-hot-cat.ngrok-free.app";
const SESSION_STORAGE_KEY = "fieldnotes_participant_uuid";
const USER_ANSWERS_PREFIX = "fieldnotes_trainer_evaluations_";
const QUIZ_ANSWERS_PREFIX = "fieldnotes_quiz_answers_";
const QUIZ_STARTED_PREFIX = "fieldnotes_quiz_started_";
const SESSION_DONE_PREFIX = "fieldnotes_session_done_";
const LETTERS = ["A", "B", "C", "D", "E"];

// Five fixed questions sample the same 15 lesson facts for every participant.
const QUESTIONS = [
  { text: "Which statement best describes whales?", options: ["They are fish that breathe through gills", "They are mammals that breathe air with lungs", "They are reptiles that lay eggs", "They are amphibians that live on land and sea", "They are invertebrates"] },
  { text: "How do baleen whales collect small prey from the water?", options: ["They use sharp teeth", "They stun prey with electricity", "They dig prey from the sea floor", "They filter prey through plates of baleen", "They swallow prey only at the surface"] },
  { text: "Which animal is the largest known to have lived on Earth?", options: ["The blue whale", "The African elephant", "The sperm whale", "The great white shark", "The giant squid"] },
  { text: "What ability do toothed whales such as dolphins use to navigate and find prey?", options: ["Photosynthesis", "Baleen filtering", "Echolocation", "Magnetic levitation", "Thermal vision"] },
  { text: "Which are examples of human-caused threats to some whale populations?", options: ["Moonlight and tides", "Seaweed and coral", "Freshwater and rain", "Clouds and wind", "Fishing-gear entanglement, ship strikes, and ocean noise"] },
];
const ANSWER_COUNT = QUESTIONS.length;

// Adapted 5-item friendliness and 4-item competence scale. Statements are identical
// in the in-chat tutor condition and the independent survey condition.
const EVALUATION_ITEMS = [
  { id: "friendly", construct: "friendliness", statement: "The tutor was friendly." },
  { id: "clear", construct: "clarity", statement: "The tutor explained things clearly." },
  { id: "competent_knowledgeable", construct: "competence", statement: "The tutor was competent and knowledgeable." },
  { id: "pleasant", construct: "friendliness", statement: "The tutor was pleasant to interact with." },
  { id: "helpful", construct: "helpfulness", statement: "The tutor was helpful." },
];

const $ = (selector) => document.querySelector(selector);
let userId = localStorage.getItem(SESSION_STORAGE_KEY) || "";
let participantIndex = null;
let evaluationCondition = null;
let uiPhase = "training";
let messages = [];
let responseCount = 0;
let quizAnswers = [];
let evaluationAnswers = [];
let quizIndex = 0;
let evaluationIndex = 0;
let busy = false;

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function api(path, body, method = "POST") {
  return fetch(`${API_BASE_URL}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
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
function setLoading(show, label = "Your tutor is thinking…") {
  $("#loading-row").hidden = !show;
  $("#loading-label").textContent = label;
}
function setStage(phase) {
  uiPhase = phase;
  let counter = `${responseCount} / 10 clarification replies`;
  if (phase === "testing") counter = `Question ${Math.min(quizIndex + 1, ANSWER_COUNT)} of ${ANSWER_COUNT}`;
  if (phase === "evaluating") {
    counter = evaluationCondition === "tutor"
      ? `Rating ${Math.min(evaluationIndex + 1, EVALUATION_ITEMS.length)} of ${EVALUATION_ITEMS.length}`
      : "External survey";
  }
  const stages = {
    training: ["Your tutor", "Kind, curious, and ready to help", counter, "✦"],
    "awaiting-testing": ["Your tutor", "Lesson complete", counter, "✦"],
    testing: ["Knowledge check", "Choose one answer in each tutor message", counter, "✎"],
    evaluating: [evaluationCondition === "tutor" ? "Feedback for your tutor" : "Independent feedback", evaluationCondition === "tutor" ? "Rate each statement about the tutor" : "Complete the separate survey", counter, "♡"],
    done: ["Study complete", "Thank you for participating", "Complete", "✓"],
  };
  const stage = stages[phase];
  $("#stage-title").textContent = stage[0];
  $("#stage-description").textContent = stage[1];
  $("#stage-counter").textContent = stage[2];
  $("#stage-avatar").textContent = stage[3];
  $("#stage-avatar").className = `avatar ${phase === "testing" ? "assessment-avatar" : phase === "evaluating" ? "feedback-avatar" : ""}`;
  document.querySelectorAll(".phase-step").forEach((step) => {
    const order = { training: 0, "awaiting-testing": 0, testing: 1, evaluating: 2, done: 3 };
    const current = order[phase];
    const index = { training: 0, testing: 1, evaluating: 2 }[step.dataset.phase];
    step.classList.toggle("active", index === current);
    step.classList.toggle("complete", index < current);
  });
  const canChat = phase === "training";
  const showComposer = canChat || phase === "awaiting-testing";
  $("#chat-form").hidden = !showComposer;
  $("#composer-hint").hidden = !canChat;
  $("#message-input").disabled = busy || !canChat;
  $("#send-button").disabled = busy || !canChat;
  $("#take-quiz").hidden = !showComposer;
  $("#take-quiz").disabled = busy;
}
function addMessage(role, content, widget = null) {
  const message = { role, content, widget };
  messages.push(message);
  renderChat();
  return message;
}
function renderChat() {
  const log = $("#chat-log");
  log.replaceChildren();
  messages.forEach((message) => {
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const row = document.createElement("div");
    row.className = `message-row ${isSystem ? "system-notice" : isUser ? "user" : "assistant"}`;
    if (!isSystem) {
      const avatar = document.createElement("span");
      avatar.className = "message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = isUser ? "Y" : "✦";
      row.append(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = isUser ? escapeHtml(message.content).replace(/\n/g, "<br>") : renderMarkdown(message.content);
    if (message.widget) addWidget(bubble, message.widget);
    row.append(bubble);
    log.append(row);
  });
  // On the initial facts-only screen, begin at fact 1 rather than jumping to the
  // bottom of the long tutor bubble. Later messages continue to auto-scroll.
  log.scrollTop = uiPhase === "training" && messages.length === 1 && messages[0].role === "assistant"
    ? 0 : log.scrollHeight;
  if (uiPhase === "training" || uiPhase === "awaiting-testing") $("#stage-counter").textContent = `${responseCount} / 10 clarification replies`;
  if (uiPhase === "testing") $("#stage-counter").textContent = `Question ${Math.min(quizIndex + 1, ANSWER_COUNT)} of ${ANSWER_COUNT}`;
  if (uiPhase === "evaluating") $("#stage-counter").textContent = evaluationCondition === "tutor" ? `Rating ${Math.min(evaluationIndex + 1, EVALUATION_ITEMS.length)} of ${EVALUATION_ITEMS.length}` : "External survey";
}
function addWidget(bubble, widget) {
  if (widget.type === "quiz") {
    const options = document.createElement("div");
    options.className = "answer-options inline-answer-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `Answer choices for question ${widget.questionIndex + 1}`);
    QUESTIONS[widget.questionIndex].options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-option";
      button.disabled = widget.answered || busy;
      button.setAttribute("aria-label", `${LETTERS[index]}: ${option}`);
      const letter = document.createElement("span");
      letter.className = "answer-letter";
      letter.textContent = LETTERS[index];
      const text = document.createElement("span");
      text.className = "answer-option-text";
      text.textContent = option;
      button.append(letter, text);
      button.addEventListener("click", () => chooseAnswer(widget.questionIndex, LETTERS[index]));
      options.append(button);
    });
    bubble.append(options);
  } else if (widget.type === "rating") {
    const scale = document.createElement("div");
    scale.className = "rating-scale";
    scale.setAttribute("role", "group");
    scale.setAttribute("aria-label", "Rating from 1, strongly disagree, to 10, strongly agree");
    for (let score = 1; score <= 10; score += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rating-option";
      button.disabled = busy || widget.itemIndex !== evaluationIndex;
      button.textContent = String(score);
      button.setAttribute("aria-label", `${score} out of 10`);
      button.addEventListener("click", () => submitRating(widget.itemIndex, score));
      scale.append(button);
    }
    const labels = document.createElement("div");
    labels.className = "rating-endpoints";
    labels.innerHTML = "<span>Strongly disagree</span><span>Strongly agree</span>";
    bubble.append(scale, labels);
  } else if (widget.type === "survey-launch") {
    const button = document.createElement("button");
    button.className = "primary-button inline-widget-button";
    button.type = "button";
    button.textContent = "Open the independent survey ↗";
    button.addEventListener("click", openSurvey);
    bubble.append(button);
    const error = document.createElement("p");
    error.className = "survey-error-text";
    error.hidden = true;
    bubble.append(error);
  } else if (widget.type === "retry-submit") {
    const button = document.createElement("button");
    button.className = "primary-button inline-widget-button";
    button.type = "button";
    button.textContent = "Retry saving ratings";
    button.addEventListener("click", submitTutorRatings);
    bubble.append(button);
  }
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $("#message-input");
  const message = input.value.trim();
  if (!message || busy || uiPhase !== "training") return;
  input.value = "";
  addMessage("user", message);
  busy = true;
  setLoading(true);
  setStage("training");
  try {
    const result = await api("/api/chat", { user_uuid: userId, message });
    responseCount = result.response_count;
    addMessage("assistant", result.reply);
    if (result.mode === "testing" || responseCount >= 10) setStage("awaiting-testing");
  } catch (error) {
    messages.pop();
    renderChat();
    input.value = message;
    alert(error.message);
  } finally {
    busy = false;
    setLoading(false);
    setStage(uiPhase === "awaiting-testing" ? "awaiting-testing" : "training");
    if (uiPhase === "training") input.focus();
  }
}
function loadStoredArray(prefix, expectedLength) {
  if (!userId) return [];
  try {
    const result = JSON.parse(localStorage.getItem(prefix + userId) || "[]");
    if (!Array.isArray(result)) return [];
    if (prefix === USER_ANSWERS_PREFIX && result.some((value) => !Number.isInteger(value) || value < 1 || value > 10)) return [];
    if (prefix === QUIZ_ANSWERS_PREFIX && result.some((value) => !LETTERS.includes(value))) return [];
    return result.slice(0, expectedLength);
  } catch { return []; }
}
async function beginTesting() {
  if (busy || uiPhase === "testing") return;
  busy = true;
  setLoading(true, "Preparing the knowledge check…");
  try {
    await api("/api/phase", { user_uuid: userId, mode: "testing" });
    localStorage.setItem(QUIZ_STARTED_PREFIX + userId, "true");
    quizAnswers = loadStoredArray(QUIZ_ANSWERS_PREFIX, ANSWER_COUNT);
    quizIndex = quizAnswers.length;
    messages = [];
    busy = false;
    setLoading(false);
    setStage("testing");
    if (quizIndex >= ANSWER_COUNT) gradeQuiz();
    else showQuizQuestion(quizIndex);
  } catch (error) {
    busy = false;
    setLoading(false);
    alert(error.message);
  }
}
function showQuizQuestion(index) {
  quizIndex = index;
  addMessage("assistant", `### Question ${index + 1} of ${ANSWER_COUNT}\n\n${QUESTIONS[index].text}`, { type: "quiz", questionIndex: index, answered: false });
  setStage("testing");
}
async function chooseAnswer(index, answer) {
  if (busy || index !== quizIndex || uiPhase !== "testing") return;
  busy = true;
  const question = QUESTIONS[index];
  const assistantMessage = [...messages].reverse().find((item) => item.widget?.type === "quiz" && item.widget.questionIndex === index);
  if (assistantMessage?.widget) assistantMessage.widget.answered = true;
  quizAnswers[index] = answer;
  localStorage.setItem(QUIZ_ANSWERS_PREFIX + userId, JSON.stringify(quizAnswers));
  addMessage("user", `${answer} — ${question.options[LETTERS.indexOf(answer)]}`);
  setStage("testing");
  renderChat();
  await pause(400);
  quizIndex = index + 1;
  busy = false;
  if (quizIndex < ANSWER_COUNT) showQuizQuestion(quizIndex);
  else await gradeQuiz();
}
async function gradeQuiz() {
  busy = true;
  setLoading(true, "Checking your answers…");
  try {
    const { results } = await api("/api/grade", { user_uuid: userId, answers: quizAnswers });
    setLoading(false);
    for (let i = 0; i < ANSWER_COUNT; i += 1) {
      await pause(3000);
      const answer = quizAnswers[i];
      const verdict = results[i] ? "**Right.**" : "**Wrong.**";
      addMessage("assistant", `### Question ${i + 1}\n\n**${QUESTIONS[i].text}**\n\nYour answer: **${answer} — ${QUESTIONS[i].options[LETTERS.indexOf(answer)]}**\n\n${verdict}`);
    }
    await pause(400);
    await api("/api/phase", { user_uuid: userId, mode: "evaluating" });
    localStorage.removeItem(QUIZ_ANSWERS_PREFIX + userId);
    localStorage.removeItem(QUIZ_STARTED_PREFIX + userId);
    busy = false;
    startEvaluation(true);
  } catch (error) {
    setLoading(false);
    alert(error.message);
  } finally {
    busy = false;
    setStage(uiPhase);
  }
}
function startEvaluation(showTransition = false) {
  messages = [];
  if (evaluationCondition === "popup") {
    setStage("evaluating");
    addMessage("system", "The knowledge check is complete. Please complete the separate study questionnaire to finish.", { type: "survey-launch" });
    return;
  }
  evaluationAnswers = loadStoredArray(USER_ANSWERS_PREFIX, EVALUATION_ITEMS.length);
  evaluationIndex = evaluationAnswers.length;
  setStage("evaluating");
  if (showTransition) addMessage("assistant", "The knowledge check is complete. We’re beginning the feedback part of our conversation now.");
  if (evaluationIndex >= EVALUATION_ITEMS.length) {
    submitTutorRatings();
  } else {
    showRatingQuestion(evaluationIndex);
  }
}
function showRatingQuestion(index) {
  evaluationIndex = index;
  const item = EVALUATION_ITEMS[index];
  addMessage("assistant", `### Rating ${index + 1} of ${EVALUATION_ITEMS.length}\n\nPlease rate how much you agree with this statement about my tutoring:\n\n**${item.statement}**\n\nChoose 1 for *strongly disagree* through 10 for *strongly agree*.`, { type: "rating", itemIndex: index });
  setStage("evaluating");
}
async function submitRating(index, score) {
  if (busy || index !== evaluationIndex || uiPhase !== "evaluating") return;
  busy = true;
  evaluationAnswers[index] = score;
  localStorage.setItem(USER_ANSWERS_PREFIX + userId, JSON.stringify(evaluationAnswers));
  addMessage("user", `${score} / 10`);
  setLoading(true, "Saving your rating…");
  await pause(400);
  evaluationIndex = index + 1;
  setLoading(false);
  busy = false;
  if (evaluationIndex < EVALUATION_ITEMS.length) showRatingQuestion(evaluationIndex);
  else submitTutorRatings();
}
async function submitTutorRatings() {
  if (busy) return;
  busy = true;
  setLoading(true, "Saving your evaluation…");
  try {
    await api("/api/submit-evaluation", { user_uuid: userId, evaluation_responses: evaluationAnswers, submission_channel: "tutor" });
    localStorage.removeItem(USER_ANSWERS_PREFIX + userId);
    localStorage.setItem(SESSION_DONE_PREFIX + userId, "true");
    showDone();
  } catch (error) {
    setLoading(false);
    addMessage("assistant", `I couldn’t save those ratings yet. ${error.message}`, { type: "retry-submit" });
  } finally {
    busy = false;
    setLoading(false);
    setStage(uiPhase);
  }
}
function openSurvey(event) {
  const popup = window.open(`survey.html?user_uuid=${encodeURIComponent(userId)}`, "fieldnotes-survey", "width=720,height=820,resizable=yes,scrollbars=yes");
  if (!popup) {
    const bubble = event.currentTarget.closest(".message-bubble");
    const error = bubble.querySelector(".survey-error-text");
    error.textContent = "Your browser blocked the survey window. Allow pop-ups for this page, then try again.";
    error.hidden = false;
  }
}
function showDone() {
  messages = [{ role: "assistant", content: "### Study complete\n\nThank you for participating. Your responses have been saved. You may close this page now." }];
  setStage("done");
  renderChat();
}
function initializeEventHandlers() {
  $("#chat-form").addEventListener("submit", sendMessage);
  $("#take-quiz").addEventListener("click", beginTesting);
  $("#message-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#chat-form").requestSubmit(); }
  });
  $("#start-over").addEventListener("click", () => {
    if (confirm("Start a new participant session? The current session remains saved, and the next session will receive the next evaluation condition.")) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      location.reload();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_DONE_PREFIX + userId && event.newValue === "true") showDone();
  });
}
async function initialize() {
  initializeEventHandlers();
  setStage("training");
  setLoading(true, "Starting your study session…");
  try {
    let data;
    if (userId) {
      try {
        data = await api("/api/start", { user_uuid: userId });
      } catch (error) {
        if (!error.message.includes("not found")) throw error;
        localStorage.removeItem(SESSION_STORAGE_KEY);
        userId = "";
      }
    }
    if (!userId) data = await api("/api/start", {});
    userId = data.user_uuid;
    participantIndex = data.participant_index;
    evaluationCondition = data.evaluation_condition;
    localStorage.setItem(SESSION_STORAGE_KEY, userId);
    responseCount = data.response_count || 0;
    messages = data.messages || [];
    if (data.mode === "done") {
      showDone();
    } else if (data.mode === "testing") {
      const started = localStorage.getItem(QUIZ_STARTED_PREFIX + userId) === "true";
      if (started) {
        quizAnswers = loadStoredArray(QUIZ_ANSWERS_PREFIX, ANSWER_COUNT);
        quizIndex = quizAnswers.length;
        messages = [];
        setStage("testing");
        if (quizIndex >= ANSWER_COUNT) gradeQuiz();
        else showQuizQuestion(quizIndex);
      } else {
        setStage("awaiting-testing");
        renderChat();
      }
    } else if (data.mode === "evaluating") {
      startEvaluation(false);
    } else {
      setStage("training");
      renderChat();
    }
  } catch (error) {
    console.error(error);
    messages = [{ role: "assistant", content: "I couldn’t connect to the study server. Please refresh or ask the study team for help." }];
    renderChat();
  } finally {
    setLoading(false);
  }
}
initialize();
