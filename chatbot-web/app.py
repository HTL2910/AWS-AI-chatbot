from flask import Flask, render_template, request, jsonify
import boto3
import json
import os
from datetime import datetime

app = Flask(__name__)
client = boto3.client('bedrock-runtime', region_name='us-east-1')

conversation_history = []

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    global conversation_history
    print("📨 Chat request received")
    user_message = request.json.get('message')
    print(f"User message: {user_message}")

    if not user_message:
        return jsonify({'error': 'Message is required'}), 400

    try:
        conversation_history.append({
            'role': 'user',
            'content': user_message
        })

        messages = conversation_history.copy()

        response = client.invoke_model(
            modelId='anthropic.claude-3-sonnet-20240229-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-06-01',
                'max_tokens': 1024,
                'messages': messages
            })
        )

        response_body = json.loads(response['body'].read())
        assistant_message = response_body['content'][0]['text']

        conversation_history.append({
            'role': 'assistant',
            'content': assistant_message
        })

        print(f"✅ Response: {assistant_message}")

        return jsonify({
            'message': assistant_message,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/clear', methods=['POST'])
def clear_history():
    global conversation_history
    conversation_history = []
    return jsonify({'status': 'cleared'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)