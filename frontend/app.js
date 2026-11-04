// Change this for a deployed backend. Local development uses Flask on port 5000.
const API_BASE_URL = "http://localhost:5000";
const SESSION_STORAGE_KEY = "fieldnotes_participant_uuid";
const USER_ANSWERS_PREFIX = "fieldnotes_trainer_evaluations_";
const QUIZ_ANSWERS_PREFIX = "fieldnotes_quiz_answers_";
const QUIZ_STARTED_PREFIX = "fieldnotes_quiz_started_";
const SESSION_DONE_PREFIX = "fieldnotes_session_done_";
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
const WELCOME = "Hello! I’m glad you’re here. I’ll be your tutor for a short lesson about whales. What would you like to know, or should I get us started with how whales differ from fish?";
const TRAINING_COMPLETE = "That brings our lesson to a close. You’re ready for a short knowledge check. Press the button below when you’re ready to begin.";

const $ = (selector) => document.querySelector(selector);
let userId = localStorage.getItem(SESSION_STORAGE_KEY) || "";
let uiPhase = "training";
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
function addMessage(role, content, widget = null) {
  const message = { role, content, widget };
  messages.push(message);
  renderChat();
  return message;
}
function setLoading(show, label = "Your tutor is thinking…") {
  $("#loading-row").hidden = !show;
  $("#loading-label").textContent = label;
}
function setStage(phase) {
  uiPhase = phase;
  const stage = {
    training: ["Your tutor", "Kind, curious, and ready to help", `${responseCount} / 10 replies`, "✦"],
    "awaiting-testing": ["Your tutor", "Lesson complete", `${responseCount} / 10 replies`, "✦"],
    testing: ["Knowledge check", "Choose one answer in each tutor message", `Question ${Math.min(quizIndex + 1, QUESTIONS.length)} of ${QUESTIONS.length}`, "✎"],
    evaluating: ["Feedback for your tutor", "Share your candid impressions", `Question ${Math.min(evaluationIndex + 1, EVALUATION_QUESTIONS.length)} of ${EVALUATION_QUESTIONS.length}`, "♡"],
    done: ["Study complete", "Thank you for participating", "Complete", "✓"],
  }[phase];
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
  $("#chat-form").hidden = !canChat;
  $("#composer-hint").hidden = !canChat;
  $("#message-input").disabled = busy || !canChat;
  $("#send-button").disabled = busy || !canChat;
}
function renderChat() {
  const log = $("#chat-log");
  const visibleMessages = messages.length ? messages : [{ role: "assistant", content: WELCOME }];
  log.replaceChildren();
  visibleMessages.forEach((message, index) => {
    const isUser = message.role === "user";
    const row = document.createElement("div");
    row.className = `message-row ${isUser ? "user" : "assistant"}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = isUser ? "Y" : "✦";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (isUser) {
      bubble.textContent = message.content;
    } else {
      bubble.innerHTML = renderMarkdown(message.content);
    }
    if (message.widget) addWidget(bubble, message.widget, index);
    row.append(avatar, bubble);
    log.append(row);
  });
  log.scrollTop = log.scrollHeight;
  if (uiPhase === "training" || uiPhase === "awaiting-testing") {
    $("#stage-counter").textContent = `${responseCount} / 10 replies`;
  }
  if (uiPhase === "testing") $("#stage-counter").textContent = `Question ${Math.min(quizIndex + 1, QUESTIONS.length)} of ${QUESTIONS.length}`;
  if (uiPhase === "evaluating") $("#stage-counter").textContent = `Question ${Math.min(evaluationIndex + 1, EVALUATION_QUESTIONS.length)} of ${EVALUATION_QUESTIONS.length}`;
}
function addWidget(bubble, widget, messageIndex) {
  if (widget.type === "start-testing") {
    const button = document.createElement("button");
    button.className = "primary-button inline-widget-button";
    button.type = "button";
    button.textContent = "Begin the knowledge check →";
    button.addEventListener("click", beginTesting);
    bubble.append(button);
  } else if (widget.type === "quiz") {
    const options = document.createElement("div");
    options.className = "answer-options inline-answer-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `Answer choices for question ${widget.questionIndex + 1}`);
    QUESTIONS[widget.questionIndex].options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-option";
      button.disabled = widget.answered || busy;
      button.dataset.answer = LETTERS[index];
      const letter = document.createElement("span");
      letter.className = "answer-letter";
      letter.textContent = LETTERS[index];
      const text = document.createElement("span");
      text.textContent = option;
      button.append(letter, text);
      button.addEventListener("click", () => chooseAnswer(widget.questionIndex, LETTERS[index]));
      options.append(button);
    });
    bubble.append(options);
  } else if (widget.type === "evaluation") {
    const form = document.createElement("div");
    form.className = "inline-evaluation-form";
    const textarea = document.createElement("textarea");
    textarea.className = "inline-evaluation-answer";
    textarea.maxLength = 3000;
    textarea.rows = 3;
    textarea.placeholder = "Write your response…";
    textarea.setAttribute("aria-label", "Your feedback response");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button inline-widget-button";
    button.textContent = widget.questionIndex === EVALUATION_QUESTIONS.length - 1 ? "Finish feedback →" : "Continue →";
    button.addEventListener("click", () => submitEvaluation(widget.questionIndex, textarea.value));
    form.append(textarea, button);
    bubble.append(form);
    if (widget.questionIndex === evaluationIndex) textarea.focus({ preventScroll: true });
  } else if (widget.type === "survey-launch") {
    const button = document.createElement("button");
    button.className = "primary-button inline-widget-button";
    button.type = "button";
    button.textContent = "Open the feedback survey ↗";
    button.addEventListener("click", openSurvey);
    bubble.append(button);
    const error = document.createElement("p");
    error.className = "survey-error-text";
    error.hidden = true;
    bubble.append(error);
  }
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $("#message-input");
  const message = input.value.trim();
  if (!message || busy || uiPhase !== "training") return;
  input.value = "";
  if (!userId && messages.length === 0) messages.push({ role: "assistant", content: WELCOME });
  addMessage("user", message);
  busy = true;
  setLoading(true);
  setStage("training");
  try {
    const result = await api("/api/chat", { user_uuid: userId, message });
    userId = result.user_uuid;
    localStorage.setItem(SESSION_STORAGE_KEY, userId);
    responseCount = result.response_count;
    addMessage("assistant", result.reply);
    if (result.mode === "testing" || responseCount >= 10) {
      addMessage("assistant", TRAINING_COMPLETE, { type: "start-testing" });
      setStage("awaiting-testing");
    }
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
function loadQuizAnswers() {
  if (!userId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(QUIZ_ANSWERS_PREFIX + userId) || "[]");
    return Array.isArray(value) ? value.slice(0, QUESTIONS.length) : [];
  } catch { return []; }
}
function beginTesting() {
  if (!userId) return;
  localStorage.setItem(QUIZ_STARTED_PREFIX + userId, "true");
  quizAnswers = loadQuizAnswers();
  quizIndex = quizAnswers.length;
  messages = [];
  setStage("testing");
  if (quizIndex >= QUESTIONS.length) {
    gradeQuiz();
  } else {
    showQuizQuestion(quizIndex);
  }
}
function showQuizQuestion(index) {
  quizIndex = index;
  const question = QUESTIONS[index];
  addMessage("assistant", `### Question ${index + 1} of ${QUESTIONS.length}\n\n${question.text}`, { type: "quiz", questionIndex: index, answered: false });
  setStage("testing");
}
async function chooseAnswer(index, answer) {
  if (busy || index !== quizIndex || uiPhase !== "testing") return;
  busy = true;
  const question = QUESTIONS[index];
  const assistantMessage = messages.findLast ? messages.findLast((item) => item.widget?.type === "quiz" && item.widget.questionIndex === index) : [...messages].reverse().find((item) => item.widget?.type === "quiz" && item.widget.questionIndex === index);
  if (assistantMessage?.widget) assistantMessage.widget.answered = true;
  quizAnswers[index] = answer;
  localStorage.setItem(QUIZ_ANSWERS_PREFIX + userId, JSON.stringify(quizAnswers));
  addMessage("user", `${answer} — ${question.options[LETTERS.indexOf(answer)]}`);
  setStage("testing");
  renderChat();
  await pause(400);
  quizIndex = index + 1;
  busy = false;
  if (quizIndex < QUESTIONS.length) showQuizQuestion(quizIndex);
  else await gradeQuiz();
}
async function gradeQuiz() {
  busy = true;
  setLoading(true, "Checking your answers…");
  try {
    const { results } = await api("/api/grade", { user_uuid: userId, answers: quizAnswers });
    setLoading(false);
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      await pause(3000);
      const answer = quizAnswers[i];
      const verdict = results[i] ? "**Right.**" : "**Wrong.**";
      addMessage("assistant", `### Question ${i + 1}\n\n**${QUESTIONS[i].text}**\n\nYour answer: **${answer} — ${QUESTIONS[i].options[LETTERS.indexOf(answer)]}**\n\n${verdict}`);
    }
    await pause(400);
    await api("/api/phase", { user_uuid: userId, mode: "evaluating" });
    localStorage.removeItem(QUIZ_ANSWERS_PREFIX + userId);
    localStorage.removeItem(QUIZ_STARTED_PREFIX + userId);
    startEvaluation(true);
  } catch (error) {
    setLoading(false);
    alert(error.message);
  } finally {
    busy = false;
    setStage(uiPhase);
  }
}
function loadEvaluationAnswers() {
  if (!userId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(USER_ANSWERS_PREFIX + userId) || "[]");
    return Array.isArray(value) ? value.slice(0, EVALUATION_QUESTIONS.length) : [];
  } catch { return []; }
}
function startEvaluation(showTransition = false) {
  evaluationAnswers = loadEvaluationAnswers();
  evaluationIndex = evaluationAnswers.length;
  messages = [];
  setStage("evaluating");
  if (showTransition) addMessage("assistant", "The knowledge check is complete. We’re beginning the feedback part of our conversation now.");
  if (evaluationIndex >= EVALUATION_QUESTIONS.length) {
    finishEvaluationConversation();
  } else {
    showEvaluationQuestion(evaluationIndex);
  }
}
function showEvaluationQuestion(index) {
  evaluationIndex = index;
  addMessage("assistant", `### Feedback question ${index + 1} of ${EVALUATION_QUESTIONS.length}\n\n${EVALUATION_QUESTIONS[index]}`, { type: "evaluation", questionIndex: index });
  setStage("evaluating");
}
async function submitEvaluation(index, rawAnswer) {
  const answer = rawAnswer.trim();
  if (busy || !answer || index !== evaluationIndex) return;
  busy = true;
  setLoading(true, "Saving your response…");
  const bubble = $("#chat-log").querySelectorAll(".inline-evaluation-answer");
  bubble.forEach((textarea) => { textarea.disabled = true; });
  await pause(500);
  evaluationAnswers[index] = answer;
  localStorage.setItem(USER_ANSWERS_PREFIX + userId, JSON.stringify(evaluationAnswers));
  addMessage("user", answer);
  evaluationIndex = index + 1;
  setLoading(false);
  busy = false;
  if (evaluationIndex < EVALUATION_QUESTIONS.length) showEvaluationQuestion(evaluationIndex);
  else finishEvaluationConversation();
}
function finishEvaluationConversation() {
  addMessage("assistant", "Thank you for learning with me. I appreciate your questions and your time. I hope you leave with a few new whale facts to remember. Goodbye!");
  addMessage("assistant", "Please complete one last, separate survey about my tone and manner. It will open in a new window. You may optionally include your name.", { type: "survey-launch" });
  setStage("evaluating");
}
function openSurvey(event) {
  if (!userId) return;
  localStorage.setItem(USER_ANSWERS_PREFIX + userId, JSON.stringify(evaluationAnswers));
  const popup = window.open(`survey.html?user_uuid=${encodeURIComponent(userId)}`, "fieldnotes-survey", "width=640,height=780,resizable=yes,scrollbars=yes");
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
async function initialize() {
  $("#chat-form").addEventListener("submit", sendMessage);
  $("#message-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#chat-form").requestSubmit(); }
  });
  $("#start-over").addEventListener("click", () => {
    if (confirm("Start a new participant session? The current session remains saved on the server, but this browser will use a new ID.")) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      location.reload();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_DONE_PREFIX + userId && event.newValue === "true") {
      localStorage.removeItem(USER_ANSWERS_PREFIX + userId);
      showDone();
    }
  });

  renderChat();
  setStage("training");
  if (!userId) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/session?user_uuid=${encodeURIComponent(userId)}`);
    if (response.status === 404) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      userId = "";
      messages = [];
      renderChat();
      setStage("training");
      return;
    }
    if (!response.ok) throw new Error("Could not load the saved session.");
    const data = await response.json();
    responseCount = data.response_count || 0;
    if (data.mode === "done") {
      showDone();
    } else if (data.mode === "testing") {
      const started = localStorage.getItem(QUIZ_STARTED_PREFIX + userId) === "true";
      if (started) {
        messages = [];
        quizAnswers = loadQuizAnswers();
        quizIndex = quizAnswers.length;
        setStage("testing");
        if (quizIndex >= QUESTIONS.length) gradeQuiz();
        else showQuizQuestion(quizIndex);
      } else {
        messages = data.messages || [];
        if (!messages.length) messages = [{ role: "assistant", content: WELCOME }];
        messages.push({ role: "assistant", content: TRAINING_COMPLETE, widget: { type: "start-testing" } });
        setStage("awaiting-testing");
        renderChat();
      }
    } else if (data.mode === "evaluating") {
      startEvaluation(false);
    } else {
      messages = data.messages || [];
      setStage("training");
      renderChat();
    }
  } catch (error) {
    console.error(error);
    const errorMessage = document.createElement("p");
    errorMessage.className = "backend-error";
    errorMessage.textContent = "Could not connect to the backend. Check that the local server is running, then refresh.";
    $("#chat-log").append(errorMessage);
  }
}
initialize();
