# Overall app

People will talk to the LLMs instead of computers, to measure their sentiment at the end 
	At the end of the session, AI asks the human for a rating (questionnaire)
	Maybe: compare the user’s politeness compared to the user’s self reported rating
	Each of us gets like 2-4 people ish? for 6-12 participants
	
	Previous experiment: facts/questions directly from some database
	Our version: interactive tutoring
		Lets us try different “personalities” for LLMs to see how they affect score
		Agent explains a topic, explains some facts
		User takes an interactive quiz

	Evaluation
		1. Agent directly asks the user how it did (friendlinesss/competence)
		2. Some external questionnaire (Google Forms) to disassociate the agent from the questionnaire - make it feel separate from the agent itself (like a third-party eval).
			External questionnaire can be a popup in plain HTML, with simple, "old-fashioned" UX separate from the agent's 



Implementation
Website: ensure that one person’s entire conversation is saved all in one place
	All chat history is logged in files - as long as we can record data

Training phase:
	AI-supported - use some cheap tokens for a tutor kind of thing
	Support with human interactions
	Preset information (30ish facts) on a topic and ask it to communicate all that information.
		Gives that information to the user in a conversational way.
	

Testing phase: Some questions to ask depending on topic: summary, timeline
	“Are you ready to begin your assessment?” - make changing phases very clear.
	Multiple choice - 15 questions, with 5 options per question

Evaluation phase:
	“Are you ready to begin your evaluation?” - make changing phases very clear.
	Both in-app evaluation as well as google form (or any third-party survey)


# Technical and Design

### Backend

- Runs on Python Anywhere as a Flask server
- Websockets are unsupported; everything runs in pure REST
- Requires OpenAI library and an OpenAI token (will be provided)

### Frontend

- Connects to a backend specified in the js file - this string points to the backend url, and can be user configured. Use localhost:5000 for testing.
- The frontend must be a static HTML page, as we will host this on GitHub Pages. The backend is served by a different service - either through ngrok xor through PythonAnywhere.

### Training phase

- All user messages are logged in a folder `logs/`, which contains JSON in the following format.
Filename: `<user_uuid>.json`
Body:
```json
{
	"mode": "training / testing / evaluating / done",
	"trainer_agent_evaluations": [
		"response1",
		"response2"
	],
	"application_evaluations": [
		"response1",
		"response2"
	],
	"messages": [
		{"role": "system", "content": "You are a helpful, concise assistant."},
		{"role": "assistant", "content": "Starting message"},
		{"role": "user", "content": "User response 1"},
		{"role": "assistant", "content": "LLM response"},
		{"role": "user", "content": "User response 2"}
	]
}
```
- Essentially, this is a json solely of the `messages` array used within the OpenAI API. See [openai_sample.py]() for sample usage.
- Every time the user sends a message (`POST` endpoint that also contains the user's UUID):
  1. Read the corresponding messages json from the filesystem, using uuid as key
     1. If the user doesn't exist, create it with a set system prompt and first assistant message
  2. Append the user's message to the existing messages array
  3. Send the request to OpenAI using `gpt-6-luna`, wait for response
  4. Add the response to the messages array and save it to filesystem
  5. Return the response back to the user, along with the user's UUID.
     1. In *test mode* (configurable with a cli flag at server startup), do everything *except* actually send the message to OpenAI for a response. Instead, sleep for 3 seconds then return some test Markdown that contains the current number of *new* LLM responses (starting at 1, going to 10).
- If the user hasn't sent a message yet, the user should leave the uuid field blank. The system will assign a uuid to the user.
- UUID persists only in the browser session, and is cleared on page refresh. This is intentional and fine.
- Human-AI interaction will be done through text, like a chat format that OpenAI does. So, it'll be little speech bubbles from the user on the right hand side of the screen, while the AI response is rendered Markdown once the agent responds. In between the user pressing enter or send, the user is unable to send a new message, and a little loading spinner appears until the LLM finishes responding.
- Training mode stops once 10 *new* responses have been sent by the LLM. Then after the last response, it displays a prompt to begin testing phase.

### Testing phase

- The user answers 15 multiple choice problems. These problems are placeholders, and the plain text can be stored in the frontend code. But, the answers should not be stored in the frontend code, just the questions.
- This part is deterministic, so no actual interaction with the agent. But still add a little delay for processing to simulate sending the answer to the agent (300-500ms).
- The user must select A, B, C, D, xor E. These will be given as circular buttons to click on, instead of text input, to ensure the user gives a deterministic answer.
- Once all questions are answered, `POST` the responses to the server to grade. The server responds with a list of booleans, corresponding to if an answer is wrong or right. Then, the frontend repeats each question, the user's answer, and if the answer was wrong or right. This response will be in a 15 separate text blocks, generated deterministically, with 3 second delay between each one.
- After that, transition into the evaluation section.

### Evaluation phase

- The user will be given a series of free-response questions on the UI, to evaluate how the trainer did, in terms of friendliness, competence, and any similar metrics - should be up to 5 questions
- Questions presented one at a time, then take the user's answers. Delay a little between the user pressing enter and presenting the next question. (Pretend it's being sent to the server.)
- Once all questions are answered, make the agent say a goodbye closing message, then prevent the user from making any further communications.
- After closing, ask the user to take a full survey. This opens a new window with a full list of questions on the agent's tone, mannerisms etc. Similar questions as the agent presented, but make it different enough. This UI should be super basic, with no CSS at all.
- Once the user submits this survey, POST the full list of response strings to the server - both from the agent's questions ("trainer_agent_evaluations") and the HTML popup survey ("application_evaluations"). Then update the user json with those responses. Set the user's status to done - the user is finished.