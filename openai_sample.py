import os
from openai import OpenAI

# Initialize the client (automatically looks for the OPENAI_API_KEY environment variable)
client = OpenAI()

# Initialize conversation history with an optional system prompt to guide behavior
messages = [
    {"role": "system", "content": "You are a helpful, concise assistant."},
    {"role": "assistant", "content": "Hi! What is your name?"}
]

print("Chatbot initialized! Type 'exit' or 'quit' to end the conversation.\n")

while True:
    # 1. Capture user input
    user_input = input("You: ")
    if user_input.lower() in ['exit', 'quit']:
        print("Goodbye!")
        break
        
    if not user_input.strip():
        continue

    # 2. Append user message to the conversation history
    messages.append({"role": "user", "content": user_input})

    try:
        # 3. Send the entire message history to OpenAI
        response = client.chat.completions.create(
            model="gpt-6-luna",  # or your preferred model
            messages=messages
        )

        # 4. Extract the assistant's reply
        assistant_reply = response.choices[0].message.content
        print(f"\nAI: {assistant_reply}\n")

        # 5. Append the assistant's response to maintain context for the next turn
        messages.append({"role": "assistant", "content": assistant_reply})

    except Exception as e:
        print(f"\nAn error occurred: {e}\n")
